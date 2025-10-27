import { AgentRuntime } from '../core/AgentRuntime.js';
import { InMemoryToolRegistry } from '../registry/ToolRegistry.js';
import { SimplePlanner } from '../planner/SimplePlanner.js';
import { SimpleReflector } from '../reflector/SimpleReflector.js';
import { EchoTool } from '../tools/EchoTool.js';

async function main() {
  const toolRegistry = new InMemoryToolRegistry([new EchoTool()]);

  const runtime = new AgentRuntime({
    config: {
      agentId: 'demo-agent',
      planner: new SimplePlanner(),
      reflector: new SimpleReflector(),
      toolRegistry,
      guard: {
        maxIterations: 10,
        maxDurationMs: 60_000,
        maxFailures: 3,
      },
    },
  });

  const result = await runtime.run({
    rootTask: {
      taskId: 'task-root',
      description: 'Collect diagnostic data from echo tool',
      status: 'pending',
    },
  });

  // eslint-disable-next-line no-console
  console.log('Agent result:', JSON.stringify(result, null, 2));
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
