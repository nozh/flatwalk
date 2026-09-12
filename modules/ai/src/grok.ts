import { AdapterError } from "./errors.js";
import { defaultFixtureDir, readFixtureEnvelope } from "./fixtures.js";
import { resolveAdapterMode, type AdapterMode } from "./mode.js";
import { fetchTransport, type HttpTransport } from "./transport.js";

export const XAI_CHAT_COMPLETIONS_URL = "https://api.x.ai/v1/chat/completions";
export const DEFAULT_GROK_MODEL = "grok-4.6";
export const DEFAULT_GROK_TIMEOUT_MS = 120_000;

export type GrokChatMessage = {
  role: string;
  content: unknown;
};

export type GrokChatCompletion = {
  id?: string;
  object?: string;
  model?: string;
  choices: Array<{
    index?: number;
    message: { role?: string; content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: unknown;
};

export type GrokChatResult = {
  synthetic: boolean;
  note?: string;
  body: GrokChatCompletion;
};

export type GrokClientOptions = {
  mode?: AdapterMode;
  apiKey?: string;
  env?: NodeJS.Dict<string>;
  transport?: HttpTransport;
  fixtureDir?: string;
  baseUrl?: string;
};

export type GrokChatRequest = {
  fixtureId: string;
  messages: GrokChatMessage[];
  model?: string;
  timeoutMs?: number;
  extra?: Record<string, unknown>;
};

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (typeof error === "object" && error !== null && (error as { name?: string }).name === "AbortError")
  );
}

function parseJsonBody(text: string, context: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new AdapterError("invalid-response", `${context} returned non-JSON`, { cause: error });
  }
}

function asCompletion(value: unknown): GrokChatCompletion {
  if (!value || typeof value !== "object" || !("choices" in value) || !Array.isArray((value as GrokChatCompletion).choices)) {
    throw new AdapterError("invalid-response", "x.ai chat completion is missing choices");
  }
  return value as GrokChatCompletion;
}

export function createGrokClient(options: GrokClientOptions = {}) {
  const env = options.env ?? process.env;
  const mode = options.mode ?? resolveAdapterMode(env);
  const fixtureDir = options.fixtureDir ?? defaultFixtureDir();
  const transport = options.transport ?? fetchTransport;
  const baseUrl = options.baseUrl ?? XAI_CHAT_COMPLETIONS_URL;

  async function chatCompletions(request: GrokChatRequest): Promise<GrokChatResult> {
    if (mode === "fixture") {
      const envelope = await readFixtureEnvelope<GrokChatCompletion>(fixtureDir, request.fixtureId);
      return {
        synthetic: envelope.synthetic,
        note: envelope.note,
        body: asCompletion(envelope.body),
      };
    }

    const apiKey = options.apiKey ?? env.XAI_API_KEY;
    if (!apiKey) {
      throw new AdapterError(
        "missing-config",
        "XAI_API_KEY is missing. Copy modules/ai/.env.example to .env and set FLATWALK_ADAPTERS=live only when you intend a live call.",
      );
    }

    const controller = new AbortController();
    const timeoutMs = request.timeoutMs ?? DEFAULT_GROK_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const model = request.model ?? env.XAI_MODEL ?? DEFAULT_GROK_MODEL;
    try {
      const response = await transport({
        url: baseUrl,
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: request.messages,
          stream: false,
          ...request.extra,
        }),
        signal: controller.signal,
      });

      if (response.status < 200 || response.status >= 300) {
        throw new AdapterError(
          "api-error",
          `x.ai chat completions failed with HTTP ${response.status}`,
          { status: response.status },
        );
      }

      const body = asCompletion(parseJsonBody(response.body, "x.ai chat completions"));
      return { synthetic: false, body };
    } catch (error) {
      if (error instanceof AdapterError) {
        throw error;
      }
      if (isAbortError(error) || controller.signal.aborted) {
        throw new AdapterError("timeout", `x.ai chat completions timed out after ${timeoutMs}ms`, {
          cause: error,
        });
      }
      throw new AdapterError("api-error", "x.ai chat completions request failed", { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }

  return { mode, chatCompletions };
}
