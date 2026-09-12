import { randomBytes } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertImageBytes } from "./image.js";
import { assertSafeImageUrl, type AddressAnswer } from "./ssrf.js";
import type { DownloadFn, ListingAsset } from "./types.js";
import type { ListingMedia } from "./extract.js";

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 5;

function pad(index: number): string {
  return String(index).padStart(2, "0");
}

function jobsFromMedia(media: ListingMedia): Array<{
  id: string;
  kind: ListingAsset["kind"];
  url: string;
}> {
  const jobs: Array<{ id: string; kind: ListingAsset["kind"]; url: string }> = [];
  media.floorPlanUrls.forEach((url, index) => {
    jobs.push({ id: `plan-${pad(index + 1)}`, kind: "plan", url });
  });
  media.photoUrls.forEach((url, index) => {
    jobs.push({ id: `photo-${pad(index + 1)}`, kind: "photo", url });
  });
  return jobs;
}

export function listingOutputDir(assetsRoot: string, listingId: string): string {
  return path.basename(assetsRoot) === listingId
    ? assetsRoot
    : path.join(assetsRoot, listingId);
}

export async function saveListingAssets(input: {
  media: ListingMedia;
  assetsDir: string;
  download: DownloadFn;
  extraFiles?:
    | Record<string, string>
    | ((assets: Record<string, ListingAsset>) => Record<string, string>);
}): Promise<Record<string, ListingAsset>> {
  const staging = `${input.assetsDir.replace(/\/+$/, "")}.tmp-${randomBytes(6).toString("hex")}`;
  const assets: Record<string, ListingAsset> = {};

  try {
    await mkdir(staging, { recursive: true });
    for (const job of jobsFromMedia(input.media)) {
      const file = await input.download(job.url);
      const kind = assertImageBytes(file.bytes);
      const filename = `${job.id}.${kind}`;
      await writeFile(path.join(staging, filename), file.bytes);
      assets[job.id] = {
        id: job.id,
        kind: job.kind,
        sourceUrl: job.url,
        localPath: path.join(input.assetsDir, filename),
        bytes: file.bytes.byteLength,
      };
    }
    const extras =
      typeof input.extraFiles === "function"
        ? input.extraFiles(assets)
        : (input.extraFiles ?? {});
    for (const [name, contents] of Object.entries(extras)) {
      await writeFile(path.join(staging, name), contents);
    }
    await rm(input.assetsDir, { recursive: true, force: true });
    await mkdir(path.dirname(input.assetsDir), { recursive: true });
    await rename(staging, input.assetsDir);
    return assets;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

export type DownloadHttpOptions = {
  lookup?: (hostname: string) => Promise<AddressAnswer | AddressAnswer[]>;
  fetch?: typeof fetch;
  maxBytes?: number;
  timeoutMs?: number;
};

async function readLimitedBody(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`Image is too large (${declared} bytes)`);
  }

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      throw new Error(`Image is too large (${bytes.byteLength} bytes)`);
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Image is too large (${total} bytes)`);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function downloadHttp(
  url: string,
  options: DownloadHttpOptions = {},
): Promise<{
  bytes: Uint8Array;
  contentType?: string;
}> {
  const fetchImpl = options.fetch ?? fetch;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertSafeImageUrl(current, { lookup: options.lookup });
    const response = await fetchImpl(current, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "User-Agent": "flatwalk-fetcher/0.1",
        Referer: "https://cityexpert.rs/",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) {
        throw new Error(`Redirect without Location from ${current}`);
      }
      current = new URL(location, current).href;
      continue;
    }

    if (!response.ok) {
      throw new Error(`Download failed ${response.status} for ${current}`);
    }

    const bytes = await readLimitedBody(response, maxBytes);
    assertImageBytes(bytes);
    return {
      bytes,
      contentType: response.headers.get("content-type") ?? undefined,
    };
  }

  throw new Error(`Too many redirects for ${url}`);
}
