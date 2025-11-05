import type {
  AgentContextSnapshot,
  ExecutionResult,
  Observation,
  PlanStep,
} from "../types/index.js";
import type {
  ContextManager,
  PlannerContextFormatOptions,
  PlanningContext,
} from "./DefaultContextManager.interface.js";

export interface DefaultContextManagerOptions {
  /**
   * 控制在规划阶段提供给 LLM 的观测条数上限。
   * 默认为 5，与原有实现保持一致。
   */
  maxRecentObservations?: number;
}

/**
 * DefaultContextManager 负责在不改变业务行为的前提下，
 * 将 AgentContextSnapshot 转换为 Planner 所需的上下文视图。
 * 未来若需要引入记忆压缩、长期记忆检索等能力，可以通过实现 ContextManager 接口替换本类。
 */
export class DefaultContextManager implements ContextManager {
  private readonly maxRecentObservations: number;

  constructor(options?: DefaultContextManagerOptions) {
    this.maxRecentObservations = options?.maxRecentObservations ?? 5;
  }

  async preparePlanningContext(
    snapshot: AgentContextSnapshot
  ): Promise<PlanningContext> {
    const recentObservations = Array.isArray(snapshot.observations)
      ? snapshot.observations.slice(-this.maxRecentObservations)
      : [];

    return {
      snapshot,
      recentObservations,
      workingMemory: snapshot.workingMemory ?? {},
      metadata: snapshot.metadata ?? {},
    };
  }

  async recordPlanStep(
    _plan: PlanStep,
    _snapshot: AgentContextSnapshot
  ): Promise<void> {
    // 默认实现不执行额外处理，留给自定义 ContextManager 扩展。
  }

  async recordExecutionResult(
    _result: ExecutionResult,
    _snapshot: AgentContextSnapshot
  ): Promise<void> {
    // 默认实现不执行额外处理，留给自定义 ContextManager 扩展。
  }

  async recordObservation(
    _observation: Observation | null,
    _snapshot: AgentContextSnapshot
  ): Promise<void> {
    // 默认实现不执行额外处理，留给自定义 ContextManager 扩展。
  }

  formatPlanningContext(
    planningContext: PlanningContext,
    options: PlannerContextFormatOptions
  ): string {
    const { snapshot, recentObservations, workingMemory, metadata } =
      planningContext;
    const activeTaskId = snapshot.activeTaskId ?? snapshot.rootTaskId;
    const activeTask = snapshot.tasks[activeTaskId];
    const taskSummaries = Object.values(snapshot.tasks)
      .map(
        (task) =>
          `- ${task.taskId} [${task.status}]${
            task.taskId === activeTaskId ? " (active)" : ""
          }: ${task.description}`
      )
      .join("\n");
    const observations = recentObservations.map((obs) => ({
      taskId: obs.relatedTaskId,
      success: obs.success,
      source: obs.source,
      payload: obs.payload,
    }));
    const toolSummaries =
      options.tools.length > 0
        ? options.tools
            .map((tool) => `- ${tool.id}: ${tool.description}`)
            .join("\n")
        : `- No registered tools (fallback to ${options.fallbackToolId ?? "echo"}).`;

    return [
      `Active task ID: ${activeTaskId}`,
      `Active task description: ${activeTask?.description ?? "Unknown task"}`,
      `Active task status: ${activeTask?.status ?? "pending"}`,
      "",
      "Task tree:",
      taskSummaries,
      "",
      `Recent observations (latest up to ${this.maxRecentObservations}): ${JSON.stringify(
        observations,
        null,
        2
      )}`,
      `Working memory: ${JSON.stringify(workingMemory ?? {}, null, 2)}`,
      `Agent metadata: ${JSON.stringify(metadata ?? {}, null, 2)}`,
      "",
      "Available tools:",
      toolSummaries,
    ].join("\n");
  }
}
