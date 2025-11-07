import { promises as fs } from "fs";
import path from "path";
import type { Dirent } from "fs";
import type { ToolAdapter, ToolInput, ToolResult } from "../types/index.js";

interface SearchHit {
  file: string;
  line: number;
  snippet: string;
}

/**
 * 递归搜索代码片段，返回匹配的行信息。默认忽略 node_modules 与 dist 目录。
 */
export class CodeSearchTool implements ToolAdapter {
  public readonly id = "code.search";

  public readonly description =
    "Searches files for a keyword. Params: { query: string, root?: string, maxResults?: number }";

  private readonly ignoreDirs = new Set([
    "node_modules",
    "dist",
    "build",
    ".git",
    ".turbo",
  ]);

  async execute(input: ToolInput): Promise<ToolResult> {
    const query = typeof input.params.query === "string" ? input.params.query.trim() : "";
    if (!query) {
      return {
        success: false,
        error: "Missing query parameter",
        output: {},
      };
    }

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

    const maxResults =
      typeof input.params.maxResults === "number"
        ? Math.max(1, Math.min(100, Math.floor(input.params.maxResults)))
        : 25;

    const hits: SearchHit[] = [];
    await this.walk(rootPath, async (filePath) => {
      if (hits.length >= maxResults) {
        return false;
      }
      const content = await fs.readFile(filePath, "utf8");
      const lines = content.split(/\r?\n/);
      lines.forEach((line, index) => {
        if (hits.length >= maxResults) {
          return;
        }
        if (line.includes(query)) {
          hits.push({
            file: path.relative(process.cwd(), filePath),
            line: index + 1,
            snippet: line.trim().slice(0, 200),
          });
        }
      });
      return hits.length < maxResults;
    });

    return {
      success: true,
      output: {
        query,
        root: path.relative(process.cwd(), rootPath) || ".",
        matches: hits,
        total: hits.length,
      },
    };
  }

  private async walk(
    dir: string,
    onFile: (filePath: string) => Promise<boolean>
  ): Promise<boolean> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return true;
    }

    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (this.ignoreDirs.has(entry.name)) {
          continue;
        }
        const keepGoing = await this.walk(entryPath, onFile);
        if (!keepGoing) {
          return false;
        }
      } else if (entry.isFile()) {
        const keepGoing = await onFile(entryPath);
        if (!keepGoing) {
          return false;
        }
      }
    }
    return true;
  }
}
