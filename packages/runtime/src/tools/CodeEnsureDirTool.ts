import { promises as fs } from "fs";
import path from "path";
import type { ToolAdapter, ToolInput, ToolResult } from "../types/index.js";

/**
 * 创建目录工具，相当于 `mkdir -p`。
 * Params:
 * - path: string (必填) 相对于工作区的目录路径
 */
export class CodeEnsureDirTool implements ToolAdapter {
  public readonly id = "code.ensureDir";

  public readonly description =
    "Ensures a directory exists under the workspace. Params: { path: string }";

  async execute(input: ToolInput): Promise<ToolResult> {
    const dirParam = typeof input.params.path === "string" ? input.params.path.trim() : "";
    if (!dirParam) {
      return {
        success: false,
        error: "Missing path parameter",
        output: {},
      };
    }

    const resolved = path.resolve(process.cwd(), dirParam);
    if (!resolved.startsWith(process.cwd())) {
      return {
        success: false,
        error: "Directory must be inside the current workspace",
        output: {},
      };
    }

    try {
      await fs.mkdir(resolved, { recursive: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Failed to ensure directory: ${message}`,
        output: {
          path: dirParam,
        },
      };
    }

    return {
      success: true,
      output: {
        path: dirParam,
        absolutePath: resolved,
      },
    };
  }
}
