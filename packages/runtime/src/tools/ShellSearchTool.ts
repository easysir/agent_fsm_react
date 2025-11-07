import { spawn } from "child_process";
import path from "path";
import type { ToolAdapter, ToolInput, ToolResult } from "../types/index.js";

/**
 * 利用系统 shell 执行 grep/glob 搜索的工具，便于在受控环境下验证命令行搜索流程。
 * 默认执行 `grep -RIn --color=never --exclude-dir node_modules dist build .git .turbo`
 * 用户可传入自定义的 command 数组，但执行目录始终限定在工作区内。
 */
export class ShellSearchTool implements ToolAdapter {
  public readonly id = "shell.search";

  public readonly description =
    "Runs a shell-side grep search. Params: { command?: string[], query?: string, root?: string }";

  private readonly defaultIgnore = [
    "--exclude-dir",
    "node_modules",
    "--exclude-dir",
    "dist",
    "--exclude-dir",
    "build",
    "--exclude-dir",
    ".git",
    "--exclude-dir",
    ".turbo",
  ];

  async execute(input: ToolInput): Promise<ToolResult> {
    const rootParam =
      typeof input.params.root === "string" && input.params.root.length > 0
        ? input.params.root
        : ".";
    const rootPath = path.resolve(process.cwd(), rootParam);
    if (!rootPath.startsWith(process.cwd())) {
      return {
        success: false,
        error: "Search root must be inside the current workspace",
        output: {},
      };
    }

    const commandParam = Array.isArray(input.params.command)
      ? input.params.command
      : null;

    let command: string[];
    if (commandParam && commandParam.length > 0) {
      command = commandParam.map((item) => String(item));
    } else {
      const query =
        typeof input.params.query === "string" && input.params.query.length > 0
          ? input.params.query
          : "";
      if (!query) {
        return {
          success: false,
          error: "Missing query or command parameter",
          output: {},
        };
      }
      command = [
        "grep",
        "-RIn",
        "--color=never",
        ...this.defaultIgnore,
        query,
        ".",
      ];
    }

    return await this.runCommand(command, rootPath);
  }

  private async runCommand(
    command: string[],
    cwd: string
  ): Promise<ToolResult> {
    return new Promise<ToolResult>((resolve) => {
      const child = spawn(command[0], command.slice(1), {
        cwd,
        shell: false,
      });
      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];

      child.stdout.on("data", (chunk) => stdoutChunks.push(String(chunk)));
      child.stderr.on("data", (chunk) => stderrChunks.push(String(chunk)));

      child.on("close", (code) => {
        const success = code === 0;
        const trimmedStdout = stdoutChunks.join("");
        const trimmedStderr = stderrChunks.join("");
        const result: ToolResult = {
          success,
          output: {
            command,
            cwd: path.relative(process.cwd(), cwd) || ".",
            stdout: trimmedStdout,
            stderr: trimmedStderr,
            exitCode: code,
          },
        };
        if (!success && trimmedStderr.length > 0) {
          result.error = trimmedStderr.slice(0, 5000);
        }
        resolve(result);
      });

      child.on("error", (error) => {
        const message = error instanceof Error ? error.message : String(error);
        resolve({
          success: false,
          error: `Failed to run command: ${message}`,
          output: {
            command,
            cwd: path.relative(process.cwd(), cwd) || ".",
            stdout: stdoutChunks.join(""),
            stderr: stderrChunks.join(""),
          },
        });
      });
    });
  }
}
