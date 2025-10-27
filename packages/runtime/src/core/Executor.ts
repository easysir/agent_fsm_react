import { nanoid } from 'nanoid';
import type {
  AgentContextSnapshot,
  BusEvent,
  ExecutionResult,
  PlanStep,
  ToolInput,
  ToolRegistry,
} from '../types/index.js';
import { EventBus } from '../event/EventBus.js';

export interface ExecutorOptions {
  toolRegistry: ToolRegistry;
  eventBus: EventBus;
}

export class Executor {
  private toolRegistry: ToolRegistry;

  private eventBus: EventBus;

  constructor(options: ExecutorOptions) {
    this.toolRegistry = options.toolRegistry;
    this.eventBus = options.eventBus;
  }

  public async execute(
    planStep: PlanStep,
    snapshot: AgentContextSnapshot,
    preferredToolId?: string,
  ): Promise<ExecutionResult> {
    const toolId = preferredToolId ?? planStep.toolCandidates[0];
    if (!toolId) {
      throw new Error(`No tool candidate available for task ${planStep.taskId}`);
    }

    const tool = this.toolRegistry.get(toolId);
    if (!tool) {
      throw new Error(`Tool ${toolId} is not registered`);
    }

    const traceId = nanoid();
    const requestEvent: BusEvent = {
      eventId: nanoid(),
      type: 'tool.request',
      timestamp: Date.now(),
      traceId,
      relatedTaskId: planStep.taskId,
      payload: {
        toolId,
        planStep,
      },
    };
    this.eventBus.emit(requestEvent);

    const input: ToolInput = {
      taskId: planStep.taskId,
      traceId,
      params: { goal: planStep.goal },
      context: snapshot,
    };

    const startedAt = Date.now();
    const result = await tool.execute(input);
    const elapsed = Date.now() - startedAt;

    const resultEvent: BusEvent = {
      eventId: nanoid(),
      type: 'tool.result',
      timestamp: Date.now(),
      traceId,
      relatedTaskId: planStep.taskId,
      payload: {
        toolId,
        planStep,
        result: { ...result, latencyMs: elapsed },
      },
    };
    this.eventBus.emit(resultEvent);

    return {
      planStep,
      toolId,
      result: { ...result, latencyMs: elapsed },
    };
  }
}
