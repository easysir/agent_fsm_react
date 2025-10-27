# Agent ReAct FSM Monorepo

This repository hosts a monorepo that combines a finite-state-machine-driven ReAct agent runtime with a visualization/debugging dashboard. The workspace consists of two packages:

- `packages/runtime` (`@agent/runtime`): Node/TypeScript runtime core implementing the `Plan → Act → Observe → Reflect → Finish` loop, agent context management, and tool invocation event bus.
- `packages/devpanel` (`@agent/react-devpanel`): React + Vite debugging panel that visualizes agent state, task tree, event timeline, and tool activity for monitoring and human intervention.

See `docs/architecture.md` for the full design.

## Getting Started

```bash
pnpm install
```

### Runtime Demo
```bash
pnpm --filter @agent/runtime dev
```
Runs `src/demo.ts`, showcasing a minimal Plan → Act → Observe → Reflect → Finish cycle and dumping the resulting snapshot to the terminal.

### Debug Panel
```bash
pnpm --filter @agent/react-devpanel dev
```

Open `http://localhost:5173` to inspect the mock data feed displaying status overview, task tree, timeline, and tool activity. Replace the mock runtime connector with a real backend stream when ready.

## Project Structure
```
.
├── docs/
│   └── architecture.md    # Architecture overview
├── packages/
│   ├── runtime/           # Runtime core (Node/TypeScript)
│   │   ├── src/
│   │   └── package.json
│   └── devpanel/          # Debug panel (React/Vite)
│       ├── src/
│       └── package.json
└── package.json           # pnpm workspace configuration
```

## Next Steps
- Replace the mock connector in the dev panel with a WebSocket/SSE integration against the runtime.
- Add unit and integration tests covering FSM transitions, tool execution, and recovery strategies.
- Introduce configurable tool registration, logging/metrics exports, and explore multi-agent coordination.
