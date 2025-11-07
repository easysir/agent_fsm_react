import { z } from "zod";

export const PlanItemStatusSchema = z.enum([
  "pending", // 未排到执行队列
  "ready", // 已满足依赖、等待执行
  "in_progress", // 正在执行
  "blocked", // 被依赖或错误阻塞
  "succeeded", // 已成功完成
  "failed", // 执行失败
  "skipped", // 被跳过
]);

export const PlanItemToolSchema = z.object({
  /** 工具唯一标识，执行器将依据该值选择工具 */
  toolId: z.string().min(1),
  /** 可选：给 UI/日志展示的工具说明 */
  description: z.string().min(1).optional(),
  /** 可选：调用工具时需要的结构化参数 */
  parameters: z.record(z.string(), z.unknown()).optional(),
});

export const PlanItemRetrySchema = z
  .object({
    /** 可选：允许的最大重试次数 */
    limit: z.number().int().nonnegative().optional(),
    /** 可选：重试策略（无等待/立即/线性/指数） */
    strategy: z.enum(["none", "immediate", "linear", "exponential"]).optional(),
    /** 可选：重试间隔（毫秒） */
    intervalMs: z.number().int().positive().optional(),
  })
  .strict();

export const PlanItemSchema = z
  .object({
    /** 计划项唯一标识，需在重规划后保持稳定 */
    id: z.string().min(1),
    /** UI 友好的标题，用于展示当前步骤目标 */
    title: z.string().min(1),
    /** 可选：更详细的文字描述 */
    description: z.string().optional(),
    /** 当前计划项状态，由执行器/反思器更新 */
    status: PlanItemStatusSchema,
    /** 可选：关联的任务树节点 ID */
    relatedTaskId: z.string().min(1).optional(),
    /** 待执行的工具序列（按优先级排序） */
    toolSequence: z.array(PlanItemToolSchema).min(1),
    /** 判断计划项成功的条件列表 */
    successCriteria: z.array(z.string().min(1)).min(1),
    /** 可选：针对该计划项的重试策略 */
    retry: PlanItemRetrySchema.optional(),
    /** 可选：下游消费者可使用的自定义元数据 */
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const MasterPlanHistoryEventSchema = z.enum([
  "created", // 初次创建
  "pointer_advanced", // 指针推进
  "step_updated", // 步骤状态更新
  "replanned", // 重新规划
  "status_changed", // 整体状态变更
]);

export const MasterPlanHistoryEntrySchema = z
  .object({
    /** 递增的历史版本号，从 1 开始 */
    version: z.number().int().min(1),
    /** 记录发生时间（毫秒时间戳） */
    timestamp: z.number().int().nonnegative(),
    /** 变更事件类型 */
    event: MasterPlanHistoryEventSchema,
    /** 可选：变更的简述 */
    summary: z.string().optional(),
    /** 可选：补充说明的结构化数据 */
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const MasterPlanStatusSchema = z.enum([
  "draft", // 初稿，尚未执行
  "ready", // 已准备就绪
  "in_progress", // 正在执行
  "blocked", // 被阻塞
  "completed", // 全部完成
  "failed", // 执行失败
  "aborted", // 被中止
]);

export const MasterPlanSchema = z
  .object({
    /** 主计划唯一标识，用于串联执行与反思 */
    planId: z.string().min(1),
    /** 有序的计划步骤数组 */
    steps: z.array(PlanItemSchema).min(1),
    /** 当前指针所指向的步骤索引 */
    currentIndex: z.number().int().min(0),
    /** 主计划整体状态 */
    status: MasterPlanStatusSchema,
    /** 可选：规划时给出的整体推理说明 */
    reasoning: z.string().optional(),
    /** 可选：提供给用户/界面的友好提示 */
    userMessage: z.string().optional(),
    /** 创建时间戳（毫秒） */
    createdAt: z.number().int().nonnegative(),
    /** 最近一次更新时间戳（毫秒） */
    updatedAt: z.number().int().nonnegative(),
    /** 可选：记录计划演进过程的历史条目 */
    history: z.array(MasterPlanHistoryEntrySchema).optional(),
    /** 可选：主计划额外的扩展元数据 */
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .refine(
    (plan) =>
      plan.currentIndex >= 0 && plan.currentIndex < plan.steps.length,
    {
      path: ["currentIndex"],
      message: "currentIndex must reference an existing plan step",
    }
  );

export const PlannerResultSchema = z
  .object({
    /** 本轮规划生成的完整 MasterPlan */
    plan: MasterPlanSchema,
    /** 规划产出时间戳（毫秒） */
    issuedAt: z.number().int().nonnegative(),
    /** 可选：描述本次变更的历史条目 */
    historyEntry: MasterPlanHistoryEntrySchema.optional(),
    /** 可选：用于排查/调试的额外信息 */
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const ReflectionDirectiveSchema = z.enum([
  "advance", // 前进到下一步
  "retry", // 重试当前步骤
  "fallback", // 使用兜底策略
  "await_user", // 等待用户输入
  "abort", // 中止整个流程
  "complete", // 流程已结束
  "replan", // 需要重新规划
]);

export const ReflectionResultSchema = z
  .object({
    /** 反思后的运行时指令 */
    directive: ReflectionDirectiveSchema,
    /** 应用反思后得到的最新 MasterPlan 快照 */
    plan: MasterPlanSchema,
    /** 可选：记录此次反思变更的历史条目 */
    historyEntry: MasterPlanHistoryEntrySchema.optional(),
    /** 可选：人类可读的提示信息 */
    message: z.string().optional(),
    /** 可选：补充给下游消费者的元数据 */
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type PlanItemStatus = z.infer<typeof PlanItemStatusSchema>;
export type PlanItemTool = z.infer<typeof PlanItemToolSchema>;
export type PlanItemRetry = z.infer<typeof PlanItemRetrySchema>;
export type PlanItem = z.infer<typeof PlanItemSchema>;
export type MasterPlanHistoryEvent = z.infer<
  typeof MasterPlanHistoryEventSchema
>;
export type MasterPlanHistoryEntry = z.infer<
  typeof MasterPlanHistoryEntrySchema
>;
export type MasterPlanStatus = z.infer<typeof MasterPlanStatusSchema>;
export type MasterPlan = z.infer<typeof MasterPlanSchema>;
export type PlannerResult = z.infer<typeof PlannerResultSchema>;
export type ReflectionDirective = z.infer<typeof ReflectionDirectiveSchema>;
export type ReflectionResult = z.infer<typeof ReflectionResultSchema>;
