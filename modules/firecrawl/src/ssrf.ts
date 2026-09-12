import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

export const DEFAULT_IMAGE_HOSTS = ["img.cityexpert.rs"] as const;

export type AddressAnswer = { address: string; family: number };

export type SafeUrlOptions = {
  allowedHosts?: readonly string[];
  lookup?: (hostname: string) => Promise<AddressAnswer | AddressAnswer[]>;
};

function hextet(address: string): number | undefined {
  const first = address.split(":", 1)[0];
  if (!first) return undefined;
  const value = Number.parseInt(first, 16);
  return Number.isFinite(value) ? value : undefined;
}

export function isPrivateIp(address: string): boolean {
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return isPrivateIp(mapped[1]!);

  if (address.includes(":")) {
    const v6 = address.toLowerCase();
    if (v6 === "::1" || v6 === "::") return true;
    const head = hextet(v6);
    if (head === undefined) return true;
    if (head >= 0xfe80 && head <= 0xfebf) return true;
    if (head >= 0xfc00 && head <= 0xfdff) return true;
    return false;
  }

  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = parts as [number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function hostnameAllowed(hostname: string, allowedHosts: readonly string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return allowedHosts.some((allowed) => host === allowed.toLowerCase());
}

export async function assertSafeImageUrl(
  rawUrl: string,
  options: SafeUrlOptions = {},
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid image URL: ${rawUrl}`);
  }

  if (url.protocol !== "https:") {
    throw new Error(`Image URL must be https: ${rawUrl}`);
  }
  if (url.username || url.password) {
    throw new Error(`Image URL must not include credentials: ${rawUrl}`);
  }

  const allowedHosts = options.allowedHosts ?? DEFAULT_IMAGE_HOSTS;
  if (!hostnameAllowed(url.hostname, allowedHosts)) {
    throw new Error(`Image host is not on the allowlist: ${url.hostname}`);
  }

  if (isIP(url.hostname)) {
    if (isPrivateIp(url.hostname)) {
      throw new Error(`Image URL resolves to a private IP: ${url.hostname}`);
    }
    return url;
  }

  const lookup = options.lookup ?? defaultLookup;
  const answers = [await lookup(url.hostname)].flat();
  if (answers.length === 0) {
    throw new Error(`Image host did not resolve: ${url.hostname}`);
  }
  for (const answer of answers) {
    if (isPrivateIp(answer.address)) {
      throw new Error(`Image URL resolves to a private IP: ${answer.address}`);
    }
  }
  return url;
}

async function defaultLookup(hostname: string): Promise<AddressAnswer[]> {
  return dnsLookup(hostname, { all: true });
}
