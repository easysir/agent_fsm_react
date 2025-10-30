/**
 * SimpleReflector 是一个基础的反思器实现，用于在工具执行完成后根据观察结果决定代理的下一步动作。
 *
 * 主要职责：
 * 1. 根据工具执行的观察结果判断是否需要重试、继续规划、直接完成或终止。
 * 2. 当执行成功时，负责把对应任务标记为成功，并告知是否还有未完成的子任务。
 * 3. 返回给状态机一个结构化的 ReflectOutcome，指导状态机下一阶段（retry/continue/complete/abort）。
 *
 * 工作流程：
 * - 如果没有观察结果或观察失败，并且未达到重试上限，则返回 retry，提示重新执行此次 plan。
 * - 如果失败且重试次数已耗尽，则返回 abort，并附带失败原因，状态机会走结束流程。
 * - 如果执行成功，则更新任务状态为 succeeded，同时检查是否还有未完成的子任务：
 *     - 没有剩余子任务：返回 complete，状态机会进入终结态。
 *     - 仍有子任务待完成：返回 continue，提示 planner 继续计划后续任务。
 */
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
