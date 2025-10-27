import { useEffect } from 'react';
import { RuntimeHeader } from './components/RuntimeHeader';
import { TaskTree } from './components/TaskTree';
import { EventTimeline } from './components/EventTimeline';
import { ToolActivity } from './components/ToolActivity';
import { useRuntimeStore } from './store/runtimeStore';

export default function App() {
  const connect = useRuntimeStore((state) => state.connect);

  useEffect(() => {
    connect();
  }, [connect]);

  return (
    <div className="page">
      <RuntimeHeader />
      <div className="grid">
        <TaskTree />
        <ToolActivity />
      </div>
      <EventTimeline />
    </div>
  );
}
