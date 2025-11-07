import { promises as fs } from "fs";
import path from "path";
import type { ToolAdapter, ToolInput, ToolResult } from "../types/index.js";

/**
 * 写文件工具，支持创建新文件或覆盖已有文件。
 * Params:
 * - path: string (必填) 相对于工作区根目录的文件路径
 * - content: string (必填) 要写入的文本
 * - overwrite: boolean (可选，默认 false) 是否允许覆盖已存在文件
 */
export class CodeWriteFileTool implements ToolAdapter {
  public readonly id = "code.writeFile";

  public readonly description =
    "Writes content to a file under the workspace. Params: { path: string, content?: string, contentLines?: string[], encoding?: 'utf8' | 'base64', overwrite?: boolean }";

  async execute(input: ToolInput): Promise<ToolResult> {
    const targetPath =
      typeof input.params.path === "string" ? input.params.path.trim() : "";
    const content =
      typeof input.params.content === "string" ? input.params.content : null;
    const contentLines = Array.isArray(input.params.contentLines)
      ? input.params.contentLines
      : null;
    const overwrite =
      input.params.overwrite === undefined ? false : Boolean(input.params.overwrite);
    const encodingParam =
      typeof input.params.encoding === "string"
        ? input.params.encoding.toLowerCase()
        : "utf8";

    if (!targetPath) {
      return {
        success: false,
        error: "Missing path parameter",
        output: {},
      };
    }

    if (content === null && !contentLines) {
      return {
        success: false,
        error: "Expected either content or contentLines parameter",
        output: {},
      };
    }

    if (encodingParam !== "utf8" && encodingParam !== "base64") {
      return {
        success: false,
        error: `Unsupported encoding "${encodingParam}". Allowed encodings: utf8, base64`,
        output: {},
      };
    }

    const resolved = path.resolve(process.cwd(), targetPath);
    if (!resolved.startsWith(process.cwd())) {
      return {
        success: false,
        error: "Path must be inside the current workspace",
        output: {},
      };
    }

    const dir = path.dirname(resolved);
    await fs.mkdir(dir, { recursive: true });

    let payload: Buffer | string;
    try {
      if (contentLines) {
        const normalized = contentLines.map((line, index) => {
          if (typeof line !== "string") {
            throw new Error(`contentLines[${index}] is not a string`);
          }
          return line;
        });
        const joined = normalized.join("\n");
        payload =
          encodingParam === "base64"
            ? Buffer.from(joined, "base64")
            : joined;
      } else if (content !== null) {
        payload =
          encodingParam === "base64"
            ? Buffer.from(content, "base64")
            : content;
      } else {
        throw new Error("Missing content payload");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Failed to prepare content: ${message}`,
        output: {
          path: targetPath,
        },
      };
    }

    try {
      if (!overwrite) {
        await fs.writeFile(resolved, payload, { flag: "wx" });
      } else {
        await fs.writeFile(resolved, payload);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Failed to write file: ${message}`,
        output: {
          path: targetPath,
        },
      };
    }

    const byteSize = Buffer.isBuffer(payload)
      ? payload.byteLength
      : Buffer.byteLength(
          payload,
          encodingParam === "base64" ? "base64" : "utf8"
        );

    return {
      success: true,
      output: {
        path: targetPath,
        bytes: byteSize,
        overwrite,
        encoding: encodingParam,
        contentLineCount: contentLines ? contentLines.length : undefined,
      },
    };
  }
}
