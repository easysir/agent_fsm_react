import { spawn } from "child_process";
import path from "path";
import type { ToolAdapter, ToolInput, ToolResult } from "../types/index.js";

interface CommandParams {
  command?: unknown[];
  cwd?: string;
  env?: Record<string, unknown>;
  shell?: boolean;
}

/**
 * 通用 shell 命令工具，可用于安装依赖、运行构建脚本等。
 * 默认使用 `pnpm` 作为示例命令，调用者可自定义。
 */
export class ShellCommandTool implements ToolAdapter {
  public readonly id = "shell.command";

  public readonly description =
    "Runs an arbitrary command inside the workspace. Params: { command: string[], cwd?: string, env?: Record<string,string>, shell?: boolean }";

  async execute(input: ToolInput): Promise<ToolResult> {
    const params = input.params as CommandParams;
    const commandArray = Array.isArray(params.command)
      ? params.command.map((item) => String(item))
      : null;
    if (!commandArray || commandArray.length === 0) {
      return {
        success: false,
        error: "Missing command parameter",
        output: {},
      };
    }

    const rawCwd =
      typeof params.cwd === "string" && params.cwd.length > 0
        ? params.cwd
        : ".";
    const resolvedCwd = path.resolve(process.cwd(), rawCwd);
    if (!resolvedCwd.startsWith(process.cwd())) {
      return {
        success: false,
        error: "Command cwd must be inside the current workspace",
        output: {},
      };
    }

    const env =
      params.env && typeof params.env === "object"
        ? Object.fromEntries(
            Object.entries(params.env).map(([key, value]) => [
              key,
              typeof value === "string" ? value : String(value),
            ])
          )
        : {};

    return new Promise<ToolResult>((resolve) => {
      const child = spawn(commandArray[0], commandArray.slice(1), {
        cwd: resolvedCwd,
        env: { ...process.env, ...env },
        shell: Boolean(params.shell),
        stdio: ["ignore", "pipe", "pipe"],
      });

      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];

      child.stdout.on("data", (chunk) => stdoutChunks.push(String(chunk)));
      child.stderr.on("data", (chunk) => stderrChunks.push(String(chunk)));

      child.on("error", (error) => {
        const message = error instanceof Error ? error.message : String(error);
        resolve({
          success: false,
          error: `Failed to run command: ${message}`,
          output: {
            command: commandArray,
            cwd: path.relative(process.cwd(), resolvedCwd) || ".",
            stdout: stdoutChunks.join(""),
            stderr: stderrChunks.join(""),
          },
        });
      });

      child.on("close", (code) => {
        const success = code === 0;
        const result: ToolResult = {
          success,
          output: {
            command: commandArray,
            cwd: path.relative(process.cwd(), resolvedCwd) || ".",
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
