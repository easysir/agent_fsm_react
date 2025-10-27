// @ts-nocheck
import { assign, createMachine, fromPromise, type AnyStateMachine } from 'xstate';
import type {
  AgentConfig,
  AgentContextSnapshot,
  ExecutionResult,
  Observation,
  PlanStep,
  ReflectOutcome,
} from '../types/index.js';
import { AgentContext } from '../core/AgentContext.js';
import { Executor } from '../core/Executor.js';

export interface MachineContext {
  agentContext: AgentContext;
  snapshot: AgentContextSnapshot;
  planStep: PlanStep | null;
  executionResult: ExecutionResult | null;
  observation: Observation | null;
  attempt: number;
  iterations: number;
  failures: number;
  startedAt: number;
}

export type MachineEvents =
  | { type: 'NEXT' }
  | { type: 'RETRY'; reason?: string }
  | { type: 'FAIL'; reason: string }
  | { type: 'STOP' };

export function createAgentMachine(
  config: AgentConfig,
  agentContext: AgentContext,
  executor: Executor,
): AnyStateMachine {
  const guardConfig = config.guard ?? {};

  const machineDefinition: any = {
      id: `agent-${config.agentId}`,
      initial: 'plan',
      context: (): MachineContext => ({
        agentContext,
        snapshot: agentContext.getSnapshot(),
        planStep: null,
        executionResult: null,
        observation: null,
        attempt: 0,
        iterations: 0,
        failures: 0,
        startedAt: Date.now(),
      }),
      states: {
        plan: {
          entry: 'checkGuards',
          invoke: {
            id: 'planner',
            src: fromPromise(async (args: any) => {
              const { context } = args as { context: MachineContext };
              return config.planner.plan(context.snapshot);
            }),
            onDone: {
              target: 'act',
              actions: ['storePlanStep'],
            },
            onError: {
              target: 'error',
              actions: ['recordFailure'],
            },
          },
        },
        act: {
          invoke: {
            id: 'executor',
            src: fromPromise(async (args: any) => {
              const { context } = args as { context: MachineContext };
              if (!context.planStep) {
                throw new Error('Missing plan step when attempting execution');
              }
              return executor.execute(context.planStep, context.snapshot);
            }),
            onDone: {
              target: 'observe',
              actions: ['storeExecutionResult'],
            },
            onError: {
              target: 'error',
              actions: ['recordFailure'],
            },
          },
        },
        observe: {
          entry: ['deriveObservation'],
          always: 'reflect',
        },
        reflect: {
          invoke: {
            id: 'reflector',
            src: fromPromise(async (args: any) => {
              const { context } = args as { context: MachineContext };
              if (!context.planStep) {
                throw new Error('Reflector invoked without plan step');
              }
              return config.reflector.reflect({
                planStep: context.planStep,
                observation: context.observation,
                context: context.snapshot,
                attempt: context.attempt + 1,
              });
            }),
            onDone: [
              {
                target: 'finish',
                cond: (_, event) => event.output.status === 'complete',
                actions: ['applyReflectOutcome'],
              },
              {
                target: 'plan',
                cond: (_, event) => event.output.status === 'continue',
                actions: ['applyReflectOutcome', 'advanceIteration'],
              },
              {
                target: 'act',
                cond: (_, event) => event.output.status === 'retry',
                actions: ['applyRetryOutcome'],
              },
              {
                target: 'plan',
                cond: (_, event) => event.output.status === 'fallback',
                actions: ['applyFallbackOutcome'],
              },
              {
                target: 'finish',
                cond: (_, event) => event.output.status === 'abort',
                actions: ['applyAbortOutcome'],
              },
              {
                target: 'plan',
                actions: ['advanceIteration'],
              },
            ],
            onError: {
              target: 'error',
              actions: ['recordFailure'],
            },
          },
        },
        finish: {
          type: 'final',
          entry: ['emitFinishEvent'],
        },
        error: {
          entry: ['handleError'],
          always: [
            {
              target: 'reflect',
              cond: ({ failures }) =>
                typeof guardConfig.maxFailures === 'number'
                  ? failures < guardConfig.maxFailures
                  : true,
            },
            { target: 'finish' },
          ],
        },
      },
      on: {
        STOP: '.finish',
      },
  };

  const machineImplementation: any = {
      actions: {
        checkGuards: ({ context }) => {
          if (guardConfig.maxDurationMs) {
            const duration = Date.now() - context.startedAt;
            if (duration > guardConfig.maxDurationMs) {
              throw new Error(`Agent exceeded max duration ${guardConfig.maxDurationMs}ms`);
            }
          }
          if (guardConfig.maxIterations && context.iterations >= guardConfig.maxIterations) {
            throw new Error(`Agent exceeded max iterations ${guardConfig.maxIterations}`);
          }
        },
        storePlanStep: assign({
          planStep: (_, event: any) => event.output as PlanStep,
          executionResult: () => null,
          observation: () => null,
          attempt: () => 0,
        }),
        storeExecutionResult: assign({
          executionResult: (_, event: any) => event.output as ExecutionResult,
          snapshot: ({ agentContext: ctx }) => ctx.getSnapshot(),
        }),
        deriveObservation: assign({
          observation: ({ executionResult, agentContext: ctx }) => {
            if (!executionResult) return null;
            const observation: Observation = {
              source: 'tool',
              relatedTaskId: executionResult.planStep.taskId,
              timestamp: Date.now(),
              payload: executionResult.result.output,
              success: executionResult.result.success,
              latencyMs: executionResult.result.latencyMs,
              error: executionResult.result.error,
            };
            ctx.addObservation(observation);
            return observation;
          },
          snapshot: ({ agentContext: ctx }) => ctx.getSnapshot(),
        }),
        applyReflectOutcome: assign({
          iterations: ({ iterations }) => iterations + 1,
          snapshot: ({ agentContext: ctx }, event: any) => {
            const outcome = event.output as ReflectOutcome;
            if (outcome.updatedTasks) {
              outcome.updatedTasks.forEach((task) => ctx.upsertTask(task));
            }
            if (outcome.message) {
              ctx.mergeWorkingMemory({ reflectMessage: outcome.message });
            }
            return ctx.getSnapshot();
          },
        }),
        applyRetryOutcome: assign({
          attempt: ({ attempt }) => attempt + 1,
          iterations: ({ iterations }) => iterations + 1,
          planStep: ({ planStep }, event: any) => {
            if (!planStep) return planStep;
            const outcome = event.output as ReflectOutcome;
            if (!outcome.fallbackToolId) return planStep;
            return {
              ...planStep,
              toolCandidates: [outcome.fallbackToolId, ...planStep.toolCandidates],
            };
          },
        }),
        applyFallbackOutcome: assign({
          iterations: ({ iterations }) => iterations + 1,
          planStep: ({ planStep }, event: any) => {
            const outcome = event.output as ReflectOutcome;
            if (!planStep || !outcome.fallbackToolId) return planStep;
            if (planStep.toolCandidates[0] === outcome.fallbackToolId) {
              return planStep;
            }
            return {
              ...planStep,
              toolCandidates: [outcome.fallbackToolId, ...planStep.toolCandidates],
            };
          },
          snapshot: ({ agentContext: ctx }, event: any) => {
            const outcome = event.output as ReflectOutcome;
            if (outcome.updatedTasks) {
              outcome.updatedTasks.forEach((task) => ctx.upsertTask(task));
            }
            return ctx.getSnapshot();
          },
        }),
        applyAbortOutcome: assign({
          snapshot: ({ agentContext: ctx }, event: any) => {
            const outcome = event.output as ReflectOutcome;
            if (outcome.message) {
              ctx.mergeWorkingMemory({ abortReason: outcome.message });
            }
            return ctx.getSnapshot();
          },
        }),
        recordFailure: assign({
          failures: ({ failures }) => failures + 1,
          snapshot: (context, event: any) => {
            const ctx = context.agentContext;
            if (!ctx) {
              return context.snapshot;
            }
            const errorData = event?.data ?? event?.error;
            let message = 'Unknown failure';
            if (errorData) {
              if (errorData instanceof Error) {
                message = errorData.message;
              } else if (typeof errorData === 'string') {
                message = errorData;
              } else if (typeof errorData === 'object' && 'message' in errorData) {
                message = String((errorData as { message?: unknown }).message);
              }
            }
            ctx.mergeWorkingMemory({ lastError: message });
            return ctx.getSnapshot();
          },
        }),
        emitFinishEvent: () => {
          // emitted from runtime layer
        },
        handleError: () => {
          // hook for runtime error handling
        },
        advanceIteration: assign({
          iterations: ({ iterations }) => iterations + 1,
          snapshot: ({ agentContext: ctx }) => ctx.getSnapshot(),
        }),
      },
  };

  return createMachine(machineDefinition, machineImplementation) as AnyStateMachine;
}
