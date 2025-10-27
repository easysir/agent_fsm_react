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
  | 'agent.finished'
  | 'agent.log';

export interface BusEvent {
  eventId: string;
  type: EventType;
  timestamp: number;
  traceId: string;
  relatedTaskId?: string;
  payload: Record<string, unknown>;
}

export type AgentState = 'plan' | 'act' | 'observe' | 'reflect' | 'finish' | 'error';
