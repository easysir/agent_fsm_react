import { promises as fs } from "fs";
import path from "path";
import type { ToolAdapter, ToolInput, ToolResult } from "../types/index.js";

/**
 * 基于简单启发式的代码摘要工具，可在测试场景中提供结构化概览。
 */
export class CodeSummarizeTool implements ToolAdapter {
  public readonly id = "code.summarize";

  public readonly description =
    "Provides a lightweight summary of a code file. Params: { path: string }";

  async execute(input: ToolInput): Promise<ToolResult> {
    const rawPath = input.params.path;
    if (typeof rawPath !== "string" || rawPath.trim().length === 0) {
      return {
        success: false,
        error: "Missing path parameter",
        output: {},
      };
    }

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
      const lines = content.split(/\r?\n/);
      const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
      const functionMatches = content.match(
        /\b(function\s+\w+|\w+\s*=\s*\([^)]*\)\s*=>)/g
      );
      const classMatches = content.match(/\bclass\s+\w+/g);

      return {
        success: true,
        output: {
          path: rawPath,
          lineCount: lines.length,
          nonEmptyLineCount: nonEmptyLines.length,
          functionCount: functionMatches ? functionMatches.length : 0,
          classCount: classMatches ? classMatches.length : 0,
          preview: nonEmptyLines.slice(0, 10),
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Failed to summarize file: ${message}`,
        output: {
          path: rawPath,
        },
      };
    }
  }
}
