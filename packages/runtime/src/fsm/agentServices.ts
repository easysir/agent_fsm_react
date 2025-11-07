// @ts-nocheck
import { fromPromise } from "xstate";
import type {
  AgentConfig,
  ExecutionResult,
  PlannerResult,
  ReflectionResult,
} from "../types/index.js";
import { Executor } from "../core/Executor.js";
import type { InvokeInput } from "./agentTypes.js";

export function createPlannerService(config: AgentConfig) {
  return fromPromise<PlannerResult, InvokeInput>(async ({ input }) => {
    const { context } = input ?? {};
    if (!context) {
      throw new Error("Planner invoke received no context");
    }
    const snapshot =
      context.snapshot ?? context.agentContext?.getSnapshot() ?? null;
    if (!snapshot) {
      throw new Error("Planner invoked without snapshot");
    }
    try {
      const plannerResult = await config.planner.plan(snapshot);
      return plannerResult;
    } catch (error) {
      throw error instanceof Error
        ? error
        : new Error(String(error ?? "Planner rejected without value"));
    }
  });
}

export function createExecutorService(executor: Executor) {
  return fromPromise<ExecutionResult, InvokeInput>(async ({ input }) => {
    const { context } = input ?? {};
    if (
      !context?.masterPlan ||
      context.currentStepIndex === null ||
      !context.currentStep
    ) {
      throw new Error("Missing master plan or current step for execution");
    }
    try {
      return await executor.execute({
        plan: context.masterPlan,
        stepIndex: context.currentStepIndex,
        step: context.currentStep,
        snapshot: context.snapshot,
      });
    } catch (error) {
      throw error instanceof Error
        ? error
        : new Error(String(error ?? "Executor rejected without value"));
    }
  });
}

export function createReflectorService(config: AgentConfig) {
  return fromPromise<ReflectionResult, InvokeInput>(async ({ input }) => {
    const { context } = input ?? {};
    if (!context?.masterPlan || !context.currentStep) {
      throw new Error("Reflector invoked without master plan");
    }
    try {
      return await config.reflector.reflect({
        plan: context.masterPlan,
        currentStep: context.currentStep,
        observation: context.observation,
        context: context.snapshot,
        attempt: context.attempt + 1,
      });
    } catch (error) {
      throw error instanceof Error
        ? error
        : new Error(String(error ?? "Reflector rejected without value"));
    }
  });
}
