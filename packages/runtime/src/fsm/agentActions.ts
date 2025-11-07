// @ts-nocheck
import { assign } from "xstate";
import type {
  AgentConfig,
  AgentContextSnapshot,
  ExecutionResult,
  MasterPlan,
  PlanItem,
  PlannerResult,
  ReflectionResult,
  Observation,
  TaskNode,
} from "../types/index.js";
import type { MachineContext } from "./agentTypes.js";
import type { ContextManager } from "../context/BridgeContextManager.interface.js";

function resolveCurrentStep(plan: MasterPlan | null): {
  step: PlanItem | null;
  index: number | null;
} {
  if (!plan) {
    return { step: null, index: null };
  }
  const index = plan.currentIndex;
  if (index < 0 || index >= plan.steps.length) {
    return { step: null, index: null };
  }
  return { step: plan.steps[index], index };
}

export function createActions(
  guardConfig: AgentConfig["guard"],
  contextManager?: ContextManager
) {
  const warnContextManagerFailure = (scope: string, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[agentMachine] ${scope} context recording failed (${message})`
    );
  };

  const recordObservation = (
    observation: Observation | null,
    snapshot: AgentContextSnapshot
  ): void => {
    if (!contextManager) {
      return;
    }
    void contextManager
      .recordObservation(observation, snapshot)
      .catch((error) => warnContextManagerFailure("observation", error));
  };

  const recordPlannerResult = (
    result: PlannerResult,
    snapshot: AgentContextSnapshot
  ): void => {
    if (!contextManager) {
      return;
    }
    void contextManager
      .recordPlannerResult(result, snapshot)
      .catch((error) => warnContextManagerFailure("planner", error));
  };

  const extractTaskUpdates = (
    metadata: Record<string, unknown> | undefined
  ): TaskNode[] => {
    if (!metadata) {
      return [];
    }
    const updates = (metadata as { taskUpdates?: unknown }).taskUpdates;
    if (!Array.isArray(updates)) {
      return [];
    }
    return updates
      .map((candidate) => {
        if (
          candidate &&
          typeof candidate === "object" &&
          "taskId" in candidate &&
          typeof (candidate as { taskId?: unknown }).taskId === "string"
        ) {
          return candidate as TaskNode;
        }
        return null;
      })
      .filter((value): value is TaskNode => value !== null);
  };

  return {
    checkGuards: ({ context }: { context: MachineContext }) => {
      const elapsed = Date.now() - context.startedAt;
      if (
        typeof guardConfig?.maxDurationMs === "number" &&
        elapsed > guardConfig.maxDurationMs
      ) {
        throw new Error(
          `Agent exceeded max duration ${guardConfig.maxDurationMs}ms`
        );
      }
      if (
        typeof guardConfig?.maxIterations === "number" &&
        context.iterations >= guardConfig.maxIterations
      ) {
        throw new Error(
          `Agent exceeded max iterations ${guardConfig.maxIterations}`
        );
      }
    },
    storePlannerResult: assign(({ context, event }) => {
      const plannerResult = (event as { output?: PlannerResult })?.output;
      if (!plannerResult) {
        return {
          masterPlan: context.masterPlan,
          currentStep: context.currentStep,
          currentStepIndex: context.currentStepIndex,
          executionResult: null,
          observation: null,
          attempt: 0,
        };
      }
      const agentCtx = context.agentContext;
      agentCtx.setMasterPlan(plannerResult.plan);
      const snapshot = agentCtx.getSnapshot();
      recordPlannerResult(plannerResult, snapshot);
      const { step, index } = resolveCurrentStep(plannerResult.plan);
      return {
        masterPlan: plannerResult.plan,
        currentStep: step,
        currentStepIndex: index,
        executionResult: null,
        observation: null,
        attempt: 0,
        snapshot,
      };
    }),
    storeExecutionResult: assign(({ context, event }) => {
      const executionResult =
        (event as { output?: ExecutionResult })?.output ?? null;
      return {
        executionResult,
        snapshot: context.agentContext.getSnapshot(),
      };
    }),
    deriveObservation: assign(({ context }) => {
      const { executionResult, agentContext: ctx } = context;
      if (!executionResult) {
        const snapshot = ctx.getSnapshot();
        recordObservation(null, snapshot);
        return {
          observation: null,
          snapshot,
        };
      }
      const latency = executionResult.result.latencyMs;
      const error = executionResult.result.error;
      const relatedTaskId =
        executionResult.step.relatedTaskId ?? executionResult.step.id;
      const observation: Observation = {
        source: "tool",
        relatedTaskId,
        timestamp: Date.now(),
        payload: {
          ...executionResult.result.output,
        },
        success: executionResult.result.success,
        ...(typeof latency === "number" ? { latencyMs: latency } : {}),
        ...(typeof error === "string" ? { error } : {}),
      };
      ctx.addObservation(observation);
      const snapshot = ctx.getSnapshot();
      recordObservation(observation, snapshot);
      return {
        observation,
        snapshot,
      };
    }),
    commitReflectionResult: assign(({ context, event }) => {
      const reflection = (event as { output?: ReflectionResult })?.output;
      const agentCtx = context.agentContext;
      if (!reflection) {
        return {
          iterations: context.iterations + 1,
          snapshot: agentCtx.getSnapshot(),
        };
      }
      agentCtx.setMasterPlan(reflection.plan);
      const taskUpdates = extractTaskUpdates(reflection.metadata);
      if (taskUpdates.length > 0) {
        taskUpdates.forEach((task) => agentCtx.upsertTask(task));
      }
      if (reflection.message) {
        agentCtx.mergeWorkingMemory({ reflectMessage: reflection.message });
      }
      const snapshot = agentCtx.getSnapshot();
      const { step, index } = resolveCurrentStep(reflection.plan);
      return {
        masterPlan: reflection.plan,
        currentStep: step,
        currentStepIndex: index,
        iterations: context.iterations + 1,
        snapshot,
        attempt:
          reflection.directive === "retry" ||
          reflection.directive === "fallback"
            ? context.attempt + 1
            : 0,
      };
    }),
    advanceIteration: assign(({ context }) => ({
      iterations: context.iterations + 1,
      snapshot: context.agentContext.getSnapshot(),
    })),
    recordFailure: assign(({ context, event }) => {
      const ctx = context.agentContext;
      const errorData =
        (event as { data?: unknown; error?: unknown })?.data ??
        (event as { data?: unknown; error?: unknown })?.error;
      let message = "Unknown failure";
      if (errorData) {
        if (errorData instanceof Error) {
          message = errorData.message;
        } else if (typeof errorData === "string") {
          message = errorData;
        } else if (
          typeof errorData === "object" &&
          errorData !== null &&
          "message" in errorData
        ) {
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
      console.log("[agentMachine] finish");
    },
    handleError: () => {
      // hook for runtime error handling
    },
    logPlanError: createErrorLogger("plan"),
    logActError: createErrorLogger("act"),
    logReflectError: createErrorLogger("reflect"),
    logMissingPlanItem: ({ context }: { context: MachineContext }) => {
      console.warn("[agentMachine] skip reflect, missing plan item", {
        failures: context.failures,
        iterations: context.iterations,
      });
    },
  };
}

export function createErrorLogger(scope: string) {
  return ({ event }: { event: any }) => {
    const payload = event?.data ?? event?.error;
    console.error(`[agentMachine] ${scope} error`, payload);
  };
}
