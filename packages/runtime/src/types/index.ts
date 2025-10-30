import type { Observable } from 'rxjs';

export type AgentState = 'plan' | 'act' | 'observe' | 'reflect' | 'finish' | 'error';

export type TaskStatus = 'pending' | 'in_progress' | 'succeeded' | 'failed';

export interface TaskNode {
  taskId: string;
  description: string;
  status: TaskStatus;
  parentId?: string;
  children: string[];
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface PlanStep {
  taskId: string;
  goal: string;
  toolCandidates: string[];
  successCriteria: string;
  timeoutMs?: number;
  retryLimit?: number;
  next?: string[];
  toolParameters?: Record<string, unknown>;
}

export interface Observation {
  source: 'tool' | 'user' | 'system'; // 观测来源：工具执行结果、用户输入或系统事件
  relatedTaskId: string; // 关联的任务 ID，用于追踪哪一步产生的结果
  timestamp: number; // 观测发生时间（毫秒时间戳）
  payload: Record<string, unknown>; // 观测携带的原始数据或输出
  success: boolean; // 是否成功完成预期目标
  latencyMs?: number; // 可选：执行耗时（毫秒）
  error?: string; // 可选：失败时的错误信息
}

export type EventType =
  | 'tool.request'
  | 'tool.result'
  | 'user.input'
  | 'system.alert'
  | 'agent.transition'
  | 'agent.log'
  | 'agent.finished';

export interface EventPayload {
  [key: string]: unknown;
}

export interface BusEvent {
  eventId: string; // 事件唯一标识
  type: EventType; // 事件类型，用于区分工具调用、状态切换等
  timestamp: number; // 事件发生的时间戳（毫秒）
  traceId: string; // 链路追踪 ID，用于串联同一次流程
  relatedTaskId?: string; // 可选，关联的任务 ID
  payload: EventPayload; // 事件负载，包含上下文数据
}

export interface AgentConfig {
  agentId: string;
  planner: Planner;
  reflector: Reflector;
  toolRegistry: ToolRegistry;
  guard?: ExecutionGuard;
}

export interface ExecutionGuard {
  maxIterations?: number;
  maxFailures?: number;
  maxDurationMs?: number;
}

export interface Planner {
  plan(context: AgentContextSnapshot): Promise<PlanStep>;
}

export interface ReflectInput {
  planStep: PlanStep; // 当前执行的计划步骤
  observation: Observation | null; // 工具执行后的观测结果
  context: AgentContextSnapshot; // 反思时的完整上下文快照
  attempt: number; // 已尝试执行的次数（用于控制重试）
}

export interface ReflectOutcome {
  status: 'continue' | 'retry' | 'fallback' | 'user_input' | 'abort' | 'complete'; // 状态机下一步动作
  message?: string; // 可选的提示信息，用于记录或展示
  updatedTasks?: TaskNode[]; // 需要同步更新状态的任务列表
  fallbackToolId?: string; // 可选的备用工具 ID（用于 fallback/retry 场景）
}

export interface Reflector {
  reflect(input: ReflectInput): Promise<ReflectOutcome>;
}

export interface ToolInput {
  taskId: string;
  traceId: string;
  params: Record<string, unknown>;
  context: AgentContextSnapshot;
}

export interface ToolResult {
  success: boolean;
  output: Record<string, unknown>;
  error?: string;
  latencyMs?: number;
}

export interface ToolAdapter {
  id: string;
  description: string;
  execute(input: ToolInput): Promise<ToolResult>;
}

export interface ToolRegistry {
  get(toolId: string): ToolAdapter | undefined;
  list(): ToolAdapter[];
}

export interface ExecutionResult {
  planStep: PlanStep;
  toolId?: string;
  result: ToolResult;
}

export interface AgentContextSnapshot {
  agentId: string;
  rootTaskId: string;
  activeTaskId: string | null;
  tasks: Record<string, TaskNode>;
  observations: Observation[];
  workingMemory: Record<string, unknown>;
  metadata: Record<string, unknown>;
  iteration: number;
}

export interface AgentContextUpdate {
  activeTaskId?: string | null;
  tasks?: Record<string, TaskNode>;
  observations?: Observation[];
  workingMemory?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  iteration?: number;
}

export interface RuntimeEventStream {
  events$: Observable<BusEvent>;
  snapshots$: Observable<AgentContextSnapshot>;
}
