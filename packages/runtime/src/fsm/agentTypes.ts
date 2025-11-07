// @ts-nocheck
import type {
  AgentContextSnapshot,
  ExecutionResult,
  MasterPlan,
  Observation,
  PlanItem,
} from '../types/index.js';
import { AgentContext } from '../core/AgentContext.js';

export interface MachineContext {
  /** 运行时可变的代理上下文，提供任务/记忆操作入口 */
  agentContext: AgentContext;
  /** 最近一次读取的上下文快照，用于传给 planner/executor/reflector */
  snapshot: AgentContextSnapshot;
  /** 主计划的完整结构 */
  masterPlan: MasterPlan | null;
  /** 指针指向的当前步骤，若没有可执行步骤则为 null */
  currentStep: PlanItem | null;
  /** 当前步骤在 steps 数组中的索引，若无计划则为 null */
  currentStepIndex: number | null;
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
