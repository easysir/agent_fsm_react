export type ChatModelProvider = "openai" | "deepseek";

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatModelClientOptions {
  provider?: ChatModelProvider;
  apiKey?: string | null;
  baseURL?: string;
  model?: string;
  requestTimeoutMs?: number;
  headers?: Record<string, string>;
}

export interface ChatCompletionOptions {
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "json_object" | "text";
}

interface ProviderDefaults {
  apiKeyEnv: string;
  baseUrlEnv: string;
  modelEnv: string;
  baseURL: string;
  model: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
}

const PROVIDER_DEFAULTS: Record<ChatModelProvider, ProviderDefaults> = {
  openai: {
    apiKeyEnv: "OPENAI_API_KEY",
    baseUrlEnv: "OPENAI_BASE_URL",
    modelEnv: "OPENAI_MODEL",
    baseURL: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
  deepseek: {
    apiKeyEnv: "DEEPSEEK_API_KEY",
    baseUrlEnv: "DEEPSEEK_BASE_URL",
    modelEnv: "DEEPSEEK_MODEL",
    baseURL: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
  },
};

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export class ChatModelClient {
  private readonly provider: ChatModelProvider;

  private readonly apiKey: string | null;

  private readonly endpoint: string;

  private readonly model: string;

  private readonly requestTimeoutMs: number;

  private readonly headers: Record<string, string>;

  constructor(options?: ChatModelClientOptions) {
    console.info("[ChatModelClient] Constructor options", options);
    this.provider = resolveProvider(options);
    const defaults = PROVIDER_DEFAULTS[this.provider];

    const resolvedApiKey =
      options?.apiKey ?? process.env[defaults.apiKeyEnv] ?? null;
    this.apiKey =
      typeof resolvedApiKey === "string" && resolvedApiKey.length > 0
        ? resolvedApiKey
        : null;

    const baseURL =
      options?.baseURL ?? process.env[defaults.baseUrlEnv] ?? defaults.baseURL;

    this.endpoint = `${stripTrailingSlash(baseURL)}/chat/completions`;

    this.model =
      options?.model ?? process.env[defaults.modelEnv] ?? defaults.model;

    this.requestTimeoutMs =
      typeof options?.requestTimeoutMs === "number"
        ? options.requestTimeoutMs
        : DEFAULT_REQUEST_TIMEOUT_MS;

    this.headers = {
      "Content-Type": "application/json",
      Authorization: this.apiKey ? `Bearer ${this.apiKey}` : "",
      ...(options?.headers ?? {}),
    };

    const headerKeys = Object.keys(options?.headers ?? {});
    // eslint-disable-next-line no-console
    console.info("[ChatModelClient] Initialized", {
      provider: this.provider,
      baseURL,
      model: this.model,
      requestTimeoutMs: this.requestTimeoutMs,
      hasApiKey: Boolean(this.apiKey),
      customHeaderKeys: headerKeys.length > 0 ? headerKeys : undefined,
    });
  }

  public getProvider(): ChatModelProvider {
    return this.provider;
  }

  public isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  public async complete(
    messages: ChatMessage[],
    options?: ChatCompletionOptions
  ): Promise<string> {
    if (!this.apiKey) {
      throw new Error(
        `ChatModelClient (${this.provider}) is not configured with an API key`
      );
    }

    if (typeof fetch !== "function") {
      throw new Error("Global fetch is not available in this runtime.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      const body: Record<string, unknown> = {
        model: this.model,
        temperature: options?.temperature ?? 0.2,
        max_tokens: options?.maxTokens ?? 400,
        messages,
      };

      if (options?.responseFormat === "json_object") {
        body.response_format = { type: "json_object" };
      }

      const headers = {
        ...this.headers,
        Authorization: `Bearer ${this.apiKey}`,
      };

      // eslint-disable-next-line no-console
      console.info("[ChatModelClient] Request payload", {
        provider: this.provider,
        endpoint: this.endpoint,
        hasApiKey: Boolean(this.apiKey),
        headers: {
          ...headers,
          Authorization: this.apiKey ? "Bearer ***redacted***" : "",
        },
        body,
      });

      const response = await fetch(this.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const responseClone = response.clone();
      let responsePreview: unknown;
      try {
        responsePreview = await responseClone.json();
      } catch {
        try {
          responsePreview = await responseClone.text();
        } catch {
          responsePreview = "<unavailable>";
        }
      }

      // eslint-disable-next-line no-console
      console.info("[ChatModelClient] Response preview", {
        provider: this.provider,
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        body: responsePreview,
      });

      if (!response.ok) {
        let errText: string | undefined;
        try {
          errText = await response.text();
        } catch {
          // ignore secondary error
        }
        throw new Error(
          `${capitalize(this.provider)} request failed with status ${
            response.status
          } ${response.statusText}${errText ? `: ${errText}` : ""}`
        );
      }

      const json = (await response.json()) as ChatCompletionResponse;
      const content = json.choices?.[0]?.message?.content?.trim();
      if (!content) {
        throw new Error(
          `${capitalize(
            this.provider
          )} response did not contain any message content`
        );
      }
      return content;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function resolveProvider(options?: ChatModelClientOptions): ChatModelProvider {
  if (options?.provider) {
    return options.provider;
  }

  const envProvider = (process.env.LLM_PROVIDER ?? "").toLowerCase();
  if (envProvider === "openai" || envProvider === "deepseek") {
    return envProvider;
  }

  const preferredProviders: ChatModelProvider[] = ["openai", "deepseek"];

  for (const provider of preferredProviders) {
    const keyEnv = PROVIDER_DEFAULTS[provider].apiKeyEnv;
    if (process.env[keyEnv]) {
      return provider;
    }
  }

  return "openai";
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
