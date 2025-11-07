import { Buffer } from "buffer";
import { z } from "zod";
import {
  ChatModelClient,
  type ChatMessage,
  type ChatModelClientOptions,
  type ChatModelProvider,
} from "../llm/ChatModelClient.js";
import type { ToolAdapter, ToolInput, ToolResult } from "../types/index.js";

export interface CodeGenerateSnippetToolOptions {
  llmClient?: ChatModelClient;
  llm?: ChatModelClientOptions;
  provider?: ChatModelProvider;
  apiKey?: string | null;
  baseURL?: string;
  model?: string;
  requestTimeoutMs?: number;
  systemPrompt?: string;
}

const DEFAULT_SYSTEM_PROMPT = [
  "You are a senior software engineer who writes high-quality, production-ready code snippets.",
  "You must respond with a strict JSON object (no comments, no trailing commas).",
  "Do not include any explanations outside of the JSON payload.",
  "If the requested output is longer than 150 lines, provide the most critical portion and explain how to extend it in the notes.",
  "Always ensure the snippet is self-contained and runnable where possible.",
].join(" ");

const SnippetResponseSchema = z
  .object({
    encoding: z.enum(["base64", "utf8"]).optional(),
    content: z.string().min(1),
    summary: z.string().optional(),
    notes: z.array(z.string()).optional(),
    diagnostics: z.array(z.string()).optional(),
  })
  .strict();

export class CodeGenerateSnippetTool implements ToolAdapter {
  public readonly id = "code.generateSnippet";

  public readonly description =
    "Generates a code snippet based on an outline and requirements. Params: { outline: string, language?: string, filename?: string, instructions?: string }";

  private readonly llmClient: ChatModelClient;

  private readonly systemPrompt: string;

  constructor(options?: CodeGenerateSnippetToolOptions) {
    this.systemPrompt = options?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    const legacyOptions = collectLegacyLlmOptions(options);
    this.llmClient =
      options?.llmClient ?? new ChatModelClient({ ...legacyOptions });
  }

  async execute(input: ToolInput): Promise<ToolResult> {
    const outline =
      typeof input.params.outline === "string"
        ? input.params.outline.trim()
        : "";
    const language =
      typeof input.params.language === "string"
        ? input.params.language.trim()
        : "typescript";
    const filename =
      typeof input.params.filename === "string"
        ? input.params.filename.trim()
        : undefined;
    const instructions =
      typeof input.params.instructions === "string"
        ? input.params.instructions.trim()
        : "";

    if (!outline) {
      return {
        success: false,
        error: "Missing outline parameter for code generation",
        output: {},
      };
    }

    if (!this.llmClient.isConfigured()) {
      return this.buildStubResult({
        outline,
        language,
        instructions,
        ...(filename ? { filename } : {}),
      });
    }

    const messages: ChatMessage[] = [
      { role: "system", content: this.systemPrompt },
      {
        role: "user",
        content: [
          "Generate a code snippet according to the following inputs.",
          `Language: ${language}`,
          filename ? `Target filename: ${filename}` : "",
          instructions ? `Additional instructions: ${instructions}` : "",
          "",
          "Outline:",
          outline,
          "",
          "Respond with JSON (content should contain only the snippet).",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ];

    try {
      const responseText = await this.llmClient.complete(messages, {
        responseFormat: "json_object",
        temperature: 0.2,
        maxTokens: 900,
      });

      const parsed = SnippetResponseSchema.parse(JSON.parse(responseText));
      const encoding = parsed.encoding === "utf8" ? "utf8" : "base64";
      let content = parsed.content;
      let effectiveEncoding = encoding;
      if (encoding === "utf8") {
        content = Buffer.from(content, "utf8").toString("base64");
        effectiveEncoding = "base64";
      }

      return {
        success: true,
        output: {
          outline,
          language,
          ...(filename ? { filename } : {}),
          encoding: effectiveEncoding,
          content,
          summary: parsed.summary,
          notes: parsed.notes,
          diagnostics: parsed.diagnostics,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Failed to generate snippet via LLM (${message})`,
        output: {
          outline,
          language,
          ...(filename ? { filename } : {}),
          instructions,
        },
      };
    }
  }

  private buildStubResult(params: {
    outline: string;
    language: string;
    filename?: string;
    instructions: string;
  }): ToolResult {
    const stub = [
      `// ${params.language} snippet placeholder generated without LLM.`,
      "// Fill in the outline manually or configure the LLM API key.",
      "",
      "// Outline summary:",
      ...params.outline.split(/\r?\n/).map((line) => `// ${line}`),
    ].join("\n");

    return {
      success: true,
      output: {
        outline: params.outline,
        language: params.language,
        ...(params.filename ? { filename: params.filename } : {}),
        encoding: "base64",
        content: Buffer.from(stub, "utf8").toString("base64"),
        notes: [
          "LLM client is not configured; returned a stub snippet.",
          "Provide an API key to enable automatic generation.",
        ],
      },
    };
  }
}

function collectLegacyLlmOptions(
  options?: CodeGenerateSnippetToolOptions
): ChatModelClientOptions {
  const base: ChatModelClientOptions = {
    ...(options?.llm ?? {}),
  };

  if (options?.provider) {
    base.provider = options.provider;
  }
  if (options?.apiKey !== undefined) {
    base.apiKey = options.apiKey;
  }
  if (options?.baseURL) {
    base.baseURL = options.baseURL;
  }
  if (options?.model) {
    base.model = options.model;
  }
  if (typeof options?.requestTimeoutMs === "number") {
    base.requestTimeoutMs = options.requestTimeoutMs;
  }

  return base;
}
