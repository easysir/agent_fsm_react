import { create } from 'zustand';
import type { AgentContextSnapshot, BusEvent } from '../types';
import { connectBridgeRuntime, runTask as bridgeRunTask, checkHealth } from '../services/bridgeRuntime';

type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error';

interface RuntimeStoreState {
  status: ConnectionStatus;
  snapshots: AgentContextSnapshot[];
  events: BusEvent[];
  isRunning: boolean;
  error: string | null;
  bridgeUrl: string;
  connect: () => void;
  disconnect: () => void;
  runTask: (description: string, metadata?: Record<string, unknown>) => Promise<void>;
  setBridgeUrl: (url: string) => void;
}

let teardown: (() => void) | null = null;

export const useRuntimeStore = create<RuntimeStoreState>((set, get) => ({
  status: 'idle',
  snapshots: [],
  events: [],
  isRunning: false,
  error: null,
  bridgeUrl: 'http://localhost:3030',
  connect: async () => {
    if (get().status === 'connected') return;
    
    const { bridgeUrl } = get();
    set({ status: 'connecting', error: null });
    
    // 先检查服务器健康状态
    const isHealthy = await checkHealth({ baseUrl: bridgeUrl });
    if (!isHealthy) {
      set({ 
        status: 'error', 
        error: `无法连接到桥接服务器: ${bridgeUrl}。请确保 devpanelBridge 正在运行。` 
      });
      return;
    }

    teardown?.();
    teardown = connectBridgeRuntime(
      {
        onConnected: () => {
          // SSE 连接成功时，立即更新状态为 connected
          set({ status: 'connected', error: null });
        },
        onSnapshot: (snapshot) =>
          set((state) => ({
            snapshots: [...state.snapshots, snapshot],
            // 确保状态保持为 connected（可能在某些情况下状态被重置）
            status: 'connected',
            error: null,
          })),
        onEvent: (event) =>
          set((state) => ({
            events: [...state.events, event],
          })),
        onError: (error) => {
          set({ 
            status: 'error', 
            error: error.message || '连接错误' 
          });
        },
      },
      { baseUrl: bridgeUrl }
    );
  },
  disconnect: () => {
    teardown?.();
    teardown = null;
    set({ status: 'idle', snapshots: [], events: [], error: null });
  },
  runTask: async (description: string, metadata?: Record<string, unknown>) => {
    const { bridgeUrl, status } = get();
    
    if (status !== 'connected') {
      set({ error: '请先连接到桥接服务器' });
      return;
    }

    if (get().isRunning) {
      set({ error: '任务正在执行中，请等待完成' });
      return;
    }

    try {
      set({ isRunning: true, error: null });
      await bridgeRunTask(
        {
          description,
          status: 'pending',
        },
        metadata,
        { baseUrl: bridgeUrl }
      );
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : '任务执行失败' 
      });
    } finally {
      set({ isRunning: false });
    }
  },
  setBridgeUrl: (url: string) => {
    set({ bridgeUrl: url });
  },
}));
