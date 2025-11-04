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
}

interface ToolSummary {
  id: string;
  description: string;
}

const DEFAULT_SYSTEM_PROMPT = [
  "You are a focused planning assistant for an autonomous agent.",
  "Use the provided task context, observations, and available tools to craft the next step.",
  "Return a strict JSON object with the following keys:",
  "goal, toolCandidates, successCriteria, timeoutMs, retryLimit, next, toolParameters.",
  "Only reference tool identifiers that were provided.",
  "Select tools by listing their ids in toolCandidates, ordered by preference.",
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

  constructor(options?: SimplePlannerOptions) {
    this.systemPrompt = options?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    this.toolRegistry = options?.toolRegistry;
    this.defaultToolId = options?.defaultToolId ?? "echo";
    this.planTimeoutMs = options?.planTimeoutMs ?? DEFAULT_PLAN_TIMEOUT_MS;
    this.defaultRetryLimit = options?.defaultRetryLimit ?? DEFAULT_RETRY_LIMIT;

    const legacyLlmOptions = collectLegacyLlmOptions(options);
    const mergedLlmOptions: ChatModelClientOptions = {
      ...legacyLlmOptions,
      ...(options?.llm ?? {}),
    };

    this.llmClient =
      options?.llmClient ?? new ChatModelClient(mergedLlmOptions);
  }

  async plan(context: AgentContextSnapshot): Promise<PlanStep> {
    const fallback = this.buildFallbackPlan(context);

    if (!this.llmClient.isConfigured()) {
      console.warn(
        `[SimplePlanner] Missing API key for ${this.llmClient.getProvider()}, using fallback plan.`
      );
      return fallback;
    }

    try {
      const tools = this.getAvailableTools();
      const prompt = this.buildPrompt(context, tools);
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

      return this.mergePlan(context, parsed, tools, fallback);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[SimplePlanner] LLM planning failed (${message}). Using fallback plan.`
      );
      return fallback;
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
    context: AgentContextSnapshot,
    tools: ToolSummary[]
  ): string {
    const activeTaskId = context.activeTaskId ?? context.rootTaskId;
    const activeTask = context.tasks[activeTaskId];
    const taskSummaries = Object.values(context.tasks)
      .map(
        (task) =>
          `- ${task.taskId} [${task.status}]${
            task.taskId === activeTaskId ? " (active)" : ""
          }: ${task.description}`
      )
      .join("\n");
    const observations = context.observations.slice(-5).map((obs) => ({
      taskId: obs.relatedTaskId,
      success: obs.success,
      source: obs.source,
      payload: obs.payload,
    }));
    const toolSummaries =
      tools.length > 0
        ? tools.map((tool) => `- ${tool.id}: ${tool.description}`).join("\n")
        : "- No registered tools (fallback to echo).";

    return [
      `Active task ID: ${activeTaskId}`,
      `Active task description: ${activeTask?.description ?? "Unknown task"}`,
      `Active task status: ${activeTask?.status ?? "pending"}`,
      "",
      "Task tree:",
      taskSummaries,
      "",
      `Recent observations (latest up to 5): ${JSON.stringify(
        observations,
        null,
        2
      )}`,
      `Working memory: ${JSON.stringify(context.workingMemory ?? {}, null, 2)}`,
      `Agent metadata: ${JSON.stringify(context.metadata ?? {}, null, 2)}`,
      "",
      "Available tools:",
      toolSummaries,
      "",
      "Return a strict JSON object with the keys: goal, toolCandidates, successCriteria, timeoutMs, retryLimit, next, toolParameters.",
      `Use only tool identifiers from the provided list. The active task ID must remain "${activeTaskId}".`,
      "toolCandidates must list preferred tool ids only. Do not fabricate new tool identifiers.",
      'The "next" field must be an array of task id strings only. Never include objects, parameters, or tool names inside "next".',
      'If you want the agent to execute a tool immediately, add it to toolCandidates and leave "next" as [] unless you are scheduling follow-up task ids.',
      'Provide tool input values inside toolParameters as a JSON object with simple key/value pairs (for example: { "expression": "10 * 5" }).',
      'If there are no follow-up tasks yet, respond with an empty array for "next".',
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
