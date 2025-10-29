import { AgentRuntime } from "../core/AgentRuntime.js";
import { InMemoryToolRegistry } from "../registry/ToolRegistry.js";
import { SimplePlanner } from "../planner/SimplePlanner.js";
import { SimpleReflector } from "../reflector/SimpleReflector.js";
import { EchoTool } from "../tools/EchoTool.js";
import { MathTool } from "../tools/MathTool.js";

async function main() {
  const toolRegistry = new InMemoryToolRegistry([
    new EchoTool(),
    new MathTool(),
  ]);

  const runtime = new AgentRuntime({
    config: {
      agentId: "demo-agent",
      planner: new SimplePlanner({ toolRegistry }),
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
      taskId: "task-root",
      description: "帮我计算一下 10 * 5 + (5^3) - 10 的结果",
      status: "pending",
    },
  });

  // eslint-disable-next-line no-console
  console.log("Agent result:", JSON.stringify(result, null, 2));
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
