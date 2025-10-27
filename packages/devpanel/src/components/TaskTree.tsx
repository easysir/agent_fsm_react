import type { TaskNode } from '../types';
import { useRuntimeStore } from '../store/runtimeStore';

export function TaskTree() {
  const snapshots = useRuntimeStore((state) => state.snapshots);
  const latest = snapshots[snapshots.length - 1];

  if (!latest) {
    return (
      <section className="panel">
        <h2 className="panel-title">Task Tree</h2>
        <span style={{ color: '#94a3b8' }}>No data yet. Start the runtime to populate the tree.</span>
      </section>
    );
  }

  const root = latest.tasks[latest.rootTaskId];
  return (
    <section className="panel">
      <h2 className="panel-title">Task Tree</h2>
      <div>
        <TaskNodeView node={root} allTasks={latest.tasks} depth={0} />
      </div>
    </section>
  );
}

interface TaskNodeViewProps {
  node: TaskNode;
  allTasks: Record<string, TaskNode>;
  depth: number;
}

function TaskNodeView({ node, allTasks, depth }: TaskNodeViewProps) {
  const children = node.children.map((childId) => allTasks[childId]).filter(Boolean);
  return (
    <div style={{ marginLeft: depth * 16, marginBottom: '0.5rem' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
          padding: '0.5rem 0.75rem',
          background: '#f1f5f9',
          borderRadius: '8px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontWeight: 600 }}>{node.description}</span>
          <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{node.taskId}</span>
        </div>
        <StatusPill status={node.status} />
      </div>
      {children.length > 0 && (
        <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {children.map((child) => (
            <TaskNodeView key={child.taskId} node={child} allTasks={allTasks} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: TaskNode['status'] }) {
  const palette: Record<TaskNode['status'], string> = {
    pending: '#f59e0b',
    in_progress: '#2563eb',
    succeeded: '#16a34a',
    failed: '#dc2626',
  };
  return (
    <span
      style={{
        padding: '0.25rem 0.75rem',
        borderRadius: '999px',
        fontSize: '0.75rem',
        fontWeight: 600,
        color: 'white',
        background: palette[status],
        textTransform: 'capitalize',
      }}
    >
      {status.replace('_', ' ')}
    </span>
  );
}
