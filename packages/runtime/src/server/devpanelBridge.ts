import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { AgentRuntime } from "../core/AgentRuntime.js";
import { InMemoryToolRegistry } from "../registry/ToolRegistry.js";
import { EchoTool } from "../tools/EchoTool.js";
import { MathTool } from "../tools/MathTool.js";
import { CodeReadFileTool } from "../tools/CodeReadFileTool.js";
import { CodeSearchTool } from "../tools/CodeSearchTool.js";
import { CodeSummarizeTool } from "../tools/CodeSummarizeTool.js";
import { CodeTestRunnerTool } from "../tools/CodeTestRunnerTool.js";
import { ShellSearchTool } from "../tools/ShellSearchTool.js";
import { CodeWriteFileTool } from "../tools/CodeWriteFileTool.js";
import { CodeEnsureDirTool } from "../tools/CodeEnsureDirTool.js";
import { ShellCommandTool } from "../tools/ShellCommandTool.js";
import { CodeGenerateSnippetTool } from "../tools/CodeGenerateSnippetTool.js";
import { BaselinePlanner } from "../planner/BaselinePlanner.js";
import { BaselineReflector } from "../reflector/BaselineReflector.js";
import type {
  AgentRunInput,
  AgentRunResult,
  AgentContextSnapshot,
  BusEvent,
} from "../types/index.js";

const WORKSPACE_ROOT = "/Users/bytedance/Desktop/playground";
const LLM_TIMEOUT_MS =
  Number.parseInt(process.env.DEVPANEL_LLM_TIMEOUT_MS ?? "", 10) || 60_000;

try {
  process.chdir(WORKSPACE_ROOT);
  // eslint-disable-next-line no-console
  console.log(`[devpanel-bridge] cwd set to ${WORKSPACE_ROOT}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(
    `[devpanel-bridge] failed to set workspace root to ${WORKSPACE_ROOT}: ${message}`
  );
}

/**
 * 桥接服务器配置选项
 */
interface BridgeOptions {
  /** 服务器监听端口，默认为 3030 */
  port?: number;
  /** CORS 允许的源，默认为 "*"（允许所有源） */
  allowOrigin?: string;
}

/**
 * 执行任务请求体
 */
interface RunRequestBody {
  /** 根任务定义 */
  rootTask: AgentRunInput["rootTask"];
  /** 可选的元数据 */
  metadata?: AgentRunInput["metadata"];
}

/** SSE 客户端类型，使用 ServerResponse 表示 */
type SseClient = ServerResponse;

/**
 * 启动开发面板桥接服务器
 *
 * 该函数创建一个 HTTP 服务器，作为 AgentRuntime 和前端调试面板之间的桥梁。
 * 主要功能包括：
 * 1. 创建并配置 AgentRuntime 实例
 * 2. 订阅运行时的事件流和快照流
 * 3. 提供三个 HTTP 端点：
 *    - GET /health: 健康检查
 *    - GET /events: SSE 事件流，实时推送事件和快照
 *    - POST /run: 执行 Agent 任务
 *
 * @param options 桥接服务器配置选项
 */
export function startDevpanelBridge(options: BridgeOptions = {}): void {
  const port = options.port ?? 3030;
  const allowOrigin = options.allowOrigin ?? "*";

  // 存储历史事件和快照，用于新客户端连接时发送完整上下文
  const eventHistory: BusEvent[] = [];
  const snapshotHistory: AgentContextSnapshot[] = [];
  // 维护所有已连接的 SSE 客户端
  const clients = new Set<SseClient>();

  // 初始化工具注册表，注册 EchoTool 和 MathTool
  const toolRegistry = new InMemoryToolRegistry([
    new EchoTool(),
    new MathTool(),
    new CodeReadFileTool(),
    new CodeSearchTool(),
    new CodeSummarizeTool(),
    new CodeTestRunnerTool(),
    new ShellSearchTool(),
    new CodeWriteFileTool(),
    new CodeEnsureDirTool(),
    new ShellCommandTool(),
    new CodeGenerateSnippetTool(),
  ]);

  const runtime = new AgentRuntime({
    config: {
      agentId: "devpanel-agent",
      planner: new BaselinePlanner({
        toolRegistry,
        provider: "deepseek",
        llm: { requestTimeoutMs: LLM_TIMEOUT_MS },
      }),
      reflector: new BaselineReflector(),
      toolRegistry,
      guard: {
        maxIterations: 20,
        maxDurationMs: 120_000,
        maxFailures: 5,
      },
    },
  });

  // 当前正在执行的任务 Promise，用于确保任务串行执行
  let activeRun: Promise<AgentRunResult> | null = null;

  // 订阅运行时事件流，保存历史并广播给所有客户端
  runtime.streams.events$.subscribe((event) => {
    eventHistory.push(event);
    broadcast("bus-event", event);
  });

  // 订阅运行时快照流，保存历史并广播给所有客户端
  runtime.streams.snapshots$.subscribe((snapshot) => {
    snapshotHistory.push(snapshot);
    broadcast("snapshot", snapshot);
  });

  const server = createServer(async (req, res) => {
    if (!req.url) {
      res.writeHead(400);
      res.end();
      return;
    }

    // 处理 CORS 预检请求（OPTIONS）
    if (req.method === "OPTIONS") {
      setCorsHeaders(res, allowOrigin);
      res.writeHead(200);
      res.end();
      return;
    }

    // 健康检查端点：返回服务器状态
    if (req.method === "GET" && req.url === "/health") {
      setCorsHeaders(res, allowOrigin);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    // SSE 事件流端点：建立长连接，推送实时事件和快照
    if (req.method === "GET" && req.url === "/events") {
      handleSseConnection(res, allowOrigin);
      // 先发送所有历史快照，确保新客户端获得完整上下文
      snapshotHistory.forEach((snapshot) =>
        writeSse(res, "snapshot", snapshot)
      );
      // 再发送所有历史事件
      eventHistory.forEach((event) => writeSse(res, "bus-event", event));
      // 将客户端添加到连接集合
      clients.add(res);
      // 监听连接关闭，自动清理
      req.on("close", () => {
        clients.delete(res);
      });
      return;
    }

    // 执行任务端点：接收任务请求，执行 Agent 并返回结果
    if (req.method === "POST" && req.url === "/run") {
      // 先设置 CORS 头，确保即使出错也能正确返回
      setCorsHeaders(res, allowOrigin);
      try {
        // 读取请求体中的任务定义
        const body = await readJson<RunRequestBody>(req);
        // 如果没有提供根任务，使用默认任务
        const rootTask = body.rootTask ?? {
          taskId: `task-${Date.now()}`,
          description: "Default root task",
          status: "pending",
        };
        // 如果已有任务在执行，等待其完成（串行执行）
        if (activeRun) {
          await activeRun;
        }
        // 启动新的 Agent 任务执行
        activeRun = runtime.run({
          rootTask,
          ...(body.metadata ? { metadata: body.metadata } : {}),
        });
        // 等待任务完成并获取结果
        const runResult = await activeRun;
        activeRun = null;
        // 返回执行结果
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(runResult));
      } catch (error) {
        // 发生错误时清理状态并返回错误信息
        activeRun = null;
        const message =
          error instanceof Error ? error.message : String(error ?? "unknown");
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: message }));
      }
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[devpanel-bridge] listening on http://localhost:${port}`);
  });

  /**
   * 向所有连接的 SSE 客户端广播事件
   *
   * 当运行时产生新的事件或快照时，通过此函数将数据推送给所有已连接的客户端。
   * 这确保了前端调试面板能够实时接收到 Agent 的执行状态更新。
   *
   * @param event 事件类型（如 "snapshot" 或 "bus-event"）
   * @param payload 要广播的数据负载
   */
  function broadcast(event: string, payload: unknown) {
    const data = JSON.stringify(payload);
    for (const client of clients) {
      writeSse(client, event, payload, data);
    }
  }

  /**
   * 处理 SSE（Server-Sent Events）连接请求
   *
   * 设置 SSE 连接所需的 HTTP 响应头，包括：
   * - Content-Type: text/event-stream
   * - Cache-Control: no-cache（禁用缓存）
   * - Connection: keep-alive（保持连接）
   *
   * @param res HTTP 响应对象
   * @param origin CORS 允许的源
   */
  function handleSseConnection(res: ServerResponse, origin: string) {
    setCorsHeaders(res, origin);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("\n");
  }
}

/**
 * 向 SSE 客户端写入事件数据
 *
 * 按照 SSE 协议格式写入事件数据：
 * - event: <事件类型>
 * - data: <JSON 数据>
 *
 * @param res HTTP 响应对象（SSE 客户端连接）
 * @param event 事件类型名称
 * @param payload 要发送的数据负载
 * @param precomputedData 可选的预计算 JSON 字符串，避免重复序列化
 */
function writeSse(
  res: ServerResponse,
  event: string,
  payload: unknown,
  precomputedData?: string
) {
  const data = precomputedData ?? JSON.stringify(payload);
  res.write(`event: ${event}\n`);
  res.write(`data: ${data}\n\n`);
}

/**
 * 设置 CORS（跨域资源共享）响应头
 *
 * 允许前端应用从不同源访问桥接服务器的 API。
 *
 * @param res HTTP 响应对象
 * @param origin 允许的源（如 "*" 表示允许所有源）
 */
function setCorsHeaders(res: ServerResponse, origin: string) {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

/**
 * 从 HTTP 请求中读取并解析 JSON 数据
 *
 * 异步读取请求体的所有数据块，合并后解析为 JSON 对象。
 * 如果请求体为空，返回空对象。
 *
 * @param req HTTP 请求对象
 * @returns 解析后的 JSON 对象
 * @template T 返回值的类型
 */
async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (!raw) {
    return {} as T;
  }
  return JSON.parse(raw) as T;
}

// 如果直接运行此文件（而非作为模块导入），则启动桥接服务器
if (process.argv[1] === new URL(import.meta.url).pathname) {
  startDevpanelBridge();
}
