import { readFile } from "node:fs/promises";

export type ImageKind = "png" | "jpg" | "webp" | "gif" | "avif";

export function sniffImage(bytes: Uint8Array): ImageKind | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "gif";
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const brand = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!);
    if (brand === "avif" || brand === "avis" || brand === "mif1" || brand === "miaf") {
      return "avif";
    }
  }
  return null;
}

export function looksLikeHtml(bytes: Uint8Array): boolean {
  const head = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.slice(0, 80))
    .trimStart()
    .toLowerCase();
  return (
    head.startsWith("<!doctype") ||
    head.startsWith("<html") ||
    head.startsWith("<head") ||
    head.startsWith("<?xml")
  );
}

export function assertImageBytes(bytes: Uint8Array): ImageKind {
  if (looksLikeHtml(bytes)) {
    throw new Error("Downloaded body is not an image");
  }
  const kind = sniffImage(bytes);
  if (!kind) {
    throw new Error("Downloaded body is not an image");
  }
  return kind;
}

export type ImageSize = {
  width: number;
  height: number;
};

function u16be(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function u16le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function u32be(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}

function jpegSize(bytes: Uint8Array): ImageSize {
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1]!;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = u16be(bytes, offset + 2);
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return {
        height: u16be(bytes, offset + 5),
        width: u16be(bytes, offset + 7),
      };
    }
    offset += 2 + length;
  }
  throw new Error("JPEG is missing a SOF size marker");
}

function webpSize(bytes: Uint8Array): ImageSize {
  if (bytes.length < 30) {
    throw new Error("WEBP is truncated");
  }
  const chunk = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
  if (chunk === "VP8X") {
    return {
      width: 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)),
      height: 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)),
    };
  }
  if (chunk === "VP8 ") {
    return {
      width: u16le(bytes, 26) & 0x3fff,
      height: u16le(bytes, 28) & 0x3fff,
    };
  }
  if (chunk === "VP8L") {
    const bits = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  throw new Error(`Unsupported WEBP chunk ${chunk}`);
}

export function imageSizeFromBytes(bytes: Uint8Array): ImageSize {
  const kind = sniffImage(bytes);
  if (kind === "png") {
    if (bytes.length < 24) throw new Error("PNG is truncated");
    const width = u32be(bytes, 16);
    const height = u32be(bytes, 20);
    if (width === 0 || height === 0) throw new Error("PNG has invalid dimensions");
    return { width, height };
  }
  if (kind === "jpg") return jpegSize(bytes);
  if (kind === "gif") {
    if (bytes.length < 10) throw new Error("GIF is truncated");
    return { width: u16le(bytes, 6), height: u16le(bytes, 8) };
  }
  if (kind === "webp") return webpSize(bytes);
  throw new Error(`Cannot read dimensions for ${kind ?? "unknown"} image`);
}

export async function readImageSizeFromFile(filePath: string): Promise<ImageSize> {
  return imageSizeFromBytes(await readFile(filePath));
}
