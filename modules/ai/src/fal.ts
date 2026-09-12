import { AdapterError } from "./errors.js";
import { defaultFixtureDir, readFixtureEnvelope } from "./fixtures.js";
import { resolveAdapterMode, type AdapterMode } from "./mode.js";
import {
  defaultSleep,
  fetchTransport,
  type HttpTransport,
  type SleepFn,
} from "./transport.js";

/** Official fal model id for Hunyuan World image-to-panorama (not image-to-world). */
export const FAL_HUNYUAN_WORLD_ENDPOINT = "fal-ai/hunyuan_world";
export const FAL_QUEUE_BASE_URL = "https://queue.fal.run";
export const DEFAULT_FAL_TIMEOUT_MS = 90_000;
export const DEFAULT_FAL_POLL_MS = 1_000;

export type FalImage = {
  url: string;
  content_type?: string;
  file_name?: string;
  file_size?: number;
  width?: number;
  height?: number;
};

export type FalPanoramaBody = {
  image: FalImage;
};

export type FalPanoramaResult = {
  synthetic: boolean;
  note?: string;
  endpoint: typeof FAL_HUNYUAN_WORLD_ENDPOINT;
  body: FalPanoramaBody;
};

export type FalClientOptions = {
  mode?: AdapterMode;
  apiKey?: string;
  env?: NodeJS.Dict<string>;
  transport?: HttpTransport;
  fixtureDir?: string;
  sleep?: SleepFn;
  pollIntervalMs?: number;
};

export type FalPanoramaRequest = {
  fixtureId: string;
  imageUrl: string;
  prompt: string;
  timeoutMs?: number;
};

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (typeof error === "object" && error !== null && (error as { name?: string }).name === "AbortError")
  );
}

function parseJson(text: string, context: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new AdapterError("invalid-response", `${context} returned non-JSON`, { cause: error });
  }
}

function asObject(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw new AdapterError("invalid-response", `${context} returned a non-object`);
  }
  return value as Record<string, unknown>;
}

function asPanoramaBody(value: unknown): FalPanoramaBody {
  const object = asObject(value, "fal hunyuan_world");
  const image = object.image;
  if (!image || typeof image !== "object" || typeof (image as FalImage).url !== "string") {
    throw new AdapterError(
      "invalid-response",
      "fal hunyuan_world response is missing image.url",
    );
  }
  return { image: image as FalImage };
}

export function createFalClient(options: FalClientOptions = {}) {
  const env = options.env ?? process.env;
  const mode = options.mode ?? resolveAdapterMode(env);
  const fixtureDir = options.fixtureDir ?? defaultFixtureDir();
  const transport = options.transport ?? fetchTransport;
  const sleep = options.sleep ?? defaultSleep;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_FAL_POLL_MS;

  async function imageToPanorama(request: FalPanoramaRequest): Promise<FalPanoramaResult> {
    if (mode === "fixture") {
      const envelope = await readFixtureEnvelope<FalPanoramaBody>(fixtureDir, request.fixtureId);
      return {
        synthetic: envelope.synthetic,
        note: envelope.note,
        endpoint: FAL_HUNYUAN_WORLD_ENDPOINT,
        body: asPanoramaBody(envelope.body),
      };
    }

    const apiKey = options.apiKey ?? env.FAL_KEY;
    if (!apiKey) {
      throw new AdapterError(
        "missing-config",
        "FAL_KEY is missing. Copy modules/ai/.env.example to .env and set FLATWALK_ADAPTERS=live only when you intend a live call.",
      );
    }

    const timeoutMs = request.timeoutMs ?? DEFAULT_FAL_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const timedOut = () => controller.signal.aborted || Date.now() >= deadline;
    const headers = {
      authorization: `Key ${apiKey}`,
      "content-type": "application/json",
    };

    const requestOnce = async (url: string, method: "GET" | "POST", body?: string) => {
      if (timedOut()) {
        throw Object.assign(new Error("Aborted"), { name: "AbortError" });
      }
      const response = await transport({
        url,
        method,
        headers,
        body,
        signal: controller.signal,
      });
      if (response.status < 200 || response.status >= 300) {
        throw new AdapterError("api-error", `fal queue request failed with HTTP ${response.status}`, {
          status: response.status,
        });
      }
      return asObject(parseJson(response.body, "fal"), "fal");
    };

    try {
      const submitted = await requestOnce(
        `${FAL_QUEUE_BASE_URL}/${FAL_HUNYUAN_WORLD_ENDPOINT}`,
        "POST",
        JSON.stringify({
          image_url: request.imageUrl,
          prompt: request.prompt,
        }),
      );
      const requestId = submitted.request_id;
      if (typeof requestId !== "string" || requestId.length === 0) {
        throw new AdapterError("invalid-response", "fal queue submit did not return request_id");
      }

      const statusUrl =
        typeof submitted.status_url === "string"
          ? submitted.status_url
          : `${FAL_QUEUE_BASE_URL}/${FAL_HUNYUAN_WORLD_ENDPOINT}/requests/${requestId}/status`;
      const responseUrl =
        typeof submitted.response_url === "string"
          ? submitted.response_url
          : `${FAL_QUEUE_BASE_URL}/${FAL_HUNYUAN_WORLD_ENDPOINT}/requests/${requestId}`;

      for (;;) {
        const statusPayload = await requestOnce(statusUrl, "GET");
        const status = statusPayload.status;
        if (status === "COMPLETED") {
          if (typeof statusPayload.error === "string" && statusPayload.error.length > 0) {
            throw new AdapterError("api-error", `fal hunyuan_world failed: ${statusPayload.error}`);
          }
          break;
        }
        if (timedOut()) {
          throw Object.assign(new Error("Aborted"), { name: "AbortError" });
        }
        await sleep(pollIntervalMs);
      }

      const body = asPanoramaBody(await requestOnce(responseUrl, "GET"));
      return {
        synthetic: false,
        endpoint: FAL_HUNYUAN_WORLD_ENDPOINT,
        body,
      };
    } catch (error) {
      if (error instanceof AdapterError) {
        throw error;
      }
      if (isAbortError(error) || timedOut()) {
        throw new AdapterError("timeout", `fal hunyuan_world timed out after ${timeoutMs}ms`, {
          cause: error,
        });
      }
      throw new AdapterError("api-error", "fal hunyuan_world request failed", { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }

  return { mode, imageToPanorama };
}
