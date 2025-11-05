import { AgentRuntime } from "../core/AgentRuntime.js";
import { InMemoryToolRegistry } from "../registry/ToolRegistry.js";
import { BaselinePlanner } from "../planner/BaselinePlanner.js";
import { BaselineReflector } from "../reflector/BaselineReflector.js";
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
      planner: new BaselinePlanner({ toolRegistry, provider: "deepseek" }),
      reflector: new BaselineReflector(),
      toolRegistry,
      guard: {
        maxIterations: 10,
        maxDurationMs: 60_000,
        maxFailures: 3,
      },
    },
  });

  runtime.streams.events$.subscribe({
    next: (event) => console.log("Bus event:", event),
  });

  runtime.streams.snapshots$.subscribe({
    next: (snapshot) => console.log("Agent snapshot:", snapshot),
  });

  const result = await runtime.run({
    rootTask: {
      taskId: "task-math-calc",
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
