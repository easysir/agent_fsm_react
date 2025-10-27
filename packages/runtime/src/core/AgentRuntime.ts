import { Subject } from 'rxjs';
import { createActor } from 'xstate';
import type {
  AgentConfig,
  AgentContextSnapshot,
  AgentState,
  BusEvent,
  ExecutionResult,
  Observation,
  RuntimeEventStream,
  TaskNode,
  ToolRegistry,
} from '../types/index.js';
import { EventBus } from '../event/EventBus.js';
import { createAgentMachine } from '../fsm/agentMachine.js';
import { AgentContext } from './AgentContext.js';
import { Executor } from './Executor.js';

export interface AgentRuntimeOptions {
  config: AgentConfig;
  eventBus?: EventBus;
}

export interface AgentRunInput {
  rootTask: Pick<TaskNode, 'taskId' | 'description' | 'status'> & {
    parentId?: string;
    children?: string[];
    metadata?: Record<string, unknown>;
  };
  metadata?: Record<string, unknown>;
}

export interface AgentRunResult {
  state: AgentState;
  iterations: number;
  lastObservation: Observation | null;
  executionResult: ExecutionResult | null;
  finalSnapshot: AgentContextSnapshot;
}

export class AgentRuntime {
  private config: AgentConfig;

  private eventBus: EventBus;

  private snapshot$ = new Subject<AgentContextSnapshot>();

  private toolRegistry: ToolRegistry;

  constructor(options: AgentRuntimeOptions) {
    this.config = options.config;
    this.eventBus = options.eventBus ?? new EventBus();
    this.toolRegistry = options.config.toolRegistry;
  }

  public get streams(): RuntimeEventStream {
    return {
      events$: this.eventBus.events(),
      snapshots$: this.snapshot$.asObservable(),
    };
  }

  public async run(input: AgentRunInput): Promise<AgentRunResult> {
    const agentContext = new AgentContext({
      agentId: this.config.agentId,
      rootTask: {
        taskId: input.rootTask.taskId,
        description: input.rootTask.description,
        status: input.rootTask.status,
        ...(input.rootTask.parentId ? { parentId: input.rootTask.parentId } : {}),
        ...(input.rootTask.metadata ? { metadata: input.rootTask.metadata } : {}),
        ...(input.rootTask.children ? { children: input.rootTask.children } : {}),
      },
      ...(input.metadata ? { metadata: input.metadata } : {}),
    });

    const executor = new Executor({
      eventBus: this.eventBus,
      toolRegistry: this.toolRegistry,
    });

    const machine = createAgentMachine(this.config, agentContext, executor);
    const actor = createActor(machine);

    const result = await new Promise<AgentRunResult>((resolve, reject) => {
      const subscription = actor.subscribe({
        next: (state) => {
          const snapshot = agentContext.getSnapshot();
          this.snapshot$.next(snapshot);
          this.emitAgentTransition(state.value as AgentState, snapshot);
          if (state.status === 'done') {
            const { executionResult, observation, iterations } = state.context;
            subscription.unsubscribe();
            resolve({
              state: state.value as AgentState,
              iterations,
              lastObservation: observation,
              executionResult,
              finalSnapshot: snapshot,
            });
          }
        },
        error: (error) => {
          subscription.unsubscribe();
          reject(error);
        },
      });

      try {
        actor.start();
      } catch (error) {
        subscription.unsubscribe();
        reject(error);
      }
    });

    return result;
  }

  private emitAgentTransition(state: AgentState, snapshot: AgentContextSnapshot): void {
    const event: BusEvent = {
      eventId: `${snapshot.agentId}-${Date.now()}`,
      type: state === 'finish' ? 'agent.finished' : 'agent.transition',
      timestamp: Date.now(),
      traceId: snapshot.activeTaskId ?? snapshot.rootTaskId,
      payload: {
        agentId: snapshot.agentId,
        state,
        iteration: snapshot.iteration,
        activeTaskId: snapshot.activeTaskId,
      },
    };
    this.eventBus.emit(event);
  }
}
