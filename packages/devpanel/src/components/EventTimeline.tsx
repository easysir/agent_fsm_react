import { format } from 'date-fns';
import { useRuntimeStore } from '../store/runtimeStore';

export function EventTimeline() {
  const events = useRuntimeStore((state) => state.events);

  return (
    <section className="panel">
      <h2 className="panel-title">Event Timeline</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {events.length === 0 && <span style={{ color: '#94a3b8' }}>No events yet.</span>}
        {events.map((event) => (
          <div
            key={event.eventId}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.25rem',
              borderLeft: '3px solid #2563eb',
              paddingLeft: '0.75rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
              <span style={{ textTransform: 'capitalize' }}>{event.type.replace('.', ' · ')}</span>
              <span style={{ color: '#64748b', fontSize: '0.8rem' }}>
                {format(new Date(event.timestamp), 'HH:mm:ss')}
              </span>
            </div>
            <span style={{ fontSize: '0.85rem', color: '#334155' }}>
              {JSON.stringify(event.payload)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
