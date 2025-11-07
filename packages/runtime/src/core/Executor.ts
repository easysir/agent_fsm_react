import { nanoid } from "nanoid";
// 执行器：负责根据计划选择工具并调用，同时在总线上广播请求/结果事件
import type {
  AgentContextSnapshot,
  BusEvent,
  ExecutionResult,
  MasterPlan,
  PlanItem,
  ToolInput,
  ToolRegistry,
} from "../types/index.js";
import { EventBus } from "../event/EventBus.js";
import type { ContextManager } from "../context/BridgeContextManager.interface.js";

export interface ExecutorOptions {
  toolRegistry: ToolRegistry;
  eventBus: EventBus;
  contextManager?: ContextManager;
}

export class Executor {
  private toolRegistry: ToolRegistry;

  private eventBus: EventBus;

  private contextManager: ContextManager | undefined;

  constructor(options: ExecutorOptions) {
    this.toolRegistry = options.toolRegistry;
    this.eventBus = options.eventBus;
    this.contextManager = options.contextManager;
  }

  public async execute({
    plan,
    stepIndex,
    step,
    snapshot,
    preferredToolId,
  }: {
    plan: MasterPlan;
    stepIndex: number;
    step: PlanItem;
    snapshot: AgentContextSnapshot;
    preferredToolId?: string;
  }): Promise<ExecutionResult> {
    const toolCandidates = step.toolSequence ?? [];
    const primary = toolCandidates[0];
    const toolId = preferredToolId ?? primary?.toolId;
    if (!toolId) {
      throw new Error(`No tool candidate available for plan item ${step.id}`);
    }

    const tool = this.toolRegistry.get(toolId);
    if (!tool) {
      throw new Error(`Tool ${toolId} is not registered`);
    }
    const selected =
      toolCandidates.find((candidate) => candidate.toolId === toolId) ??
      primary;

    const traceId = nanoid();
    const requestEvent: BusEvent = {
      eventId: nanoid(),
      type: "tool.request",
      timestamp: Date.now(),
      traceId,
      relatedTaskId: step.relatedTaskId ?? step.id,
      payload: {
        toolId,
        planId: plan.planId,
        stepId: step.id,
        stepIndex,
        step,
      },
    };
    this.eventBus.emit(requestEvent);

    const input: ToolInput = {
      taskId: step.relatedTaskId ?? step.id,
      traceId,
      params: {
        planId: plan.planId,
        stepId: step.id,
        ...(selected?.parameters ?? {}),
      },
      context: snapshot,
    };

    const startedAt = Date.now();
    const result = await tool.execute(input);
    const elapsed = Date.now() - startedAt;

    const resultEvent: BusEvent = {
      eventId: nanoid(),
      type: "tool.result",
      timestamp: Date.now(),
      traceId,
      relatedTaskId: step.relatedTaskId ?? step.id,
      payload: {
        toolId,
        planId: plan.planId,
        stepId: step.id,
        stepIndex,
        step,
        result: { ...result, latencyMs: elapsed },
      },
    };
    this.eventBus.emit(resultEvent);

    const executionResult: ExecutionResult = {
      planId: plan.planId,
      stepIndex,
      step,
      toolId,
      result: { ...result, latencyMs: elapsed },
    };
    await this.persistExecutionResult(executionResult, snapshot);
    return executionResult;
  }

  private async persistExecutionResult(
    executionResult: ExecutionResult,
    snapshot: AgentContextSnapshot
  ): Promise<void> {
    if (!this.contextManager) {
      return;
    }
    try {
      await this.contextManager.recordExecutionResult(executionResult, snapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[Executor] Failed to record execution result via ContextManager (${message})`
      );
    }
  }
}
