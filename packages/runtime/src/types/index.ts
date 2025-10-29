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
  source: 'tool' | 'user' | 'system';
  relatedTaskId: string;
  timestamp: number;
  payload: Record<string, unknown>;
  success: boolean;
  latencyMs?: number;
  error?: string;
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
  planStep: PlanStep;
  observation: Observation | null;
  context: AgentContextSnapshot;
  attempt: number;
}

export interface ReflectOutcome {
  status: 'continue' | 'retry' | 'fallback' | 'user_input' | 'abort' | 'complete';
  message?: string;
  updatedTasks?: TaskNode[];
  fallbackToolId?: string;
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
