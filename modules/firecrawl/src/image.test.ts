import { describe, expect, it } from "vitest";
import { imageSizeFromBytes } from "./image.js";
import { TINY_PNG } from "./test-fixtures.js";

function jpegSof0(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff, 0x01, 0x01, 0x11, 0x00,
  ]);
}

describe("imageSizeFromBytes", () => {
  it("reads PNG IHDR width and height", () => {
    expect(imageSizeFromBytes(TINY_PNG)).toEqual({ width: 1, height: 1 });
  });

  it("reads JPEG SOF0 width and height", () => {
    expect(imageSizeFromBytes(jpegSof0(1920, 1280))).toEqual({ width: 1920, height: 1280 });
  });
});
