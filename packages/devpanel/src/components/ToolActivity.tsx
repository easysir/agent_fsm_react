import { useMemo } from 'react';
import { useRuntimeStore } from '../store/runtimeStore';

interface ToolSession {
  traceId: string;
  toolId?: string;
  taskId?: string;
  requestAt?: number;
  resultAt?: number;
  success?: boolean;
  latencyMs?: number;
  payload?: Record<string, unknown>;
}

export function ToolActivity() {
  const events = useRuntimeStore((state) => state.events);

  const sessions = useMemo(() => {
    const grouped = new Map<string, ToolSession>();
    events
      .filter((event) => event.type === 'tool.request' || event.type === 'tool.result')
      .forEach((event) => {
        const traceId = event.traceId;
        const session = grouped.get(traceId) ?? { traceId };
        if (event.type === 'tool.request') {
          session.toolId = event.payload.toolId as string;
          session.taskId = event.payload.taskId as string;
          session.requestAt = event.timestamp;
        } else {
          session.resultAt = event.timestamp;
          const resultPayload =
            (event.payload.result as Record<string, unknown> | undefined) ??
            (event.payload as Record<string, unknown>);
          session.success =
            typeof resultPayload.success === 'boolean'
              ? (resultPayload.success as boolean)
              : session.success;
          session.latencyMs =
            typeof resultPayload.latencyMs === 'number'
              ? (resultPayload.latencyMs as number)
              : session.latencyMs;
          session.payload = resultPayload;
        }
        grouped.set(traceId, session);
      });
    return Array.from(grouped.values()).sort((a, b) => (b.requestAt ?? 0) - (a.requestAt ?? 0));
  }, [events]);

  return (
    <section className="panel">
      <h2 className="panel-title">Tool Activity</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {sessions.length === 0 && <span style={{ color: '#94a3b8' }}>No tool activity yet.</span>}
        {sessions.map((session) => (
          <div
            key={session.traceId}
            style={{
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              padding: '0.75rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
            }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{session.toolId ?? 'Unknown tool'}</div>
                  <div style={{ color: '#64748b', fontSize: '0.8rem' }}>{session.taskId}</div>
                </div>
                <StatusBadge success={session.success} />
              </div>
            <div style={{ fontSize: '0.85rem', color: '#334155' }}>
              {session.latencyMs ? `${session.latencyMs} ms` : 'Latency N/A'}
            </div>
            {session.payload && (
              <pre
                style={{
                  background: '#0f172a',
                  color: '#e2e8f0',
                  borderRadius: '8px',
                  padding: '0.75rem',
                  margin: 0,
                  fontSize: '0.75rem',
                }}
              >
                {JSON.stringify(session.payload, null, 2)}
              </pre>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function StatusBadge({ success }: { success: boolean | undefined }) {
  let label = 'Pending';
  let color = '#737373';
  if (success === true) {
    label = 'Success';
    color = '#16a34a';
  } else if (success === false) {
    label = 'Failed';
    color = '#dc2626';
  }
  return (
    <span
      style={{
        padding: '0.25rem 0.75rem',
        borderRadius: '999px',
        fontSize: '0.75rem',
        fontWeight: 600,
        color: 'white',
        background: color,
      }}
    >
      {label}
    </span>
  );
}
