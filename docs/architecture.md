# Agent ReAct FSM Framework – Architecture Overview

## 1. 背景与目标
本框架旨在构建一个基于有限状态机（FSM）的 ReAct（Plan → Act → Observe → Reflect → Finish）智能体执行环境，支持动态子任务规划、自愈/回退策略和可插拔工具调用，同时提供直观的调试观测前端。核心目标如下：
- **结构紧凑**：模块划分清晰，职责单一，可在单进程和多实例环境中运行。
- **可扩展**：Planner/工具/策略均以插件形式装配，可按配置启用和热插拔。
- **稳定高效**：状态管理、事件调度和工具调用具备高可靠性与性能保障。
- **可观测**：内置日志、度量、追踪与重放能力，配合 React 调试面板快速定位问题。

## 2. 总体架构
```
┌─────────────────────────┐
│        AgentRuntime      │  管理生命周期、并发、资源、实例注册
├─────────────────────────┤
│   StateMachine (Plan→…)  │  通过 xstate/自研 FSM 驱动循环
├─────────────────────────┤
│       AgentContext       │  存储上下文、任务树、记忆、配置
├─────────────────────────┤
│          EventBus        │  工具/用户/系统事件总线
└─────────────────────────┘
```

React 调试面板通过 WebSocket/HTTP 订阅 `AgentRuntime` 暴露的状态流和事件日志，实现实时可视化与人工干预。

## 3. 核心模块职责
| 模块 | 作用 | 扩展方式 |
| --- | --- | --- |
| AgentRuntime | 管控 Agent 实例生命周期、调度和监控 | 通过注册中心管理自定义 Agent 类型；提供 REST/WebSocket API |
| StateMachine | 实现 Plan → Act → Observe → Reflect → Finish 状态流 | 可替换 FSM 实现；支持自定义状态插入（例如 Error、Pause） |
| AgentContext | 保存任务树、工作记忆、历史 Observation、全局配置 | 提供事务式更新和快照功能，防止竞态；支持持久化适配器 |
| Planner | 依据上下文生成 PlanStep 和子任务 | 插件化策略：LLM 驱动、规则、模板等 |
| Executor | 执行 PlanStep，触发工具适配层 | 通过 ToolAdapter 扩展工具调用；内置重试/并发控制 |
| Observer | 消费 EventBus，写入 Observation | 支持多事件源（工具结果、用户输入、系统告警） |
| Reflector | 校验结果、决定自愈策略或完成状态 | 插件化策略，支持回退、重试、替换工具、人工请求 |
| Finisher | 产出最终响应并清理资源 | 可定制汇总策略或复合输出格式 |

## 4. 数据结构
- **AgentContextSnapshot**：AgentContext 的不可变视图，用于在 Planner/Reflector 中安全读取。
- **TaskNode**：描述任务树节点（`taskId`, `description`, `status`, `dependencies`, `children`, `metadata`）。
- **PlanStep**：Planner 输出的步骤（`taskId`, `goal`, `toolCandidates`, `successCriteria`, `timeoutMs`, `next`）。
- **Observation**：执行结果的结构化描述（`source`, `payload`, `success`, `latencyMs`, `errors`）。
- **Event**：总线统一协议（`eventId`, `type`, `timestamp`, `payload`, `traceId`, `relatedTaskId`）。

## 5. 状态机流程
1. **Plan**：读取当前任务节点，调用 Planner 生成 `PlanStep`；按需插入子任务入栈。
2. **Act**：根据 `PlanStep` 触发工具调用或直接生成回答；向 EventBus 推送 `tool.request`/`agent.output`。
3. **Observe**：监听工具返回或外部事件，将其映射为 `Observation`，写入 AgentContext。
4. **Reflect**：用成功标准校验 Observation，决定推进、重试、回退、替换工具或请求人工输入。
5. **Finish**：任务栈清空或命中终止条件后生成最终输出，释放资源并发布 `agent.finished`。

异常在任何状态出现都进入 `Error` 子状态，由自愈策略决定是否回退或终止。

## 6. 事件协议与 Tool Adapter
- 事件类型：`tool.request`, `tool.result`, `user.input`, `system.alert`, `agent.transition`, `agent.log`。
- `ToolAdapter` 统一方法 `execute(input: ToolInput): Promise<ToolResult>`，封装鉴权、超时、重试、缓存。
- EventBus 默认流程：Act 状态发布 `tool.request` → ToolAdapter 执行 → Observer 接收 `tool.result` → Reflect 处理。
- 支持同步调用（函数、进程内）与异步服务（HTTP、队列），通过配置开关。

## 7. 自愈与安全策略
- 全局 Guard：最大循环次数、最大 wall-clock 时间、最大连续失败。
- 自愈策略：重试（同一步骤）、回退（父任务）、替换工具（fallback）、请求用户输入、终止。
- 安全检查：工具调用前后进行权限验证、输出过滤（防止越权、敏感信息泄露）。

## 8. 可观测性
- **日志**：结构化 JSON（`state`, `eventType`, `taskId`, `message`, `contextDiff`），提供流式推送和文件落地。
- **Metrics**：Prometheus 指标（循环次数、平均时延、工具成功率、Planner 误差、重试次数）。
- **Trace**：基于 OpenTelemetry，将 `traceId` 与 TaskNode、工具调用、状态转换关联。
- **Replay**：保存关键事件和上下文快照，用于离线复现和回测。

## 9. 调试面板（React）
- 状态总览：显示当前状态、循环次数、告警 badge。
- 任务树视图：树形组件展示 TaskNode，包含状态、最近 Observation、子任务。
- 事件时间轴：时间顺序渲染 Plan/Act/Tool/Reflect 事件，可过滤、搜索、展开详情。
- 工具监控：显示请求/响应、耗时、重试记录，可手动重放或切换备用工具。
- 人工干预：提供暂停/继续/回退/重试按钮以及用户指令输入框。
- 技术实现：React + Zustand 状态管理；通过 WebSocket 订阅实时事件，REST 拉取历史；Tailwind/AntD 快速构建 UI。

## 10. 测试策略
- 单元测试：覆盖 AgentContext 更新、任务树操作、状态转换、事件处理、ToolAdapter 行为。
- 集成测试：模拟完整回合（输入→Plan→Act→Observe→Reflect→Finish），包含成功与失败路径。
- 回归测试：针对常见异常（网络中断、超时、权限错误、循环限制）建立固定脚本。
- 前端：组件测试和 Cypress/MSW 集成测试，验证事件流与 UI 更新一致性。

## 11. 部署与配置
- 配置中心：使用 YAML/JSON 描述工具、策略、Prompt 模板，运行时热加载。
- 部署：单实例时采用 Node 服务 + React 静态资源；多实例通过容器编排（Docker/Kubernetes），EventBus 可替换为 Kafka/NATS。
- 安全：后端暴露接口需鉴权，前端 WebSocket/REST 需 Token；对外部工具调用配置流控和熔断。

## 12. 后续扩展
- 多 Agent 协作：共享 EventBus，由 Coordinator 调度多个 AgentRuntime 协同完成复杂任务。
- 记忆增强：引入向量数据库存储长期记忆，AgentContext 只保留短期工作记忆。
- 策略学习：基于回放数据训练 Planner/Reflect 策略，自动优化重试与回退阈值。
