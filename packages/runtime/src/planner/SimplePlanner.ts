import type { Planner, PlanStep, AgentContextSnapshot } from '../types/index.js';

export class SimplePlanner implements Planner {
  async plan(context: AgentContextSnapshot): Promise<PlanStep> {
    const activeTaskId = context.activeTaskId ?? context.rootTaskId;
    const activeTask = context.tasks[activeTaskId];
    return {
      taskId: activeTaskId,
      goal: activeTask.description,
      toolCandidates: ['echo'],
      successCriteria: 'Tool execution returns success=true',
      timeoutMs: 5_000,
      next: activeTask.children,
      retryLimit: 2,
    };
  }
}
