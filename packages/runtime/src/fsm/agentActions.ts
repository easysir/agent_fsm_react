// @ts-nocheck
import { assign } from 'xstate';
import type {
  AgentConfig,
  ExecutionResult,
  Observation,
  PlanStep,
  ReflectOutcome,
} from '../types/index.js';
import type { MachineContext } from './agentTypes.js';

export function createActions(guardConfig: AgentConfig['guard']) {
  return {
    checkGuards: ({ context }: { context: MachineContext }) => {
      const elapsed = Date.now() - context.startedAt;
      if (
        typeof guardConfig?.maxDurationMs === 'number' &&
        elapsed > guardConfig.maxDurationMs
      ) {
        throw new Error(
          `Agent exceeded max duration ${guardConfig.maxDurationMs}ms`,
        );
      }
      if (
        typeof guardConfig?.maxIterations === 'number' &&
        context.iterations >= guardConfig.maxIterations
      ) {
        throw new Error(
          `Agent exceeded max iterations ${guardConfig.maxIterations}`,
        );
      }
    },
    storePlanStep: assign<MachineContext, any>((context, event) => {
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
    storeExecutionResult: assign<MachineContext, any>((context, event) => {
      const executionResult =
        (event as { output?: ExecutionResult })?.output ?? null;
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
    deriveObservation: assign<MachineContext, any>((context) => {
      const { executionResult, agentContext: ctx } = context;
      if (!executionResult) {
        console.log('[agentMachine:observe] no execution result to observe');
        return {
          observation: null,
          snapshot: ctx.getSnapshot(),
        };
      }
      const latency = executionResult.result.latencyMs;
      const error = executionResult.result.error;
      const observation: Observation = {
        source: 'tool',
        relatedTaskId: executionResult.planStep.taskId,
        timestamp: Date.now(),
        payload: executionResult.result.output,
        success: executionResult.result.success,
        ...(typeof latency === 'number' ? { latencyMs: latency } : {}),
        ...(typeof error === 'string' ? { error } : {}),
      };
      ctx.addObservation(observation);
      return {
        observation,
        snapshot: ctx.getSnapshot(),
      };
    }),
    applyReflectOutcome: assign<MachineContext, any>((context, event) => {
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
    applyRetryOutcome: assign<MachineContext, any>((context, event) => {
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
          toolCandidates: [outcome.fallbackToolId, ...planStep.toolCandidates],
        },
      };
    }),
    applyFallbackOutcome: assign<MachineContext, any>((context, event) => {
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
    applyAbortOutcome: assign<MachineContext, any>((context, event) => {
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
    recordFailure: assign<MachineContext, any>((context, event) => {
      const ctx = context.agentContext;
      const errorData =
        (event as { data?: unknown; error?: unknown })?.data ??
        (event as { data?: unknown; error?: unknown })?.error;
      let message = 'Unknown failure';
      if (errorData) {
        if (errorData instanceof Error) {
          message = errorData.message;
        } else if (typeof errorData === 'string') {
          message = errorData;
        } else if (
          typeof errorData === 'object' &&
          errorData !== null &&
          'message' in errorData
        ) {
          message = String((errorData as { message?: unknown }).message);
        }
      }
      console.error('[agentMachine] error', message);
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
    advanceIteration: assign<MachineContext, any>((context) => ({
      iterations: context.iterations + 1,
      snapshot: context.agentContext.getSnapshot(),
    })),
    logPlanError: createErrorLogger('plan'),
    logActError: createErrorLogger('act'),
    logReflectError: createErrorLogger('reflect'),
  };
}

export function createErrorLogger(scope: string) {
  return (_: unknown, event: any) => {
    const payload = event?.data ?? event?.error;
    console.error(`[agentMachine] ${scope} error`, payload);
  };
}
