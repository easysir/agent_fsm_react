import { useMemo } from 'react';
import { useRuntimeStore } from '../store/runtimeStore';

export function RuntimeHeader() {
  const { status, snapshots, connect, disconnect } = useRuntimeStore((state) => ({
    status: state.status,
    snapshots: state.snapshots,
    connect: state.connect,
    disconnect: state.disconnect,
  }));

  const latest = snapshots[snapshots.length - 1];
  const activeTask = useMemo(() => {
    if (!latest?.activeTaskId) return null;
    return latest.tasks[latest.activeTaskId];
  }, [latest]);

  return (
    <header className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className="panel-title">Agent Runtime Monitor</h1>
        <button
          type="button"
          onClick={status === 'connected' ? disconnect : connect}
          style={{
            padding: '0.5rem 1rem',
            borderRadius: '8px',
            border: 'none',
            cursor: 'pointer',
            background: status === 'connected' ? '#f97316' : '#2563eb',
            color: 'white',
            fontWeight: 600,
          }}
        >
          {status === 'connected' ? 'Disconnect' : 'Start'}
        </button>
      </div>
      <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
        <StatusBadge label="Status" value={status} tone={status === 'connected' ? 'green' : 'gray'} />
        <StatusBadge label="Iterations" value={latest?.iteration ?? 0} tone="blue" />
        <StatusBadge label="Active Task" value={activeTask?.description ?? 'Idle'} tone="purple" />
      </div>
    </header>
  );
}

interface StatusBadgeProps {
  label: string;
  value: string | number;
  tone: 'green' | 'gray' | 'blue' | 'purple';
}

function StatusBadge({ label, value, tone }: StatusBadgeProps) {
  const palette: Record<StatusBadgeProps['tone'], string> = {
    green: '#16a34a',
    gray: '#64748b',
    blue: '#2563eb',
    purple: '#7c3aed',
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      <span style={{ fontSize: '0.8rem', color: '#64748b', textTransform: 'uppercase' }}>{label}</span>
      <span style={{ fontSize: '1.1rem', fontWeight: 600, color: palette[tone] }}>{value}</span>
    </div>
  );
}
