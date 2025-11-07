import { spawn } from "child_process";
import type { ToolAdapter, ToolInput, ToolResult } from "../types/index.js";

/**
 * 轻量测试执行工具。默认仅返回一个模拟结果，若传入 run 命令则真实执行。
 * 为避免在测试中卡住，可设置 params.dryRun=true 使用快速模拟。
 */
export class CodeTestRunnerTool implements ToolAdapter {
  public readonly id = "code.runTests";

  public readonly description =
    "Runs project tests or simulates a test run. Params: { command?: string[], dryRun?: boolean }";

  async execute(input: ToolInput): Promise<ToolResult> {
    const dryRun =
      input.params.dryRun === undefined ? true : Boolean(input.params.dryRun);
    const commandParam = Array.isArray(input.params.command)
      ? (input.params.command as unknown[])
      : null;

    if (dryRun || !commandParam || commandParam.length === 0) {
      return {
        success: true,
        output: {
          dryRun: true,
          summary: "Simulated test run completed",
          suggestedCommand: ["pnpm", "test"],
        },
      };
    }

    const command = commandParam
      .map((item) => (typeof item === "string" ? item : String(item)))
      .filter((item) => item.length > 0);

    if (command.length === 0) {
      return {
        success: false,
        error: "Command array is empty",
        output: {},
      };
    }

    return new Promise<ToolResult>((resolve) => {
      const child = spawn(command[0], command.slice(1), {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
      });
      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];
      child.stdout.on("data", (chunk) => stdoutChunks.push(String(chunk)));
      child.stderr.on("data", (chunk) => stderrChunks.push(String(chunk)));

      child.on("close", (code) => {
        const success = code === 0;
        const result: ToolResult = {
          success,
          output: {
            command,
            exitCode: code,
            stdout: stdoutChunks.join(""),
            stderr: stderrChunks.join(""),
          },
        };
        if (!success) {
          result.error = `Command exited with code ${code}`;
        }
        resolve(result);
      });
    });
  }
}
