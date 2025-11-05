import type {
  AgentContextSnapshot,
  ExecutionResult,
  Observation,
  PlanStep,
} from "../types/index.js";

export interface PlanningContext {
  /** 原始的 AgentContext 快照，用于访问任务树等结构信息 */
  snapshot: AgentContextSnapshot;
  /** 经过策略筛选的近期观测数据 */
  recentObservations: Observation[];
  /** 可供 planner 使用的工作记忆视图 */
  workingMemory: Record<string, unknown>;
  /** 经过必要裁剪或扩充的元数据 */
  metadata: Record<string, unknown>;
  /** 额外的扩展字段，留给自定义策略使用 */
  additionalContext?: Record<string, unknown>;
}

export interface PlannerToolSummary {
  id: string;
  description: string;
}

export interface PlannerContextFormatOptions {
  tools: PlannerToolSummary[];
  fallbackToolId?: string | null;
}

export interface ContextManager {
  /** 为规划阶段准备上下文数据，可以在内部执行记忆压缩、检索等操作 */
  preparePlanningContext(
    snapshot: AgentContextSnapshot
  ): Promise<PlanningContext>;
  /** 记录一次规划结果，便于后续的记忆管理或统计 */
  recordPlanStep(
    plan: PlanStep,
    snapshot: AgentContextSnapshot
  ): Promise<void>;
  /** 记录一次工具执行结果 */
  recordExecutionResult(
    result: ExecutionResult,
    snapshot: AgentContextSnapshot
  ): Promise<void>;
  /** 记录一次观测数据（可能为空） */
  recordObservation(
    observation: Observation | null,
    snapshot: AgentContextSnapshot
  ): Promise<void>;
  /** 将通用上下文格式化为规划阶段的文本描述 */
  formatPlanningContext(
    planningContext: PlanningContext,
    options: PlannerContextFormatOptions
  ): string;
}
