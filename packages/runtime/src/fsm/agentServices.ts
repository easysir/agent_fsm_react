// @ts-nocheck
import { fromPromise } from "xstate";
import type {
  AgentConfig,
  ExecutionResult,
  PlanStep,
  ReflectOutcome,
} from "../types/index.js";
import { Executor } from "../core/Executor.js";
import type { InvokeInput } from "./agentTypes.js";

export function createPlannerService(config: AgentConfig) {
  return fromPromise<PlanStep, InvokeInput>(async ({ input }) => {
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
      const planStep = await config.planner.plan(snapshot);
      return planStep;
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
    if (!context?.planStep) {
      throw new Error("Missing plan step when attempting execution");
    }
    try {
      return await executor.execute(context.planStep, context.snapshot);
    } catch (error) {
      throw error instanceof Error
        ? error
        : new Error(String(error ?? "Executor rejected without value"));
    }
  });
}

export function createReflectorService(config: AgentConfig) {
  return fromPromise<ReflectOutcome, InvokeInput>(async ({ input }) => {
    const { context } = input ?? {};
    if (!context?.planStep) {
      throw new Error("Reflector invoked without plan step");
    }
    try {
      return await config.reflector.reflect({
        planStep: context.planStep,
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
