// @ts-nocheck
import {
  assign,
  createMachine,
  fromPromise,
  type AnyStateMachine,
} from 'xstate';
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
  executor: Executor
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
          input: ({ context }) => ({ context }),
          src: fromPromise(async (args: any) => {
            const { context } = (args?.input ?? {}) as { context: MachineContext };
            if (!context) {
              throw new Error('Planner invoke received no context');
            }
            try {
              const planStep = await config.planner.plan(context.snapshot);
              console.log('[agentMachine] plan', {
                taskId: planStep.taskId,
                iteration: context.iterations,
              });
              return planStep;
            } catch (error) {
              console.error('[agentMachine] plan error', error);
              throw error ?? new Error('Planner rejected without value');
            }
          }),
          onDone: {
            target: 'act',
            actions: ['storePlanStep'],
          },
          onError: {
            target: 'error',
            actions: [
              (_, event) => {
                console.error('[agentMachine] plan error', event?.data ?? event?.error);
              },
              'recordFailure',
            ],
          },
        },
      },
      act: {
        invoke: {
          id: 'executor',
          input: ({ context }) => ({ context }),
          src: fromPromise(async (args: any) => {
            const { context } = (args?.input ?? {}) as { context: MachineContext };
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
            actions: [
              (_, event) => {
                console.error('[agentMachine] act error', event?.data ?? event?.error);
              },
              'recordFailure',
            ],
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
          input: ({ context }) => ({ context }),
          src: fromPromise(async (args: any) => {
            const { context } = (args?.input ?? {}) as { context: MachineContext };
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
            actions: [
              (_, event) => {
                console.error('[agentMachine] reflect error', event?.data ?? event?.error);
              },
              'recordFailure',
            ],
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
        const elapsed = Date.now() - context.startedAt;
        if (guardConfig.maxDurationMs) {
          if (elapsed > guardConfig.maxDurationMs) {
            throw new Error(
              `Agent exceeded max duration ${guardConfig.maxDurationMs}ms`
            );
          }
        }
        if (
          guardConfig.maxIterations &&
          context.iterations >= guardConfig.maxIterations
        ) {
          throw new Error(
            `Agent exceeded max iterations ${guardConfig.maxIterations}`
          );
        }
      },
      storePlanStep: assign(({ context, event }) => {
        const planStep = (event as { output?: PlanStep })?.output;
        if (!planStep) {
          return {
            planStep: context.planStep,
            executionResult: null,
            observation: null,
            attempt: 0,
          };
        }
        console.log('[agentMachine] plan stored', { taskId: planStep.taskId });
        return {
          planStep,
          executionResult: null,
          observation: null,
          attempt: 0,
        };
      }),
      storeExecutionResult: assign(({ context, event }) => {
        const executionResult = (event as { output?: ExecutionResult })?.output ?? null;
        if (executionResult) {
          console.log('[agentMachine] act result', {
            toolId: executionResult.toolId,
            success: executionResult.result?.success,
          });
        }
        return {
          executionResult,
          snapshot: context.agentContext.getSnapshot(),
        };
      }),
      deriveObservation: assign(({ context }) => {
        const { executionResult, agentContext: ctx } = context;
        if (!executionResult) {
          console.log("[agentMachine:observe] no execution result to observe");
          return {
            observation: null,
            snapshot: ctx.getSnapshot(),
          };
        }
        const observation: Observation = {
          source: "tool",
          relatedTaskId: executionResult.planStep.taskId,
          timestamp: Date.now(),
          payload: executionResult.result.output,
          success: executionResult.result.success,
          latencyMs: executionResult.result.latencyMs,
          error: executionResult.result.error,
        };
        ctx.addObservation(observation);
        return {
          observation,
          snapshot: ctx.getSnapshot(),
        };
      }),
      applyReflectOutcome: assign(({ context, event }) => {
        const outcome = (event as { output?: ReflectOutcome })?.output;
        const ctx = context.agentContext;
        if (!outcome) {
          return {
            iterations: context.iterations + 1,
            snapshot: ctx.getSnapshot(),
          };
        }
        console.log('[agentMachine] reflect', outcome.status);
        if (outcome.updatedTasks) {
          outcome.updatedTasks.forEach((task) => ctx.upsertTask(task));
        }
        if (outcome.message) {
          ctx.mergeWorkingMemory({ reflectMessage: outcome.message });
        }
        return {
          iterations: context.iterations + 1,
          snapshot: ctx.getSnapshot(),
        };
      }),
      applyRetryOutcome: assign(({ context, event }) => {
        const outcome = (event as { output?: ReflectOutcome })?.output;
        if (!outcome) {
          return {
            attempt: context.attempt + 1,
            iterations: context.iterations + 1,
          };
        }
        const planStep = context.planStep;
        if (!planStep || !outcome.fallbackToolId) {
          return {
            attempt: context.attempt + 1,
            iterations: context.iterations + 1,
          };
        }
        return {
          attempt: context.attempt + 1,
          iterations: context.iterations + 1,
          planStep: {
            ...planStep,
            toolCandidates: [
              outcome.fallbackToolId,
              ...planStep.toolCandidates,
            ],
          },
        };
      }),
      applyFallbackOutcome: assign(({ context, event }) => {
        const outcome = (event as { output?: ReflectOutcome })?.output;
        const ctx = context.agentContext;
        if (!outcome) {
          return {
            iterations: context.iterations + 1,
            snapshot: ctx.getSnapshot(),
          };
        }
        let updatedPlanStep = context.planStep;
        if (updatedPlanStep && outcome.fallbackToolId) {
          if (updatedPlanStep.toolCandidates[0] !== outcome.fallbackToolId) {
            updatedPlanStep = {
              ...updatedPlanStep,
              toolCandidates: [
                outcome.fallbackToolId,
                ...updatedPlanStep.toolCandidates,
              ],
            };
          }
        }
        if (outcome.updatedTasks) {
          outcome.updatedTasks.forEach((task) => ctx.upsertTask(task));
        }
        return {
          iterations: context.iterations + 1,
          planStep: updatedPlanStep,
          snapshot: ctx.getSnapshot(),
        };
      }),
      applyAbortOutcome: assign(({ context, event }) => {
        const outcome = (event as { output?: ReflectOutcome })?.output;
        const ctx = context.agentContext;
        if (!outcome) {
          return {
            snapshot: ctx.getSnapshot(),
          };
        }
        if (outcome.message) {
          ctx.mergeWorkingMemory({ abortReason: outcome.message });
        }
        return {
          snapshot: ctx.getSnapshot(),
        };
      }),
      recordFailure: assign(({ context, event }) => {
        const ctx = context.agentContext;
        if (!event) {
          return {};
        }
        const errorData = (event as any)?.data ?? (event as any)?.error;
        let message = "Unknown failure";
        if (errorData) {
          if (errorData instanceof Error) {
            message = errorData.message;
          } else if (typeof errorData === "string") {
            message = errorData;
          } else if (typeof errorData === "object" && "message" in errorData) {
            message = String((errorData as { message?: unknown }).message);
          }
        }
        console.error("[agentMachine] error", message);
        if (ctx) {
          ctx.mergeWorkingMemory({ lastError: message });
        }
        return {
          failures: context.failures + 1,
          snapshot: ctx ? ctx.getSnapshot() : context.snapshot,
        };
      }),
      emitFinishEvent: () => {
        console.log('[agentMachine] finish');
      },
      handleError: () => {
        // hook for runtime error handling
      },
      advanceIteration: assign(({ context }) => ({
        iterations: context.iterations + 1,
        snapshot: context.agentContext.getSnapshot(),
      })),
    },
  };

  return createMachine(
    machineDefinition,
    machineImplementation,
  ) as AnyStateMachine;
}
