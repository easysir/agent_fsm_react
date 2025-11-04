import { nanoid } from 'nanoid';
import type { AgentContextSnapshot, AgentContextUpdate, Observation, TaskNode } from '../types/index.js';

export interface AgentContextOptions {
  agentId: string;
  rootTask: Omit<TaskNode, 'createdAt' | 'updatedAt' | 'children'> & { children?: string[] };
  metadata?: Record<string, unknown>;
}

export class AgentContext {
  private snapshot: AgentContextSnapshot;

  constructor(options: AgentContextOptions) {
    const rootTaskId = options.rootTask.taskId ?? nanoid();
    const now = Date.now();
    const task: TaskNode = {
      taskId: rootTaskId,
      description: options.rootTask.description,
      status: options.rootTask.status,
      createdAt: now,
      updatedAt: now,
      children: options.rootTask.children ?? [],
    };
    if (typeof options.rootTask.parentId === 'string') {
      task.parentId = options.rootTask.parentId;
    }
    if (options.rootTask.metadata) {
      task.metadata = options.rootTask.metadata;
    }

    this.snapshot = {
      agentId: options.agentId,
      rootTaskId,
      activeTaskId: rootTaskId,
      tasks: { [rootTaskId]: task },
      observations: [],
      workingMemory: {},
      metadata: options.metadata ? { ...options.metadata } : {},
      iteration: 0,
    };
  }

  // 返回当前上下文的深拷贝，避免外部直接修改内部状态
  public getSnapshot(): AgentContextSnapshot {
    return deepClone(this.snapshot);
  }

  // 更新当前激活任务并递增迭代计数
  public setActiveTask(taskId: string | null): void {
    this.snapshot = {
      ...this.snapshot,
      activeTaskId: taskId,
      iteration: this.snapshot.iteration + 1,
    };
  }

  // 新增或更新任务节点，自动补齐时间戳与子任务列表
  public upsertTask(task: TaskNode): void {
    const now = Date.now();
    const existing = this.snapshot.tasks[task.taskId];
    const normalized: TaskNode = {
      ...task,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      children: task.children ?? existing?.children ?? [],
    };

    this.snapshot = {
      ...this.snapshot,
      tasks: {
        ...this.snapshot.tasks,
        [task.taskId]: normalized,
      },
    };
  }

  // 将指定子任务挂载到父任务下，避免重复关联
  public linkChild(parentId: string, childId: string): void {
    const parent = this.snapshot.tasks[parentId];
    if (!parent) return;
    if (parent.children.includes(childId)) return;
    this.snapshot = {
      ...this.snapshot,
      tasks: {
        ...this.snapshot.tasks,
        [parentId]: {
          ...parent,
          children: [...parent.children, childId],
          updatedAt: Date.now(),
        },
      },
    };
  }

  // 追加一条观测记录，供后续规划和反思使用
  public addObservation(observation: Observation): void {
    this.snapshot = {
      ...this.snapshot,
      observations: [...this.snapshot.observations, observation],
    };
  }

  // 合并新的工作记忆字段，保持已有键值
  public mergeWorkingMemory(memory: Record<string, unknown>): void {
    this.snapshot = {
      ...this.snapshot,
      workingMemory: { ...this.snapshot.workingMemory, ...memory },
    };
  }

  // 对快照执行部分更新，同时处理工作记忆/元数据合并与迭代计数
  public patch(update: AgentContextUpdate): void {
    this.snapshot = {
      ...this.snapshot,
      ...update,
      workingMemory: {
        ...this.snapshot.workingMemory,
        ...(update.workingMemory ?? {}),
      },
      metadata: {
        ...this.snapshot.metadata,
        ...(update.metadata ?? {}),
      },
      observations: update.observations ?? this.snapshot.observations,
      tasks: update.tasks ?? this.snapshot.tasks,
      iteration:
        update.iteration ?? (update.activeTaskId ? this.snapshot.iteration + 1 : this.snapshot.iteration),
    };
  }
}

function deepClone<T>(value: T): T {
  const sc = (globalThis as { structuredClone?: <U>(v: U) => U }).structuredClone;
  if (typeof sc === 'function') {
    return sc(value);
  }
  return JSON.parse(JSON.stringify(value));
}
