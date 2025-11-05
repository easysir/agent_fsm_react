# Agent ReAct FSM Framework – Architecture Overview

## 1. 背景与目标

本框架构建了一个基于有限状态机（FSM）的 ReAct（Plan → Act → Observe → Reflect → Finish）智能体执行环境，支持动态子任务规划、自愈/回退策略和可插拔工具调用，同时提供直观的调试观测前端。

核心目标：

- **结构紧凑**：模块划分清晰，职责单一，可在单进程和多实例环境中运行
- **可扩展**：Planner/工具/策略均以插件形式装配，可按配置启用和热插拔
- **稳定高效**：状态管理、事件调度和工具调用具备高可靠性与性能保障
- **可观测**：内置日志、度量、追踪与重放能力，配合 React 调试面板快速定位问题

## 2. 总体架构

```
┌─────────────────────────┐
│        AgentRuntime      │  管理生命周期、并发、资源、实例注册
├─────────────────────────┤
│   StateMachine (Plan→…)  │  通过 xstate 驱动循环
├─────────────────────────┤
│       AgentContext       │  存储上下文、任务树、记忆、配置
├─────────────────────────┤
│          EventBus        │  工具/用户/系统事件总线
└─────────────────────────┘
         │
         │ SSE / HTTP
         ↓
┌─────────────────────────┐
│    devpanelBridge        │  HTTP 服务器，提供 SSE 事件流和 REST API
└─────────────────────────┘
         │
         │ EventSource / Fetch
         ↓
┌─────────────────────────┐
│    React DevPanel        │  可视化调试面板
└─────────────────────────┘
```

React 调试面板通过 **Server-Sent Events (SSE)** 订阅 `AgentRuntime` 暴露的状态流和事件日志，实现实时可视化与人工干预。

## 3. 核心模块职责

| 模块           | 作用                                                | 扩展方式                                                 |
| -------------- | --------------------------------------------------- | -------------------------------------------------------- |
| AgentRuntime   | 管控 Agent 实例生命周期、调度和监控                 | 通过配置管理自定义 Agent 类型；提供事件流和快照流        |
| StateMachine   | 实现 Plan → Act → Observe → Reflect → Finish 状态流 | 基于 xstate，支持自定义状态插入（例如 Error、Pause）     |
| AgentContext   | 保存任务树、工作记忆、历史 Observation、全局配置    | 提供事务式更新和快照功能，防止竞态；支持持久化适配器     |
| Planner        | 依据上下文生成 PlanStep 和子任务                    | 插件化策略：LLM 驱动（如 BaselinePlanner）、规则、模板等 |
| Executor       | 执行 PlanStep，触发工具适配层                       | 通过 ToolAdapter 扩展工具调用；内置重试/并发控制         |
| Observer       | 消费 EventBus，写入 Observation                     | 支持多事件源（工具结果、用户输入、系统告警）             |
| Reflector      | 校验结果、决定自愈策略或完成状态                    | 插件化策略，支持回退、重试、替换工具、人工请求           |
| devpanelBridge | HTTP 桥接服务器，连接运行时和前端面板               | 提供 SSE 事件流、REST API（/run, /health）               |

## 4. 数据结构

- **AgentContextSnapshot**：AgentContext 的不可变视图，用于在 Planner/Reflector 中安全读取
- **TaskNode**：描述任务树节点（`taskId`, `description`, `status`, `parentId`, `children`, `metadata`, `createdAt`, `updatedAt`）
- **PlanStep**：Planner 输出的步骤（`taskId`, `goal`, `toolCandidates`, `successCriteria`, `timeoutMs`, `retryLimit`, `next`, `toolParameters`）
- **Observation**：执行结果的结构化描述（`source`, `relatedTaskId`, `timestamp`, `payload`, `success`, `latencyMs`, `error`）
- **BusEvent**：总线统一协议（`eventId`, `type`, `timestamp`, `traceId`, `relatedTaskId`, `payload`）

## 5. 状态机流程

1. **Plan**：读取当前任务节点，调用 Planner 生成 `PlanStep`；按需插入子任务入栈
2. **Act**：根据 `PlanStep` 触发工具调用或直接生成回答；向 EventBus 推送 `tool.request`
3. **Observe**：监听工具返回或外部事件，将其映射为 `Observation`，写入 AgentContext
4. **Reflect**：用成功标准校验 Observation，决定推进、重试、回退、替换工具或请求人工输入
5. **Finish**：任务栈清空或命中终止条件后生成最终输出，释放资源并发布 `agent.finished`

异常在任何状态出现都进入 `Error` 子状态，由自愈策略决定是否回退或终止。

## 6. 事件协议与 Tool Adapter

### 事件类型

- `tool.request`：工具调用请求
- `tool.result`：工具执行结果
- `user.input`：用户输入
- `system.alert`：系统告警
- `agent.transition`：Agent 状态转换
- `agent.log`：Agent 日志
- `agent.finished`：Agent 完成

### Tool Adapter

`ToolAdapter` 统一接口：

```typescript
interface ToolAdapter {
  id: string;
  description: string;
  execute(input: ToolInput): Promise<ToolResult>;
}
```

EventBus 默认流程：Act 状态发布 `tool.request` → ToolAdapter 执行 → Observer 接收 `tool.result` → Reflect 处理。

支持同步调用（函数、进程内）与异步服务（HTTP、队列），通过配置开关。

## 7. 自愈与安全策略

### 全局 Guard

- `maxIterations`：最大循环次数
- `maxDurationMs`：最大执行时长（毫秒）
- `maxFailures`：最大连续失败次数

### 自愈策略

- **重试**：同一步骤重试
- **回退**：回退到父任务
- **替换工具**：使用 fallback 工具
- **请求用户输入**：等待人工干预
- **终止**：放弃任务

### 安全检查

工具调用前后进行权限验证、输出过滤（防止越权、敏感信息泄露）。

## 8. 可观测性

### 实时监控

- **SSE 事件流**：通过 `/events` 端点推送实时事件和快照
- **历史数据**：新客户端连接时自动接收完整历史上下文
- **事件广播**：所有连接的客户端实时接收更新

### 数据结构

- **事件历史**：`eventHistory: BusEvent[]` - 所有总线事件
- **快照历史**：`snapshotHistory: AgentContextSnapshot[]` - 所有上下文快照

## 9. 调试面板（React DevPanel）

### 功能特性

- **状态总览**：显示当前状态、循环次数、告警 badge
- **任务树视图**：树形组件展示 TaskNode，包含状态、最近 Observation、子任务
- **事件时间轴**：时间顺序渲染 Plan/Act/Tool/Reflect 事件，可过滤、搜索、展开详情
- **工具监控**：显示请求/响应、耗时、重试记录
- **任务执行**：通过输入框发送任务，实时查看执行过程

### 技术实现

- **前端**：React + Zustand 状态管理
- **连接方式**：EventSource (SSE) 订阅实时事件，Fetch API 发送任务请求
- **UI 框架**：原生 CSS + 内联样式

### 连接流程

1. 前端调用 `checkHealth()` 检查服务器状态
2. 建立 SSE 连接到 `/events` 端点
3. 接收历史快照和事件（如果有）
4. 持续接收实时事件和快照更新
5. 通过 POST `/run` 发送任务请求

## 10. devpanelBridge 服务器

### API 端点

- **GET `/health`**：健康检查，返回 `{ status: "ok" }`
- **GET `/events`**：SSE 事件流，推送实时事件和快照
- **POST `/run`**：执行 Agent 任务，返回执行结果

### 功能特性

- **CORS 支持**：处理 OPTIONS 预检请求，支持跨域访问
- **连接管理**：维护所有 SSE 客户端连接集合
- **历史同步**：新客户端连接时自动发送完整历史数据
- **事件广播**：向所有连接的客户端广播新事件和快照
- **串行执行**：确保任务按顺序执行，避免并发冲突

## 11. 测试策略

- **单元测试**：覆盖 AgentContext 更新、任务树操作、状态转换、事件处理、ToolAdapter 行为
- **集成测试**：模拟完整回合（输入 →Plan→Act→Observe→Reflect→Finish），包含成功与失败路径
- **回归测试**：针对常见异常（网络中断、超时、权限错误、循环限制）建立固定脚本
- **前端**：组件测试和集成测试，验证事件流与 UI 更新一致性

## 12. 部署与配置

### 开发环境

- **桥接服务器**：`pnpm --filter @agent/runtime dev:bridge`，默认端口 3030
- **开发面板**：`pnpm --filter @agent/react-devpanel dev`，默认端口 5173

### 生产环境

- **配置中心**：使用 YAML/JSON 描述工具、策略、Prompt 模板，运行时热加载
- **部署**：单实例时采用 Node 服务 + React 静态资源；多实例通过容器编排（Docker/Kubernetes），EventBus 可替换为 Kafka/NATS
- **安全**：后端暴露接口需鉴权，前端 WebSocket/REST 需 Token；对外部工具调用配置流控和熔断

## 13. 后续扩展

- **多 Agent 协作**：共享 EventBus，由 Coordinator 调度多个 AgentRuntime 协同完成复杂任务
- **记忆增强**：引入向量数据库存储长期记忆，AgentContext 只保留短期工作记忆
- **策略学习**：基于回放数据训练 Planner/Reflect 策略，自动优化重试与回退阈值
- **持久化**：支持上下文快照和事件历史的持久化存储
- **性能优化**：添加事件过滤、快照压缩等优化机制
