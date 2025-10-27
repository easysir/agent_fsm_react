import { create } from 'zustand';
import type { AgentContextSnapshot, BusEvent } from '../types';
import { connectMockRuntime } from '../services/mockRuntime';

type ConnectionStatus = 'idle' | 'connecting' | 'connected';

interface RuntimeStoreState {
  status: ConnectionStatus;
  snapshots: AgentContextSnapshot[];
  events: BusEvent[];
  connect: () => void;
  disconnect: () => void;
}

let teardown: (() => void) | null = null;

export const useRuntimeStore = create<RuntimeStoreState>((set, get) => ({
  status: 'idle',
  snapshots: [],
  events: [],
  connect: () => {
    if (get().status === 'connected') return;
    set({ status: 'connecting', snapshots: [], events: [] });
    teardown?.();
    teardown = connectMockRuntime({
      onSnapshot: (snapshot) =>
        set((state) => ({
          snapshots: [...state.snapshots, snapshot],
          status: 'connected',
        })),
      onEvent: (event) =>
        set((state) => ({
          events: [...state.events, event],
        })),
    });
  },
  disconnect: () => {
    teardown?.();
    teardown = null;
    set({ status: 'idle', snapshots: [], events: [] });
  },
}));
