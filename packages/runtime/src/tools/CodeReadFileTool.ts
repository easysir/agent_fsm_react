import { promises as fs } from "fs";
import path from "path";
import type { ToolAdapter, ToolInput, ToolResult } from "../types/index.js";

/**
 * 简单的代码读取工具，用于返回指定文件的文本内容。
 * 仅允许读取工作区内的文件，并限制最大返回长度，以便在测试中安全使用。
 */
export class CodeReadFileTool implements ToolAdapter {
  public readonly id = "code.readFile";

  public readonly description =
    "Reads a UTF-8 text file relative to the project root. Params: { path: string, maxLength?: number }";

  async execute(input: ToolInput): Promise<ToolResult> {
    const rawPath = input.params.path;
    if (typeof rawPath !== "string" || rawPath.trim().length === 0) {
      return {
        success: false,
        error: "Missing path parameter",
        output: {},
      };
    }

    const maxLength =
      typeof input.params.maxLength === "number"
        ? Math.max(1, Math.min(20000, input.params.maxLength))
        : 8000;

    const resolved = path.resolve(process.cwd(), rawPath);
    if (!resolved.startsWith(process.cwd())) {
      return {
        success: false,
        error: "Path must be inside the current workspace",
        output: {},
      };
    }

    try {
      const content = await fs.readFile(resolved, "utf8");
      return {
        success: true,
        output: {
          path: rawPath,
          length: content.length,
          content: content.slice(0, maxLength),
          truncated: content.length > maxLength,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Failed to read file: ${message}`,
        output: {
          path: rawPath,
        },
      };
    }
  }
}
