// @ts-nocheck
import type {
  AgentContextSnapshot,
  ExecutionResult,
  Observation,
  PlanStep,
} from '../types/index.js';
import { AgentContext } from '../core/AgentContext.js';

export interface MachineContext {
  agentContext: AgentContext;
  snapshot: AgentContextSnapshot;
  planStep: PlanStep | null;
  executionResult: ExecutionResult | null;
  observation: Observation | null;
  attempt: number;
  iterations: number;
  failures: number;
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
