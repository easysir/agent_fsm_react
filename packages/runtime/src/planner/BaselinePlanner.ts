import { nanoid } from "nanoid";
import { z } from "zod";
import type {
  AgentContextSnapshot,
  MasterPlan,
  MasterPlanHistoryEntry,
  MasterPlanStatus,
  PlanItem,
  PlanItemRetry,
  PlanItemStatus,
  PlanItemTool,
  Planner,
  PlannerResult,
  ToolAdapter,
  ToolRegistry,
} from "../types/index.js";
import {
  ChatModelClient,
  type ChatMessage,
  type ChatModelClientOptions,
  type ChatModelProvider,
} from "../llm/ChatModelClient.js";
import { BridgeContextManager } from "../context/BridgeContextManager.js";
import type {
  ContextManager,
  PlanningContext,
  PlannerToolSummary,
} from "../context/BridgeContextManager.interface.js";

type ToolSummary = PlannerToolSummary;

export interface BaselinePlannerOptions {
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
  "You orchestrate an autonomous software agent. Your sole output is a MasterPlan JSON object that downstream components can execute without further interpretation.",
  "",
  "=== Output Contract ===",
  "{",
  '  "planId": string (optional),',
  '  "reasoning": string (optional, short rationale for the overall plan),',
  '  "userMessage": string (optional, friendly summary for the user),',
  '  "currentIndex": number,  // 0-based pointer to the next actionable step',
  '  "steps": [',
  "    {",
  '      "id": string,',
  '      "title": string,',
  '      "description": string (optional),',
  '      "relatedTaskId": string (optional),',
  '      "status": "pending" | "ready" | "in_progress" | "blocked" | "succeeded" | "failed" | "skipped" (optional; default pending),',
  '      "successCriteria": string[],',
  '      "toolSequence": [',
  '        { "toolId": string, "description": string (optional), "parameters": object (optional) }',
  "      ],",
  '      "retry": { "limit"?: number, "strategy"?: "none" | "immediate" | "linear" | "exponential", "intervalMs"?: number } (optional),',
  '      "metadata": object (optional)',
  "    }",
  "  ]",
  "}",
  "",
  "=== Planning Principles ===",
  "- currentIndex must always reference the next actionable step (0 <= currentIndex < steps.length).",
  "- steps are ordered. Earlier steps prepare context for later ones (analysis → generation → validation, etc.).",
  "- Keep 2–6 steps. Break down large goals into coherent stages.",
  "- DO NOT inline full source files, long scripts, or base64 payloads in this plan. The planner describes intent; tools in later stages create the artifacts.",
  "- When code is required, use dedicated tools (e.g., `code.generateSnippet`) to produce the snippet, then a subsequent step such as `code.writeFile` to persist it.",
  "- If you must supply example content in parameters, provide only minimal scaffolding or a short template. Never exceed a few lines.",
  "",
  "=== Tool & Parameter Guidelines ===",
  "- Use only the tools provided in the tool summary. Invalid tool IDs break the pipeline.",
  "- Parameters should be concise, instruction-oriented, and safe to serialize as JSON.",
  "- Prefer descriptive fields such as `outline`, `instructions`, `language`, `filename` when preparing generation tasks.",
  "- For `code.writeFile`, supply file paths plus high-level guidance (e.g., which snippet to apply), not the file body itself.",
  "- For shell tooling, include explicit commands (as arrays) and rationale in the description.",
  "",
  "=== JSON Safety Rules ===",
  "- Output MUST be valid JSON. No comments, trailing commas, or extraneous text.",
  "- Escape control characters (\\n, \\r, \\t) inside strings. Escape quotes as \\\".",
  "- Avoid raw multi-line strings in parameters. Use arrays of short strings if necessary.",
  "- Every field you include must be serializable without post-processing.",
  "",
  "=== Quality Safeguards ===",
  "- Ensure the plan is executable from scratch: directory setup → code generation → persistence → testing/validation.",
  "- Highlight dependencies between steps in descriptions or metadata when helpful.",
  "- If the input context lacks required information (e.g., no snippet generator tool), fall back to analysis or request appropriate human input.",
  "- Be concise and deterministic: identical inputs should yield structurally similar plans.",
].join("\n");

const DEFAULT_PLAN_TIMEOUT_MS = 5_000;
const DEFAULT_RETRY_LIMIT = 2;

const LLMToolSchema = z.object({
  toolId: z.string().min(1),
  description: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
});

const LLMRetrySchema = z
  .object({
    limit: z.number().int().nonnegative().optional(),
    strategy: z
      .enum(["none", "immediate", "linear", "exponential"])
      .optional(),
    intervalMs: z.number().int().positive().optional(),
  })
  .partial();

const LLMPlanStepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  relatedTaskId: z.string().min(1).optional(),
  status: z
    .enum([
      "pending",
      "ready",
      "in_progress",
      "blocked",
      "succeeded",
      "failed",
      "skipped",
    ])
    .optional(),
  successCriteria: z.array(z.string().min(1)).min(1),
  toolSequence: z.array(LLMToolSchema).min(1),
  retry: LLMRetrySchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const LLMPlanSchema = z.object({
  planId: z.string().min(1).optional(),
  reasoning: z.string().optional(),
  userMessage: z.string().optional(),
  currentIndex: z.number().int().nonnegative(),
  steps: z.array(LLMPlanStepSchema).min(1),
});

type LLMPlan = z.infer<typeof LLMPlanSchema>;
type LLMPlanStep = z.infer<typeof LLMPlanStepSchema>;
type LLMTool = z.infer<typeof LLMToolSchema>;

export class BaselinePlanner implements Planner {
  private readonly llmClient: ChatModelClient;

  private readonly systemPrompt: string;

  private readonly toolRegistry: ToolRegistry | undefined;

  private readonly defaultToolId: string | null;

  private readonly planTimeoutMs: number;

  private readonly defaultRetryLimit: number;

  private contextManager: ContextManager;

  constructor(options?: BaselinePlannerOptions) {
    this.systemPrompt = options?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    this.toolRegistry = options?.toolRegistry;
    this.defaultToolId = options?.defaultToolId ?? "echo";
    this.planTimeoutMs = options?.planTimeoutMs ?? DEFAULT_PLAN_TIMEOUT_MS;
    this.defaultRetryLimit = options?.defaultRetryLimit ?? DEFAULT_RETRY_LIMIT;
    this.contextManager = options?.contextManager ?? new BridgeContextManager();

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

  async plan(context: AgentContextSnapshot): Promise<PlannerResult> {
    const fallback = this.buildFallbackPlan(context);

    if (!this.llmClient.isConfigured()) {
      console.warn(
        `[BaselinePlanner] Missing API key for ${this.llmClient.getProvider()}, using fallback plan.`
      );
      await this.persistPlannerResult(fallback, context);
      return fallback;
    }

    let planningContext: PlanningContext | null = null;
    let contextualFallback: PlannerResult = fallback;
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
        maxTokens: 900,
      });
      const parsed = this.parsePlanResponse(content);
      const nextPlan = this.composeMasterPlan(
        planningContext.snapshot,
        parsed,
        contextualFallback.plan,
        planningContext.snapshot.masterPlan ?? null,
        tools
      );
      await this.persistPlannerResult(nextPlan, planningContext.snapshot);
      return nextPlan;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[BaselinePlanner] LLM planning failed (${message}). Using fallback plan.`
      );
      const result = planningContext ? contextualFallback : fallback;
      await this.persistPlannerResult(
        result,
        planningContext?.snapshot ?? context
      );
      return result;
    }
  }

  private buildFallbackPlan(context: AgentContextSnapshot): PlannerResult {
    const activeTaskId = context.activeTaskId ?? context.rootTaskId;
    const activeTask = context.tasks[activeTaskId];
    if (!activeTask) {
      throw new Error(`Active task ${activeTaskId} not found in context`);
    }
    const tools = this.getAvailableTools();
    const fallbackTool =
      tools.length > 0
        ? tools[0]
        : this.defaultToolId
        ? { id: this.defaultToolId, description: "Default fallback tool" }
        : { id: "echo", description: "Echo fallback tool" };

    const now = Date.now();
    const historyEntry: MasterPlanHistoryEntry = {
      version: 1,
      timestamp: now,
      event: "created",
      summary: "Fallback single-step plan created",
      payload: { type: "fallback" },
    };

    const planItem: PlanItem = {
      id: `${activeTaskId}-step`,
      title: activeTask.description,
      description: activeTask.description,
      status: "in_progress",
      relatedTaskId: activeTaskId,
      toolSequence: [
        {
          toolId: fallbackTool.id,
          description: fallbackTool.description,
          parameters: {
            goal: activeTask.description,
          },
        },
      ],
      successCriteria: ["Tool execution returns success=true"],
      retry: this.defaultRetryLimit
        ? { limit: this.defaultRetryLimit, strategy: "immediate" }
        : undefined,
      metadata: { source: "fallback" },
    };

    const plan: MasterPlan = {
      planId: nanoid(),
      steps: [planItem],
      currentIndex: 0,
      status: "in_progress",
      reasoning: "Fallback plan generated due to missing LLM configuration",
      createdAt: now,
      updatedAt: now,
      history: [historyEntry],
      metadata: {
        fallback: true,
        nextTaskIds: activeTask.children,
      },
    };

    return {
      plan,
      issuedAt: now,
      historyEntry,
      metadata: { reason: "fallback" },
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
    const existingPlanSummary = this.describeExistingPlan(
      planningContext.snapshot.masterPlan ?? null
    );
    return [
      contextText,
      "",
      existingPlanSummary,
      "",
      `Ensure the master plan keeps the active task ID as "${activeTaskId}" or an appropriate subtask.`,
      "Return ONLY the JSON object described by the system instructions.",
    ].join("\n");
  }

  private describeExistingPlan(plan: MasterPlan | null): string {
    if (!plan) {
      return "Existing master plan: null (create a fresh plan)";
    }
    const stepSummaries = plan.steps
      .map((step, index) => {
        const pointer = index === plan.currentIndex ? ">>" : "  ";
        return `${pointer} [${step.status}] ${step.id}: ${step.title}`;
      })
      .join("\n");
    return [
      "Existing master plan snapshot:",
      `- planId: ${plan.planId}`,
      `- status: ${plan.status}`,
      `- currentIndex: ${plan.currentIndex}`,
      "- steps:",
      stepSummaries,
    ].join("\n");
  }

  private parsePlanResponse(content: string): LLMPlan {
    const jsonText = this.extractJsonPayload(content);
    const normalizedText = convertContentLinesToBase64(jsonText);
    let raw: unknown;
    try {
      raw = JSON.parse(normalizedText);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const position = extractJsonErrorPosition(message);
      console.warn("[BaselinePlanner] Failed to parse LLM JSON", {
        error: message,
        preview: truncate(normalizedText, 2_000),
        attempt: "raw",
        problemSnippet: position
          ? getProblemSnippet(normalizedText, position)
          : undefined,
      });
      try {
        const sanitized = sanitizeJsonStrings(normalizedText);
        raw = JSON.parse(sanitized);
        console.info("[BaselinePlanner] Successfully sanitized LLM JSON");
      } catch (repairError) {
        const repairMessage =
          repairError instanceof Error
            ? repairError.message
            : String(repairError ?? "unknown");
        const repairPosition = extractJsonErrorPosition(repairMessage);
        console.warn("[BaselinePlanner] JSON sanitization failed", {
          error: repairMessage,
          preview: truncate(normalizedText, 2_000),
          problemSnippet: repairPosition
            ? getProblemSnippet(normalizedText, repairPosition)
            : undefined,
        });
        throw repairError;
      }
    }
    try {
      return LLMPlanSchema.parse(raw);
    } catch (error) {
      console.warn("[BaselinePlanner] LLM plan schema validation failed", {
        error:
          error instanceof Error ? error.message : String(error ?? "unknown"),
        preview: truncate(JSON.stringify(raw).slice(0, 2_000), 2_000),
      });
      throw error;
    }
  }

  private composeMasterPlan(
    snapshot: AgentContextSnapshot,
    llmPlan: LLMPlan,
    baselinePlan: MasterPlan,
    previousPlan: MasterPlan | null,
    tools: ToolSummary[]
  ): PlannerResult {
    const now = Date.now();
    const allowedTools = new Map<string, string>(
      tools.map((tool) => [tool.id, tool.description])
    );
    if (this.defaultToolId && !allowedTools.has(this.defaultToolId)) {
      allowedTools.set(this.defaultToolId, "Default fallback tool");
    }
    const fallbackToolSequence =
      baselinePlan.steps[baselinePlan.currentIndex]?.toolSequence ??
      baselinePlan.steps[0]?.toolSequence ??
      [];

    const fallbackTool =
      fallbackToolSequence[0] ??
      ({
        toolId: this.defaultToolId ?? "echo",
        description: allowedTools.get(this.defaultToolId ?? "echo") ?? "Echo",
      } as PlanItemTool);

    const activeTaskId = snapshot.activeTaskId ?? snapshot.rootTaskId;
    const uniqueIds = new Set<string>();
    const clampedIndex = Math.min(
      Math.max(llmPlan.currentIndex ?? 0, 0),
      llmPlan.steps.length - 1
    );

    const resolvedSteps = llmPlan.steps.map((step, index) =>
      this.normalizePlanItem({
        step,
        index,
        clampedIndex,
        activeTaskId,
        uniqueIds,
        allowedTools,
        fallbackTool,
        fallbackSequence: fallbackToolSequence,
        defaultRetry: this.defaultRetryLimit,
      })
    );

    const effectiveIndex = Math.min(clampedIndex, resolvedSteps.length - 1);
    const planStatus = this.computePlanStatus(resolvedSteps, effectiveIndex);
    const planId = previousPlan?.planId ?? llmPlan.planId ?? nanoid();
    const createdAt = previousPlan?.createdAt ?? now;
    const baseHistory = previousPlan?.history ?? [];
    const historyEntry = this.buildHistoryEntry(
      baseHistory,
      previousPlan ? "replanned" : "created",
      previousPlan
        ? "Planner updated master plan"
        : "Initial master plan generated",
      {
        stepCount: resolvedSteps.length,
        activeTaskId,
      }
    );

    const history = [...baseHistory, historyEntry];

    const plan: MasterPlan = {
      planId,
      steps: resolvedSteps,
      currentIndex: effectiveIndex,
      status: planStatus,
      reasoning: llmPlan.reasoning ?? previousPlan?.reasoning,
      userMessage: llmPlan.userMessage ?? previousPlan?.userMessage,
      createdAt,
      updatedAt: now,
      history,
      metadata: {
        ...(previousPlan?.metadata ?? {}),
        source: "llm",
      },
    };

    return {
      plan,
      issuedAt: now,
      historyEntry,
      metadata: { source: "llm" },
    };
  }

  private normalizePlanItem({
    step,
    index,
    clampedIndex,
    activeTaskId,
    uniqueIds,
    allowedTools,
    fallbackTool,
    fallbackSequence,
    defaultRetry,
  }: {
    step: LLMPlanStep;
    index: number;
    clampedIndex: number;
    activeTaskId: string;
    uniqueIds: Set<string>;
    allowedTools: Map<string, string>;
    fallbackTool: PlanItemTool;
    fallbackSequence: PlanItemTool[];
    defaultRetry: number;
  }): PlanItem {
    const id = this.ensureUniqueId(step.id, uniqueIds, index);
    const relatedTaskId = step.relatedTaskId ?? activeTaskId;

    const toolSequence = this.normalizeToolSequence({
      sequence: step.toolSequence,
      allowedTools,
      fallbackTool,
      fallbackSequence,
    });

    const successCriteria =
      step.successCriteria.length > 0
        ? step.successCriteria
        : ["Tool execution returns success=true"];

    const retry: PlanItemRetry | undefined =
      step.retry && Object.keys(step.retry).length > 0
        ? {
            ...(typeof step.retry.limit === "number"
              ? { limit: step.retry.limit }
              : {}),
            ...(step.retry.strategy ? { strategy: step.retry.strategy } : {}),
            ...(typeof step.retry.intervalMs === "number"
              ? { intervalMs: step.retry.intervalMs }
              : {}),
          }
        : defaultRetry
        ? { limit: defaultRetry, strategy: "immediate" }
        : undefined;

    const status = this.resolveStepStatus(step.status, index, clampedIndex);

    return {
      id,
      title: step.title,
      description: step.description,
      status,
      relatedTaskId,
      toolSequence,
      successCriteria,
      retry,
      metadata: step.metadata,
    };
  }

  private normalizeToolSequence(
    params: {
      sequence: LLMTool[];
      allowedTools: Map<string, string>;
      fallbackTool: PlanItemTool;
      fallbackSequence: PlanItemTool[];
    }
  ): PlanItemTool[] {
    const { sequence, allowedTools, fallbackTool, fallbackSequence } = params;
    const normalized: PlanItemTool[] = [];
    const seen = new Set<string>();

    sequence.forEach((tool) => {
      const toolId = tool.toolId.trim();
      if (!toolId || seen.has(toolId)) {
        return;
      }
      if (!allowedTools.has(toolId)) {
        return;
      }
      normalized.push({
        toolId,
        description: tool.description ?? allowedTools.get(toolId),
        parameters: this.normalizeToolParameters(toolId, tool.parameters),
      });
      seen.add(toolId);
    });

    if (normalized.length === 0) {
      if (fallbackSequence.length > 0) {
        return fallbackSequence.map((tool) => ({ ...tool }));
      }
      normalized.push({
        toolId: fallbackTool.toolId,
        description: fallbackTool.description,
        parameters: fallbackTool.parameters,
      });
    }

    return normalized;
  }

  private normalizeToolParameters(
    toolId: string,
    params: Record<string, unknown> | undefined
  ): Record<string, unknown> | undefined {
    if (!params) {
      return undefined;
    }
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params)) {
      normalized[key] = value;
    }

    if (toolId === "code.writeFile") {
      this.ensureWriteFilePayload(normalized);
    }

    if (toolId === "shell.command") {
      this.ensureShellCommandPayload(normalized);
    }

    return normalized;
  }

  private ensureWriteFilePayload(parameters: Record<string, unknown>): void {
    const rawContent =
      typeof parameters.content === "string" ? parameters.content : null;
    const rawLines = Array.isArray(parameters.contentLines)
      ? parameters.contentLines
      : null;

    if (rawLines) {
      parameters.contentLines = rawLines.map((line, index) => {
        if (typeof line !== "string") {
          return sanitizeContentString(String(line));
        }
        return sanitizeContentString(line);
      });
      delete parameters.content;
      if (!parameters.encoding) {
        parameters.encoding = "utf8";
      }
      return;
    }

    if (rawContent) {
      const sanitized = sanitizeContentString(rawContent);
      if (sanitized.includes("\n")) {
        parameters.contentLines = sanitized.split(/\r?\n/);
        delete parameters.content;
        parameters.encoding = parameters.encoding ?? "utf8";
      } else {
        parameters.content = sanitized;
        parameters.encoding = parameters.encoding ?? "utf8";
      }
      return;
    }

    if (!parameters.content && !parameters.contentLines && parameters.base64) {
      const value = String(parameters.base64);
      if (value.includes("\n")) {
        parameters.contentLines = sanitizeContentString(value).split(/\r?\n/);
        parameters.encoding = parameters.encoding ?? "utf8";
      } else {
        parameters.content = value;
        parameters.encoding = "base64";
      }
      delete parameters.base64;
    }
  }

  private ensureShellCommandPayload(parameters: Record<string, unknown>): void {
    if (Array.isArray(parameters.command)) {
      parameters.command = parameters.command.map((value) =>
        typeof value === "string" ? value : String(value)
      );
    }
  }

  private resolveStepStatus(
    declared: PlanItemStatus | undefined,
    index: number,
    clampedIndex: number
  ): PlanItemStatus {
    if (declared) {
      return declared;
    }
    if (index < clampedIndex) {
      return "succeeded";
    }
    if (index === clampedIndex) {
      return "in_progress";
    }
    return "pending";
  }

  private computePlanStatus(
    steps: PlanItem[],
    currentIndex: number
  ): MasterPlanStatus {
    const allCompleted = steps.every((step) =>
      ["succeeded", "skipped"].includes(step.status)
    );
    if (allCompleted) {
      return "completed";
    }
    const anyFailed = steps.some((step) => step.status === "failed");
    if (anyFailed) {
      return "failed";
    }
    const anyBlocked = steps.some((step) => step.status === "blocked");
    if (anyBlocked) {
      return "blocked";
    }
    if (currentIndex >= steps.length) {
      return "completed";
    }
    return "in_progress";
  }

  private buildHistoryEntry(
    history: MasterPlanHistoryEntry[],
    event: MasterPlanHistoryEntry["event"],
    summary: string,
    payload?: Record<string, unknown>
  ): MasterPlanHistoryEntry {
    const lastVersion = history[history.length - 1]?.version ?? 0;
    return {
      version: lastVersion + 1,
      timestamp: Date.now(),
      event,
      summary,
      ...(payload ? { payload } : {}),
    };
  }

  private ensureUniqueId(
    candidate: string,
    uniqueIds: Set<string>,
    index: number
  ): string {
    let id = candidate;
    if (!id || uniqueIds.has(id)) {
      id = `${candidate || "step"}-${index + 1}`;
    }
    while (uniqueIds.has(id)) {
      id = `${id}-${nanoid(4)}`;
    }
    uniqueIds.add(id);
    return id;
  }

  private async persistPlannerResult(
    result: PlannerResult,
    snapshot: AgentContextSnapshot
  ): Promise<void> {
    try {
      await this.contextManager.recordPlannerResult(result, snapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[BaselinePlanner] Failed to record master plan via ContextManager (${message})`
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
  options?: BaselinePlannerOptions
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

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}…`;
}

function sanitizeJsonStrings(input: string): string {
  let result = "";
  let inString = false;
  let escapeNext = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (escapeNext) {
      result += char;
      escapeNext = false;
      continue;
    }
    if (char === "\\") {
      escapeNext = true;
      result += char;
      continue;
    }
    if (char === '"') {
      if (!inString) {
        inString = true;
        result += char;
        continue;
      }
      const next = findNextSignificantChar(input, i + 1);
      if (next && !',:}]'.includes(next)) {
        result += '\\"';
        continue;
      }
      inString = false;
      result += char;
      continue;
    }
    if (inString) {
      if (char === "\n") {
        result += "\\n";
        continue;
      }
      if (char === "\r") {
        result += "\\r";
        continue;
      }
      if (char === "\t") {
        result += "\\t";
        continue;
      }
    }
    result += char;
  }
  return result;
}

function extractJsonErrorPosition(message: string): number | null {
  const match = message.match(/position\s+(\d+)/i);
  if (!match) {
    return null;
  }
  const value = Number.parseInt(match[1], 10);
  return Number.isNaN(value) ? null : value;
}

function getProblemSnippet(value: string, position: number): string {
  const start = Math.max(0, position - 120);
  const end = Math.min(value.length, position + 120);
  return value.slice(start, end);
}

function findNextSignificantChar(
  input: string,
  startIndex: number
): string | null {
  for (let i = startIndex; i < input.length; i += 1) {
    const char = input[i];
    if (!/\s/.test(char)) {
      return char;
    }
  }
  return null;
}

function convertContentLinesToBase64(json: string): string {
  let cursor = 0;
  let mutated = false;
  let result = "";

  while (true) {
    const keyIndex = json.indexOf('"contentLines"', cursor);
    if (keyIndex === -1) {
      break;
    }
    const arrayStart = json.indexOf("[", keyIndex);
    if (arrayStart === -1) {
      break;
    }
    const segment = extractBracketSegment(json, arrayStart);
    if (!segment) {
      break;
    }
    const { segmentText, endIndex } = segment;
    const sanitizedSegment = sanitizeJsonStrings(segmentText);
    let lines: unknown;
    try {
      lines = JSON.parse(sanitizedSegment);
    } catch {
      result += json.slice(cursor, endIndex + 1);
      cursor = endIndex + 1;
      continue;
    }
    if (
      !Array.isArray(lines) ||
      !(lines as unknown[]).every((line) => typeof line === "string")
    ) {
      result += json.slice(cursor, endIndex + 1);
      cursor = endIndex + 1;
      continue;
    }

    mutated = true;
    const sanitizedLines = (lines as string[]).map((line) =>
      sanitizeContentString(line)
    );
    const joined = sanitizedLines.join("\n");
    const base64 = Buffer.from(joined, "utf8").toString("base64");

    result += json.slice(cursor, keyIndex);
    result += `"content":"${base64}","encoding":"base64"`;
    const afterArrayIndex = skipEncodingProperty(json, endIndex + 1);
    cursor = afterArrayIndex;
  }

  if (!mutated) {
    return json;
  }

  return result + json.slice(cursor);
}

function extractBracketSegment(
  text: string,
  startIndex: number
): { segmentText: string; endIndex: number } | null {
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  for (let i = startIndex; i < text.length; i += 1) {
    const char = text[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (char === "\\") {
      escapeNext = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === "[") {
        depth += 1;
      } else if (char === "]") {
        depth -= 1;
        if (depth === 0) {
          return {
            segmentText: text.slice(startIndex, i + 1),
            endIndex: i,
          };
        }
      }
    }
  }
  return null;
}

function skipEncodingProperty(text: string, startIndex: number): number {
  let i = startIndex;
  const original = startIndex;

  while (i < text.length && /\s/.test(text[i])) {
    i += 1;
  }
  if (text[i] !== ",") {
    return original;
  }
  i += 1;
  while (i < text.length && /\s/.test(text[i])) {
    i += 1;
  }
  if (!text.startsWith('"encoding"', i)) {
    return original;
  }
  i += '"encoding"'.length;
  while (i < text.length && /\s/.test(text[i])) {
    i += 1;
  }
  if (text[i] !== ":") {
    return original;
  }
  i += 1;
  while (i < text.length && /\s/.test(text[i])) {
    i += 1;
  }
  if (text[i] !== '"') {
    return original;
  }
  i += 1;
  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2;
      continue;
    }
    if (text[i] === '"') {
      i += 1;
      break;
    }
    i += 1;
  }

  return i;
}

function sanitizeContentString(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\t/g, "  "))
    .join("\n");
}
