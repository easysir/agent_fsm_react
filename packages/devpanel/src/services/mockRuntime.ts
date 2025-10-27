import { nanoid } from 'nanoid';
import type { AgentContextSnapshot, BusEvent, TaskNode } from '../types';

interface RuntimeCallbacks {
  onSnapshot: (snapshot: AgentContextSnapshot) => void;
  onEvent: (event: BusEvent) => void;
}

interface ScriptStep {
  delay: number;
  snapshot?: AgentContextSnapshot;
  events?: BusEvent[];
}

export function connectMockRuntime(callbacks: RuntimeCallbacks): () => void {
  const now = Date.now();

  const task: TaskNode = {
    taskId: 'task-root',
    description: 'Collect diagnostic data from echo tool',
    status: 'pending',
    children: [],
    createdAt: now,
    updatedAt: now,
  };

  const snapshots: AgentContextSnapshot[] = [
    {
      agentId: 'demo-agent',
      rootTaskId: task.taskId,
      activeTaskId: task.taskId,
      tasks: { [task.taskId]: task },
      observations: [],
      workingMemory: {},
      metadata: {},
      iteration: 0,
    },
    {
      agentId: 'demo-agent',
      rootTaskId: task.taskId,
      activeTaskId: task.taskId,
      tasks: {
        [task.taskId]: {
          ...task,
          status: 'in_progress',
          updatedAt: now + 1000,
        },
      },
      observations: [],
      workingMemory: {},
      metadata: {},
      iteration: 1,
    },
    {
      agentId: 'demo-agent',
      rootTaskId: task.taskId,
      activeTaskId: null,
      tasks: {
        [task.taskId]: {
          ...task,
          status: 'succeeded',
          updatedAt: now + 2000,
        },
      },
      observations: [
        {
          source: 'tool',
          relatedTaskId: task.taskId,
          timestamp: now + 1500,
          payload: { message: 'Echoing task task-root', goal: task.description },
          success: true,
          latencyMs: 230,
        },
      ],
      workingMemory: {},
      metadata: {},
      iteration: 2,
    },
  ];

  const events: BusEvent[] = [
    makeEvent('agent.transition', now, { state: 'plan', iteration: 0 }),
    makeEvent('tool.request', now + 500, { toolId: 'echo', taskId: task.taskId }),
    makeEvent('tool.result', now + 900, {
      toolId: 'echo',
      taskId: task.taskId,
      success: true,
      latencyMs: 230,
    }),
    makeEvent('agent.transition', now + 1200, { state: 'reflect', iteration: 1 }),
    makeEvent('agent.finished', now + 2000, { state: 'finish', iteration: 2 }),
  ];

  const script: ScriptStep[] = [
    { delay: 0, snapshot: snapshots[0], events: [events[0]] },
    { delay: 600, snapshot: snapshots[1], events: [events[1], events[2]] },
    { delay: 1300, events: [events[3]] },
    { delay: 2000, snapshot: snapshots[2], events: [events[4]] },
  ];

  const timers = script.map((step) =>
    setTimeout(() => {
      if (step.snapshot) callbacks.onSnapshot(step.snapshot);
      step.events?.forEach(callbacks.onEvent);
    }, step.delay),
  );

  return () => timers.forEach(clearTimeout);
}

function makeEvent(type: BusEvent['type'], timestamp: number, payload: Record<string, unknown>): BusEvent {
  return {
    eventId: nanoid(),
    type,
    timestamp,
    traceId: payload['taskId']?.toString() ?? 'trace-id',
    relatedTaskId: payload['taskId']?.toString(),
    payload,
  };
}
