import { z } from "zod";
import type {
  AgentContextSnapshot,
  PlanStep,
  Planner,
  ToolAdapter,
  ToolRegistry,
} from "../types/index.js";
import {
  ChatModelClient,
  type ChatMessage,
  type ChatModelClientOptions,
  type ChatModelProvider,
} from "../llm/ChatModelClient.js";
import { DefaultContextManager } from "../context/DefaultContextManager.js";
import type {
  ContextManager,
  PlanningContext,
  PlannerToolSummary,
} from "../context/DefaultContextManager.interface.js";

type ToolSummary = PlannerToolSummary;

export interface SimplePlannerOptions {
  llmClient?: ChatModelClient;
  llm?: ChatModelClientOptions;
  provider?: ChatModelProvider;
  apiKey?: string | null;
  baseURL?: string;
  model?: string;
  requestTimeoutMs?: number;
  systemPrompt?: string;
  toolRegistry?: ToolRegistry;
  defaultToolId?: string;
  planTimeoutMs?: number;
  defaultRetryLimit?: number;
  contextManager?: ContextManager;
}

const DEFAULT_SYSTEM_PROMPT = [
  "You are a focused planning assistant for an autonomous agent.",
  "Use the provided task context, observations, and available tools to craft the next step.",
  "Return a strict JSON object with the following keys:",
  "goal, toolCandidates, successCriteria, timeoutMs, retryLimit, next, toolParameters.",
  "Only reference tool identifiers that were provided.",
  "Select tools by listing their ids in toolCandidates, ordered by preference.",
  "toolCandidates must list preferred tool ids only. Do not fabricate new tool identifiers.",
  "If the current step should immediately execute a tool, include it in toolCandidates and keep next as an array of task ids (strings).",
  "Do not place objects inside the next array; it must only contain strings representing task ids.",
  'Provide tool-specific inputs under toolParameters as a JSON object (e.g., toolParameters: { "expression": "..." }).',
  "If no follow-up tasks are ready, return an empty array for next.",
].join(" ");

const DEFAULT_PLAN_TIMEOUT_MS = 5_000;
const DEFAULT_RETRY_LIMIT = 2;

const PlanSchema = z.object({
  goal: z.string().min(1),
  toolCandidates: z.array(z.string().min(1)).nonempty(),
  successCriteria: z.string().min(1),
  timeoutMs: z.number().int().positive().optional(),
  retryLimit: z.number().int().nonnegative().optional(),
  next: z.array(z.string().min(1)).optional(),
  toolParameters: z.record(z.string(), z.unknown()).optional(),
});

const PlanPayloadSchema = z.union([
  PlanSchema,
  z.object({
    plan: PlanSchema,
  }),
]);

type ParsedPlan = z.infer<typeof PlanSchema>;

export class SimplePlanner implements Planner {
  private readonly llmClient: ChatModelClient;

  private readonly systemPrompt: string;

  private readonly toolRegistry: ToolRegistry | undefined;

  private readonly defaultToolId: string | null;

  private readonly planTimeoutMs: number;

  private readonly defaultRetryLimit: number;

  private contextManager: ContextManager;

  constructor(options?: SimplePlannerOptions) {
    this.systemPrompt = options?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    this.toolRegistry = options?.toolRegistry;
    this.defaultToolId = options?.defaultToolId ?? "echo";
    this.planTimeoutMs = options?.planTimeoutMs ?? DEFAULT_PLAN_TIMEOUT_MS;
    this.defaultRetryLimit = options?.defaultRetryLimit ?? DEFAULT_RETRY_LIMIT;
    this.contextManager =
      options?.contextManager ?? new DefaultContextManager();

    const legacyLlmOptions = collectLegacyLlmOptions(options);
    const mergedLlmOptions: ChatModelClientOptions = {
      ...legacyLlmOptions,
      ...(options?.llm ?? {}),
    };

    this.llmClient =
      options?.llmClient ?? new ChatModelClient(mergedLlmOptions);
  }

  public setContextManager(contextManager: ContextManager): void {
    this.contextManager = contextManager;
  }

  public getContextManager(): ContextManager {
    return this.contextManager;
  }

  async plan(context: AgentContextSnapshot): Promise<PlanStep> {
    const fallback = this.buildFallbackPlan(context);

    if (!this.llmClient.isConfigured()) {
      console.warn(
        `[SimplePlanner] Missing API key for ${this.llmClient.getProvider()}, using fallback plan.`
      );
      await this.persistPlanStep(fallback, context);
      return fallback;
    }

    let planningContext: PlanningContext | null = null;
    let contextualFallback: PlanStep = fallback;
    try {
      const tools = this.getAvailableTools();
      planningContext = await this.contextManager.preparePlanningContext(
        context
      );
      contextualFallback =
        planningContext.snapshot === context
          ? fallback
          : this.buildFallbackPlan(planningContext.snapshot);
      const prompt = this.buildPrompt(planningContext, tools);
      const messages: ChatMessage[] = [
        { role: "system", content: this.systemPrompt },
        { role: "user", content: prompt },
      ];
      const content = await this.llmClient.complete(messages, {
        responseFormat: "json_object",
        temperature: 0.2,
        maxTokens: 600,
      });
      const parsed = this.parsePlanResponse(content);
      const nextPlan = this.mergePlan(
        planningContext.snapshot,
        parsed,
        tools,
        contextualFallback
      );
      // TODO: 如果 ContextManager 的落盘策略变重，这里需要优化为异步提交以避免阻塞规划流程。
      await this.persistPlanStep(nextPlan, planningContext.snapshot);
      return nextPlan;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[SimplePlanner] LLM planning failed (${message}). Using fallback plan.`
      );
      await this.persistPlanStep(
        planningContext ? contextualFallback : fallback,
        planningContext?.snapshot ?? context
      );
      return planningContext ? contextualFallback : fallback;
    }
  }

  private buildFallbackPlan(context: AgentContextSnapshot): PlanStep {
    const activeTaskId = context.activeTaskId ?? context.rootTaskId;
    const activeTask = context.tasks[activeTaskId];
    if (!activeTask) {
      throw new Error(`Active task ${activeTaskId} not found in context`);
    }
    const tools = this.getAvailableTools();
    const toolCandidates =
      tools.length > 0
        ? tools.map((tool) => tool.id)
        : this.defaultToolId
        ? [this.defaultToolId]
        : ["echo"];

    return {
      taskId: activeTaskId,
      goal: activeTask.description,
      toolCandidates,
      successCriteria: "Tool execution returns success=true",
      timeoutMs: this.planTimeoutMs,
      next: activeTask.children,
      retryLimit: this.defaultRetryLimit,
    };
  }

  private getAvailableTools(): ToolSummary[] {
    if (!this.toolRegistry) {
      return this.defaultToolId
        ? [{ id: this.defaultToolId, description: "Default fallback tool" }]
        : [];
    }
    const tools: ToolAdapter[] = this.toolRegistry.list();
    if (tools.length === 0 && this.defaultToolId) {
      return [{ id: this.defaultToolId, description: "Default fallback tool" }];
    }
    return tools.map((tool) => ({
      id: tool.id,
      description: tool.description,
    }));
  }

  private buildPrompt(
    planningContext: PlanningContext,
    tools: ToolSummary[]
  ): string {
    const contextText = this.contextManager.formatPlanningContext(
      planningContext,
      { tools, fallbackToolId: this.defaultToolId }
    );
    const activeTaskId =
      planningContext.snapshot.activeTaskId ??
      planningContext.snapshot.rootTaskId;
    return [
      contextText,
      "",
      `Ensure the response keeps the active task ID as "${activeTaskId}".`,
      "Follow the system instructions above when constructing the JSON plan.",
    ].join("\n");
  }

  private parsePlanResponse(content: string): ParsedPlan {
    const jsonText = this.extractJsonPayload(content);
    const raw = JSON.parse(jsonText);
    const parsed = PlanPayloadSchema.parse(raw);
    if ("plan" in parsed) {
      return parsed.plan;
    }
    return parsed;
  }

  private mergePlan(
    context: AgentContextSnapshot,
    plan: ParsedPlan,
    tools: ToolSummary[],
    fallback: PlanStep
  ): PlanStep {
    // 该方法负责把 LLM 输出的原始 plan 结果与当前上下文、可用工具列表以及兜底策略进行融合，
    // 生成最终可执行的 PlanStep。处理流程：
    // 1. 锚定当前激活任务，确保 taskId 正确；
    // 2. 过滤掉未注册的工具候选，如为空则回退到 fallback；
    // 3. 校验 timeout/retryLimit 等数值，缺失时使用兜底值；
    // 4. 整理 next/参数信息，为后续步骤保留作业线索。
    const activeTaskId = context.activeTaskId ?? context.rootTaskId;
    const allowedTools = new Set(tools.map((tool) => tool.id));
    // 过滤工具候选：去除空字符串、剔除未注册工具
    const normalizedCandidates = plan.toolCandidates
      .map((candidate) => candidate.trim())
      .filter(
        (candidate) => candidate.length > 0 && allowedTools.has(candidate)
      );

    if (normalizedCandidates.length === 0) {
      normalizedCandidates.push(...fallback.toolCandidates);
    }

    const timeoutMsCandidate =
      typeof plan.timeoutMs === "number" &&
      Number.isFinite(plan.timeoutMs) &&
      plan.timeoutMs > 0
        ? plan.timeoutMs
        : fallback.timeoutMs;

    const retryLimitCandidate =
      typeof plan.retryLimit === "number" &&
      Number.isFinite(plan.retryLimit) &&
      plan.retryLimit >= 0
        ? plan.retryLimit
        : fallback.retryLimit;

    const nextCandidate =
      Array.isArray(plan.next) && plan.next.length > 0
        ? plan.next.filter((id) => typeof id === "string" && id.length > 0)
        : fallback.next;

    const nextPlan: PlanStep = {
      // 将 plan 与上下文融合，始终使用当前激活任务 ID
      taskId: activeTaskId,
      goal: plan.goal.trim(),
      toolCandidates: Array.from(new Set(normalizedCandidates)),
      successCriteria: plan.successCriteria.trim(),
    };

    if (typeof timeoutMsCandidate === "number") {
      // 仅在合法数值时设置超时时间
      nextPlan.timeoutMs = timeoutMsCandidate;
    }

    if (typeof retryLimitCandidate === "number") {
      // 同理：重试次数不存在或非法时沿用 fallback
      nextPlan.retryLimit = retryLimitCandidate;
    }

    if (Array.isArray(nextCandidate) && nextCandidate.length > 0) {
      // next 表示后续计划要激活的任务 ID 列表
      nextPlan.next = nextCandidate;
    }

    if (
      plan.toolParameters &&
      typeof plan.toolParameters === "object" &&
      Object.keys(plan.toolParameters).length > 0
    ) {
      // 工具参数直接透传，供执行器调用工具时使用
      nextPlan.toolParameters = plan.toolParameters;
    }

    return nextPlan;
  }

  private async persistPlanStep(
    plan: PlanStep,
    snapshot: AgentContextSnapshot
  ): Promise<void> {
    try {
      await this.contextManager.recordPlanStep(plan, snapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[SimplePlanner] Failed to record plan step via ContextManager (${message})`
      );
    }
  }

  private extractJsonPayload(content: string): string {
    const fenced = content.match(/```json\s*([\s\S]+?)```/i);
    if (fenced) {
      return fenced[1];
    }
    const altFence = content.match(/```([\s\S]+?)```/);
    if (altFence) {
      return altFence[1];
    }
    return content.trim();
  }
}

function collectLegacyLlmOptions(
  options?: SimplePlannerOptions
): ChatModelClientOptions {
  if (!options) {
    return {};
  }

  const result: ChatModelClientOptions = {};

  if (options.provider) {
    result.provider = options.provider;
  }
  if (options.apiKey !== undefined) {
    result.apiKey = options.apiKey;
  }
  if (options.baseURL) {
    result.baseURL = options.baseURL;
  }
  if (options.model) {
    result.model = options.model;
  }
  if (typeof options.requestTimeoutMs === "number") {
    result.requestTimeoutMs = options.requestTimeoutMs;
  }

  return result;
}
