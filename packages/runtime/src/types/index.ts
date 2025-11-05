import type { Observable } from 'rxjs';
import type { ContextManager } from '../context/BridgeContextManager.interface.js';

export type AgentState = 'plan' | 'act' | 'observe' | 'reflect' | 'finish' | 'error';

export type TaskStatus = 'pending' | 'in_progress' | 'succeeded' | 'failed';

export interface TaskNode {
  /** 任务唯一标识，用于上下文查找与链路追踪 */
  taskId: string;
  /** 任务目标或描述，便于 planner/reflector 理解语义 */
  description: string;
  /** 任务当前状态：pending/in_progress/succeeded/failed */
  status: TaskStatus;
  /** 可选：父任务 ID，用于形成任务树结构 */
  parentId?: string;
  /** 下级子任务 ID 列表（只存 ID，具体数据在 tasks 表里） */
  children: string[];
  /** 可选：任务附带的自定义元数据 */
  metadata?: Record<string, unknown>;
  /** 任务创建时间戳（毫秒） */
  createdAt: number;
  /** 最近一次更新的时间戳（毫秒） */
  updatedAt: number;
}

export interface PlanStep {
  /** 当前计划步骤关联的任务 ID，应保持与激活任务一致 */
  taskId: string;
  /** 本步骤的目标描述，用于指导工具输入与后续反思 */
  goal: string;
  /** 优先级顺序的工具候选列表，执行器将按顺序尝试 */
  toolCandidates: string[];
  /** 判断步骤成功的条件说明，供反思器和执行器参考 */
  successCriteria: string;
  /** 可选：该步骤允许的最大执行耗时（毫秒） */
  timeoutMs?: number;
  /** 可选：本步骤允许的重试次数 */
  retryLimit?: number;
  /** 可选：规划出的后续任务 ID 列表，用于更新任务树 */
  next?: string[];
  /** 可选：传递给工具的参数，键值对形式 */
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
  /** 唯一标识当前代理实例，用于事件广播与快照追踪 */
  agentId: string;
  /** 负责基于上下文生成下一步 PlanStep 的规划器实现 */
  planner: Planner;
  /** 在执行后进行复盘并决定状态机后续流向的反思器实现 */
  reflector: Reflector;
  /** 提供工具查找/注册能力的工具注册表 */
  toolRegistry: ToolRegistry;
  /** 可选的执行守卫配置，例如最大重试次数、耗时等限制 */
  guard?: ExecutionGuard;
  /** 可选的上下文管理器，实现记忆聚合、压缩等策略 */
  contextManager?: ContextManager;
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
  /** 工具唯一标识，供 planner/executor 引用 */
  id: string;
  /** 工具作用或使用方式的简短说明 */
  description: string;
  /** 执行工具主逻辑，输入工具调用上下文，返回结果 */
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
  /** 当前代理实例 ID，方便日志与事件追踪 */
  agentId: string;
  /** 根任务 ID，用作整个任务树的入口 */
  rootTaskId: string;
  /** 当前激活的任务 ID，若无激活任务则为 null */
  activeTaskId: string | null;
  /** 系统维护的任务节点列表，键为 taskId */
  tasks: Record<string, TaskNode>;
  /** 最近记录的观测结果列表 */
  observations: Observation[];
  /** 代理的工作记忆，用于跨步骤共享状态 */
  workingMemory: Record<string, unknown>;
  /** 额外的上下文元数据 */
  metadata: Record<string, unknown>;
  /** 当前迭代次数，配合守卫或日志使用 */
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

export interface AgentRunInput {
  rootTask: Pick<TaskNode, "taskId" | "description" | "status"> & {
    parentId?: string;
    children?: string[];
    metadata?: Record<string, unknown>;
  };
  metadata?: Record<string, unknown>;
}

export interface AgentRunResult {
  state: AgentState;
  iterations: number;
  lastObservation: Observation | null;
  executionResult: ExecutionResult | null;
  finalSnapshot: AgentContextSnapshot;
}
