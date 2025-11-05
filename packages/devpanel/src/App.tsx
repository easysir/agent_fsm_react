import { useEffect } from 'react';
import { RuntimeHeader } from './components/RuntimeHeader';
import { TaskTree } from './components/TaskTree';
import { EventTimeline } from './components/EventTimeline';
import { ToolActivity } from './components/ToolActivity';
import { TaskInput } from './components/TaskInput';
import { useRuntimeStore } from './store/runtimeStore';

export default function App() {
  const connect = useRuntimeStore((state) => state.connect);

  useEffect(() => {
    // 不再自动连接，让用户手动点击连接
    // connect();
  }, [connect]);

  return (
    <div className="page">
      <RuntimeHeader />
      <TaskInput />
      <div className="grid">
        <TaskTree />
        <ToolActivity />
      </div>
      <EventTimeline />
    </div>
  );
}
