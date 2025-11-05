import { useState } from 'react';
import { useRuntimeStore } from '../store/runtimeStore';

export function TaskInput() {
  const [description, setDescription] = useState('');
  const { runTask, isRunning, status, error } = useRuntimeStore((state) => ({
    runTask: state.runTask,
    isRunning: state.isRunning,
    status: state.status,
    error: state.error,
  }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) return;
    
    // 在提交时检查连接状态（这个检查在 runTask 中也会做，但这里提前返回避免不必要的调用）
    if (status !== 'connected') {
      return;
    }
    
    const taskDescription = description.trim();
    await runTask(taskDescription);
    // 任务提交后清空输入框（无论成功与否，因为任务已经提交）
    setDescription('');
  };

  // 只在运行中时禁用，允许用户随时输入
  const isDisabled = isRunning;

  return (
    <div className="panel" style={{ marginBottom: '1rem' }}>
      <h2 style={{ marginTop: 0, marginBottom: '1rem', fontSize: '1.2rem' }}>
        执行任务
      </h2>
      
      {error && (
        <div
          style={{
            padding: '0.75rem',
            marginBottom: '1rem',
            backgroundColor: '#fee2e2',
            border: '1px solid #fca5a5',
            borderRadius: '6px',
            color: '#991b1b',
            fontSize: '0.9rem',
          }}
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={
              status === 'connected'
                ? '输入任务描述，例如：计算 123 + 456'
                : '请先连接服务器（点击右上角 Start）'
            }
            disabled={isDisabled}
            style={{
              flex: 1,
              padding: '0.75rem',
              border: status === 'connected' ? '1px solid #d1d5db' : '1px solid #fbbf24',
              borderRadius: '6px',
              fontSize: '1rem',
              backgroundColor: isDisabled ? '#f3f4f6' : 'white',
              color: isDisabled ? '#9ca3af' : 'inherit',
              cursor: isDisabled ? 'not-allowed' : 'text',
            }}
          />
          <button
            type="submit"
            disabled={isDisabled || !description.trim() || status !== 'connected'}
            style={{
              padding: '0.75rem 1.5rem',
              backgroundColor:
                isDisabled || status !== 'connected' || !description.trim()
                  ? '#9ca3af'
                  : '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor:
                isDisabled || status !== 'connected' || !description.trim()
                  ? 'not-allowed'
                  : 'pointer',
              fontWeight: 600,
              fontSize: '1rem',
              whiteSpace: 'nowrap',
            }}
          >
            {isRunning ? '执行中...' : '执行'}
          </button>
        </div>
      </form>

      {status !== 'connected' && (
        <div
          style={{
            marginTop: '0.75rem',
            padding: '0.75rem',
            backgroundColor: '#fef3c7',
            border: '1px solid #fbbf24',
            borderRadius: '6px',
            fontSize: '0.875rem',
            color: '#92400e',
          }}
        >
          <strong>提示：</strong>请先点击右上角的 <strong>"Start"</strong> 按钮连接到桥接服务器，然后才能执行任务。
        </div>
      )}
    </div>
  );
}

