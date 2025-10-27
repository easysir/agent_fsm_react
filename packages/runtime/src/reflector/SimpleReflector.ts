import type { Reflector, ReflectInput, ReflectOutcome, TaskNode } from '../types/index.js';

export class SimpleReflector implements Reflector {
  async reflect(input: ReflectInput): Promise<ReflectOutcome> {
    const { observation, planStep, attempt } = input;

    if (!observation || !observation.success) {
      if (attempt < (planStep.retryLimit ?? 1)) {
        return {
          status: 'retry',
          message: 'Observation missing or failed, retrying',
        };
      }
      return {
        status: 'abort',
        message: 'Observation failed and retries exhausted',
      };
    }

    const updatedTask: TaskNode = {
      ...input.context.tasks[planStep.taskId],
      status: 'succeeded',
      updatedAt: Date.now(),
      children: input.context.tasks[planStep.taskId].children,
    };

    const remainingChildren = updatedTask.children.filter(
      (childId) => input.context.tasks[childId]?.status !== 'succeeded',
    );

    if (remainingChildren.length === 0) {
      return {
        status: 'complete',
        message: 'Task completed successfully',
        updatedTasks: [updatedTask],
      };
    }

    return {
      status: 'continue',
      message: 'Child tasks remain, continue planning',
      updatedTasks: [updatedTask],
    };
  }
}
