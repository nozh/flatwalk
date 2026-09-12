import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AdapterError } from "./errors.js";
import { defaultFixtureDir } from "./fixtures.js";
import { createFalClient, FAL_HUNYUAN_WORLD_ENDPOINT } from "./fal.js";
import { createGrokClient } from "./grok.js";
import { resolveAdapterMode } from "./mode.js";
import type { HttpTransport } from "./transport.js";

const tmpDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "flatwalk-ai-"));
  tmpDirs.push(dir);
  return dir;
}

function recordingTransport(handler: HttpTransport): {
  transport: HttpTransport;
  calls: { url: string; method: string; headers: Record<string, string> }[];
} {
  const calls: { url: string; method: string; headers: Record<string, string> }[] = [];
  return {
    calls,
    transport: async (request) => {
      calls.push({ url: request.url, method: request.method, headers: request.headers });
      return handler(request);
    },
  };
}

describe("resolveAdapterMode", () => {
  it("defaults to fixture when FLATWALK_ADAPTERS is unset", () => {
    expect(resolveAdapterMode({})).toBe("fixture");
  });

  it("accepts live only when set explicitly", () => {
    expect(resolveAdapterMode({ FLATWALK_ADAPTERS: "live" })).toBe("live");
  });

  it("rejects unknown values", () => {
    expect(() => resolveAdapterMode({ FLATWALK_ADAPTERS: "auto" })).toThrow(AdapterError);
    try {
      resolveAdapterMode({ FLATWALK_ADAPTERS: "auto" });
    } catch (error) {
      expect(error).toMatchObject({ code: "invalid-mode" });
    }
  });
});

describe("Grok adapter", () => {
  it("reads a synthetic fixture without calling transport", async () => {
    const dir = await tempDir();
    await writeFile(
      path.join(dir, "photo-matcher.json"),
      `${JSON.stringify({
        synthetic: true,
        note: "Synthetic x.ai chat.completions body for adapter tests. Not a live API result.",
        body: {
          id: "chatcmpl-synthetic",
          object: "chat.completion",
          model: "grok-4.6",
          choices: [{ index: 0, message: { role: "assistant", content: '{"photos":[]}' }, finish_reason: "stop" }],
        },
      })}\n`,
    );
    const { transport, calls } = recordingTransport(async () => {
      throw new Error("network must not be used in fixture mode");
    });
    const grok = createGrokClient({
      mode: "fixture",
      fixtureDir: dir,
      transport,
      apiKey: "should-not-be-required",
    });

    const result = await grok.chatCompletions({
      fixtureId: "photo-matcher",
      messages: [{ role: "user", content: "unused in fixture mode" }],
    });

    expect(result.synthetic).toBe(true);
    expect(result.body.choices[0]?.message.content).toBe('{"photos":[]}');
    expect(calls).toEqual([]);
  });

  it("fails with a missing-fixture error instead of going to the network", async () => {
    const dir = await tempDir();
    const { transport, calls } = recordingTransport(async () => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: '{"id":"would-be-live"}',
    }));
    const grok = createGrokClient({ mode: "fixture", fixtureDir: dir, transport });

    await expect(
      grok.chatCompletions({ fixtureId: "missing-reply", messages: [] }),
    ).rejects.toMatchObject({
      code: "missing-fixture",
    });
    await expect(
      grok.chatCompletions({ fixtureId: "missing-reply", messages: [] }),
    ).rejects.toThrow(/missing-reply\.json/);
    expect(calls).toEqual([]);
  });

  it("requires XAI_API_KEY in live mode", async () => {
    const grok = createGrokClient({
      mode: "live",
      env: {},
      transport: async () => {
        throw new Error("must not call transport without a key");
      },
    });
    await expect(
      grok.chatCompletions({ fixtureId: "unused", messages: [] }),
    ).rejects.toMatchObject({ code: "missing-config" });
  });

  it("posts chat completions through the injected transport", async () => {
    const { transport, calls } = recordingTransport(async () => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "chatcmpl-live-stub",
        object: "chat.completion",
        model: "grok-4.6",
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      }),
    }));
    const grok = createGrokClient({
      mode: "live",
      apiKey: "test-xai-key",
      transport,
    });

    const result = await grok.chatCompletions({
      fixtureId: "unused",
      model: "grok-4.6",
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: "https://example.test/plan.png", detail: "high" } },
            { type: "text", text: "describe" },
          ],
        },
      ],
    });

    expect(result.synthetic).toBe(false);
    expect(result.body.choices[0]?.message.content).toBe("ok");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.x.ai/v1/chat/completions");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.headers.authorization).toBe("Bearer test-xai-key");
    expect(calls[0]?.headers["content-type"]).toBe("application/json");
  });

  it("lists language models over GET without posting a completion", async () => {
    const { transport, calls } = recordingTransport(async () => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        models: [
          {
            id: "grok-4.6",
            input_modalities: ["text", "image"],
            output_modalities: ["text"],
            aliases: ["grok-4.6-latest"],
          },
        ],
      }),
    }));
    const grok = createGrokClient({ mode: "live", apiKey: "test-xai-key", transport });
    const listed = await grok.listLanguageModels();
    expect(listed.status).toBe(200);
    expect(listed.models[0]?.id).toBe("grok-4.6");
    expect(listed.models[0]?.input_modalities).toContain("image");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toContain("/language-models");
  });

  it("does not list language models in fixture mode", async () => {
    const grok = createGrokClient({
      mode: "fixture",
      transport: async () => {
        throw new Error("network must not be used");
      },
    });
    await expect(grok.listLanguageModels()).rejects.toMatchObject({ code: "invalid-mode" });
  });

  it("maps HTTP API errors without echoing the key", async () => {
    const grok = createGrokClient({
      mode: "live",
      apiKey: "secret-must-not-appear",
      transport: async () => ({
        status: 401,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: { message: "Incorrect API key provided" } }),
      }),
    });

    await expect(grok.chatCompletions({ fixtureId: "unused", messages: [] })).rejects.toMatchObject({
      code: "api-error",
      status: 401,
    });
    try {
      await grok.chatCompletions({ fixtureId: "unused", messages: [] });
    } catch (error) {
      expect(String(error)).not.toContain("secret-must-not-appear");
      expect(String(error)).toContain("Incorrect API key provided");
    }
  });

  it("times out a hanging live request", async () => {
    const grok = createGrokClient({
      mode: "live",
      apiKey: "test-xai-key",
      transport: async (request) => {
        await new Promise<void>((_, reject) => {
          request.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
          });
        });
        return { status: 200, headers: {}, body: "{}" };
      },
    });

    await expect(
      grok.chatCompletions({ fixtureId: "unused", messages: [], timeoutMs: 20 }),
    ).rejects.toMatchObject({ code: "timeout" });
  });

  it("loads the packaged synthetic Grok fixture from the default directory", async () => {
    const grok = createGrokClient({
      mode: "fixture",
      fixtureDir: defaultFixtureDir(),
      transport: async () => {
        throw new Error("network must not be used");
      },
    });
    const result = await grok.chatCompletions({
      fixtureId: "grok/photo-matcher.synthetic",
      messages: [],
    });
    expect(result.synthetic).toBe(true);
  });
});

describe("fal hunyuan_world adapter", () => {
  it("uses the documented image-to-panorama endpoint id", () => {
    expect(FAL_HUNYUAN_WORLD_ENDPOINT).toBe("fal-ai/hunyuan_world");
  });

  it("reads a synthetic panorama fixture without calling transport", async () => {
    const dir = await tempDir();
    await mkdir(path.join(dir, "fal"), { recursive: true });
    await writeFile(
      path.join(dir, "fal", "pano-r1.json"),
      `${JSON.stringify({
        synthetic: true,
        note: "Synthetic fal hunyuan_world body for adapter tests. Not a live fal result.",
        body: {
          image: {
            url: "https://example.test/synthetic-pano.png",
            content_type: "image/png",
            width: 1920,
            height: 960,
            file_name: "synthetic-pano.png",
          },
        },
      })}\n`,
    );
    const { transport, calls } = recordingTransport(async () => {
      throw new Error("network must not be used in fixture mode");
    });
    const fal = createFalClient({
      mode: "fixture",
      fixtureDir: dir,
      transport,
    });

    const result = await fal.imageToPanorama({
      fixtureId: "fal/pano-r1",
      imageUrl: "https://example.test/room.jpg",
      prompt: "interior living room panorama",
    });

    expect(result.synthetic).toBe(true);
    expect(result.endpoint).toBe("fal-ai/hunyuan_world");
    expect(result.body.image.width).toBe(1920);
    expect(result.body.image.height).toBe(960);
    expect(calls).toEqual([]);
  });

  it("fails with a missing-fixture error instead of going to the network", async () => {
    const dir = await tempDir();
    const { transport, calls } = recordingTransport(async () => ({
      status: 200,
      headers: {},
      body: "{}",
    }));
    const fal = createFalClient({ mode: "fixture", fixtureDir: dir, transport });

    await expect(
      fal.imageToPanorama({
        fixtureId: "fal/does-not-exist",
        imageUrl: "https://example.test/room.jpg",
        prompt: "interior",
      }),
    ).rejects.toMatchObject({ code: "missing-fixture" });
    expect(calls).toEqual([]);
  });

  it("requires FAL_KEY in live mode", async () => {
    const fal = createFalClient({
      mode: "live",
      env: {},
      transport: async () => {
        throw new Error("must not call transport without a key");
      },
    });
    await expect(
      fal.imageToPanorama({
        fixtureId: "unused",
        imageUrl: "https://example.test/room.jpg",
        prompt: "interior",
      }),
    ).rejects.toMatchObject({ code: "missing-config" });
  });

  it("submits the queue, polls status, then fetches the result", async () => {
    const { transport, calls } = recordingTransport(async (request) => {
      if (request.method === "POST" && request.url === "https://queue.fal.run/fal-ai/hunyuan_world") {
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            request_id: "req-1",
            status_url: "https://queue.fal.run/fal-ai/hunyuan_world/requests/req-1/status",
            response_url: "https://queue.fal.run/fal-ai/hunyuan_world/requests/req-1",
          }),
        };
      }
      if (request.url.includes("/status")) {
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "COMPLETED", request_id: "req-1" }),
        };
      }
      if (request.url === "https://queue.fal.run/fal-ai/hunyuan_world/requests/req-1") {
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            image: {
              url: "https://example.test/live-stub-pano.png",
              content_type: "image/png",
              width: 1920,
              height: 960,
            },
          }),
        };
      }
      throw new Error(`unexpected ${request.method} ${request.url}`);
    });

    const fal = createFalClient({
      mode: "live",
      apiKey: "test-fal-key",
      transport,
      sleep: async () => undefined,
    });

    const result = await fal.imageToPanorama({
      fixtureId: "unused",
      imageUrl: "https://example.test/room.jpg",
      prompt: "interior living room panorama",
    });

    expect(result.synthetic).toBe(false);
    expect(result.body.image.url).toBe("https://example.test/live-stub-pano.png");
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "POST https://queue.fal.run/fal-ai/hunyuan_world",
      "GET https://queue.fal.run/fal-ai/hunyuan_world/requests/req-1/status",
      "GET https://queue.fal.run/fal-ai/hunyuan_world/requests/req-1",
    ]);
    expect(calls[0]?.headers.authorization).toBe("Key test-fal-key");
  });

  it("maps a completed queue error to api-error", async () => {
    const fal = createFalClient({
      mode: "live",
      apiKey: "test-fal-key",
      sleep: async () => undefined,
      transport: async (request) => {
        if (request.method === "POST") {
          return {
            status: 200,
            headers: {},
            body: JSON.stringify({
              request_id: "req-fail",
              status_url: "https://queue.fal.run/fal-ai/hunyuan_world/requests/req-fail/status",
              response_url: "https://queue.fal.run/fal-ai/hunyuan_world/requests/req-fail",
            }),
          };
        }
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({
            status: "COMPLETED",
            request_id: "req-fail",
            error: "generation failed",
          }),
        };
      },
    });

    await expect(
      fal.imageToPanorama({
        fixtureId: "unused",
        imageUrl: "https://example.test/room.jpg",
        prompt: "interior",
      }),
    ).rejects.toMatchObject({ code: "api-error" });
  });

  it("times out while the request stays in queue", async () => {
    const fal = createFalClient({
      mode: "live",
      apiKey: "test-fal-key",
      sleep: async () => undefined,
      transport: async (request) => {
        if (request.method === "POST") {
          return {
            status: 200,
            headers: {},
            body: JSON.stringify({
              request_id: "req-slow",
              status_url: "https://queue.fal.run/fal-ai/hunyuan_world/requests/req-slow/status",
              response_url: "https://queue.fal.run/fal-ai/hunyuan_world/requests/req-slow",
            }),
          };
        }
        if (request.signal?.aborted) {
          throw Object.assign(new Error("Aborted"), { name: "AbortError" });
        }
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({ status: "IN_QUEUE", request_id: "req-slow", queue_position: 3 }),
        };
      },
    });

    await expect(
      fal.imageToPanorama({
        fixtureId: "unused",
        imageUrl: "https://example.test/room.jpg",
        prompt: "interior",
        timeoutMs: 20,
      }),
    ).rejects.toMatchObject({ code: "timeout" });
  });

  it("loads the packaged synthetic fal fixture from the default directory", async () => {
    const fal = createFalClient({
      mode: "fixture",
      fixtureDir: defaultFixtureDir(),
      transport: async () => {
        throw new Error("network must not be used");
      },
    });
    const result = await fal.imageToPanorama({
      fixtureId: "fal/hunyuan-world.synthetic",
      imageUrl: "https://example.test/unused.jpg",
      prompt: "unused",
    });
    expect(result.synthetic).toBe(true);
    expect(result.endpoint).toBe("fal-ai/hunyuan_world");
  });
});
