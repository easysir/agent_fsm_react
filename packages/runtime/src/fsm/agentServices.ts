// @ts-nocheck
import { fromPromise } from 'xstate';
import type {
  AgentConfig,
  ExecutionResult,
  PlanStep,
  ReflectOutcome,
} from '../types/index.js';
import { Executor } from '../core/Executor.js';
import type { InvokeInput } from './agentTypes.js';

export function createPlannerService(config: AgentConfig) {
  return fromPromise<PlanStep, InvokeInput>(async ({ input }) => {
    const { context } = input ?? {};
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
  });
}

export function createExecutorService(executor: Executor) {
  return fromPromise<ExecutionResult, InvokeInput>(async ({ input }) => {
    const { context } = input ?? {};
    if (!context?.planStep) {
      throw new Error('Missing plan step when attempting execution');
    }
    return executor.execute(context.planStep, context.snapshot);
  });
}

export function createReflectorService(config: AgentConfig) {
  return fromPromise<ReflectOutcome, InvokeInput>(async ({ input }) => {
    const { context } = input ?? {};
    if (!context?.planStep) {
      throw new Error('Reflector invoked without plan step');
    }
    return config.reflector.reflect({
      planStep: context.planStep,
      observation: context.observation,
      context: context.snapshot,
      attempt: context.attempt + 1,
    });
  });
}
