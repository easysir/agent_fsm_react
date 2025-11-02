// @ts-nocheck
import type {
  AgentContextSnapshot,
  ExecutionResult,
  Observation,
  PlanStep,
} from '../types/index.js';
import { AgentContext } from '../core/AgentContext.js';

export interface MachineContext {
  /** 运行时可变的代理上下文，提供任务/记忆操作入口 */
  agentContext: AgentContext;
  /** 最近一次读取的上下文快照，用于传给 planner/executor/reflector */
  snapshot: AgentContextSnapshot;
  /** 当前待执行的计划步骤；若为 null 表示尚未规划 */
  planStep: PlanStep | null;
  /** 最近一次工具执行的结果，供观察/反思阶段使用 */
  executionResult: ExecutionResult | null;
  /** 根据执行结果推导出的观察信息 */
  observation: Observation | null;
  /** 针对同一 plan 已尝试执行的次数，用于控制重试 */
  attempt: number;
  /** 状态机已经循环的迭代次数 */
  iterations: number;
  /** 累计失败次数（planner/act/reflect 出错时递增） */
  failures: number;
  /** 状态机启动时间戳，支持时长守卫 */
  startedAt: number;
}

export type MachineEvents =
  | { type: 'NEXT' }
  | { type: 'RETRY'; reason?: string }
  | { type: 'FAIL'; reason: string }
  | { type: 'STOP' };

export interface InvokeInput {
  context: MachineContext;
}
