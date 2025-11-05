import type { AgentContextSnapshot, BusEvent } from "../types";

interface RuntimeCallbacks {
  onSnapshot: (snapshot: AgentContextSnapshot) => void;
  onEvent: (event: BusEvent) => void;
  onError?: (error: Error) => void;
  onConnected?: () => void; // 连接成功回调
}

interface BridgeConfig {
  /** 桥接服务器地址，默认为 http://localhost:3030 */
  baseUrl?: string;
}

/**
 * 连接到真实的 devpanelBridge 服务器
 *
 * @param callbacks 事件回调函数
 * @param config 连接配置
 * @returns 清理函数，用于断开连接
 */
export function connectBridgeRuntime(
  callbacks: RuntimeCallbacks,
  config: BridgeConfig = {}
): () => void {
  const baseUrl = config.baseUrl ?? "http://localhost:3030";
  // EventSource 是浏览器原生 Web API，类型定义已包含在 TypeScript 标准库中
  let eventSource: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    try {
      // 连接到 SSE 事件流
      // EventSource 是浏览器原生 Web API，无需导入即可使用
      // 这行代码是建立 SSE（Server-Sent Events）连接的核心
      eventSource = new EventSource(`${baseUrl}/events`);

      eventSource.addEventListener("snapshot", (e) => {
        try {
          const snapshot = JSON.parse(e.data) as AgentContextSnapshot;
          callbacks.onSnapshot(snapshot);
        } catch (error) {
          console.error("Failed to parse snapshot:", error);
        }
      });

      eventSource.addEventListener("bus-event", (e) => {
        try {
          const event = JSON.parse(e.data) as BusEvent;
          callbacks.onEvent(event);
        } catch (error) {
          console.error("Failed to parse event:", error);
        }
      });

      eventSource.onerror = (error) => {
        console.error("SSE connection error:", error);
        callbacks.onError?.(new Error("SSE connection failed"));
        // 尝试重连
        if (eventSource?.readyState === EventSource.CLOSED) {
          reconnectTimer = setTimeout(() => {
            connect();
          }, 3000);
        }
      };

      eventSource.onopen = () => {
        console.log("Connected to devpanel bridge");
        // 连接成功时调用回调，更新连接状态
        callbacks.onConnected?.();
      };
    } catch (error) {
      console.error("Failed to connect to bridge:", error);
      callbacks.onError?.(
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  connect();

  return () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }
    eventSource?.close();
    eventSource = null;
  };
}

/**
 * 发送任务到桥接服务器执行
 *
 * @param rootTask 根任务定义
 * @param metadata 可选的元数据
 * @param config 连接配置
 * @returns Promise 返回执行结果
 */
export async function runTask(
  rootTask: {
    taskId?: string;
    description: string;
    status?: "pending" | "in_progress" | "succeeded" | "failed";
    parentId?: string;
    children?: string[];
    metadata?: Record<string, unknown>;
  },
  metadata?: Record<string, unknown>,
  config: BridgeConfig = {}
): Promise<{
  state: string;
  iterations: number;
  lastObservation: unknown;
  executionResult: unknown;
  finalSnapshot: AgentContextSnapshot;
}> {
  const baseUrl = config.baseUrl ?? "http://localhost:3030";

  const response = await fetch(`${baseUrl}/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      rootTask: {
        taskId: rootTask.taskId ?? `task-${Date.now()}`,
        description: rootTask.description,
        status: rootTask.status ?? "pending",
        ...(rootTask.parentId ? { parentId: rootTask.parentId } : {}),
        ...(rootTask.children ? { children: rootTask.children } : {}),
        ...(rootTask.metadata ? { metadata: rootTask.metadata } : {}),
      },
      ...(metadata ? { metadata } : {}),
    }),
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: "Unknown error" }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * 检查桥接服务器健康状态
 *
 * @param config 连接配置
 * @returns Promise 返回是否健康
 */
export async function checkHealth(config: BridgeConfig = {}): Promise<boolean> {
  const baseUrl = config.baseUrl ?? "http://localhost:3030";

  try {
    const response = await fetch(`${baseUrl}/health`);
    if (!response.ok) return false;
    const data = await response.json();
    return data.status === "ok";
  } catch {
    return false;
  }
}
