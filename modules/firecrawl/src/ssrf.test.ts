import { describe, expect, it } from "vitest";
import { assertSafeImageUrl, isPrivateIp } from "./ssrf.js";

describe("isPrivateIp", () => {
  it("flags loopback, rfc1918, link-local and ipv6 unique-local", () => {
    expect(isPrivateIp("127.0.0.1")).toBe(true);
    expect(isPrivateIp("10.0.0.8")).toBe(true);
    expect(isPrivateIp("192.168.1.1")).toBe(true);
    expect(isPrivateIp("172.16.5.1")).toBe(true);
    expect(isPrivateIp("169.254.169.254")).toBe(true);
    expect(isPrivateIp("::1")).toBe(true);
    expect(isPrivateIp("fd12::1")).toBe(true);
    expect(isPrivateIp("8.8.8.8")).toBe(false);
  });
});

describe("assertSafeImageUrl", () => {
  it("allows the cityexpert image CDN over https", async () => {
    await expect(
      assertSafeImageUrl("https://img.cityexpert.rs/properties/1920x/54000/54541/slike/a.jpg", {
        lookup: async () => ({ address: "1.2.3.4", family: 4 }),
      }),
    ).resolves.toMatchObject({ hostname: "img.cityexpert.rs" });
  });

  it("rejects other hosts, http, and private DNS answers", async () => {
    await expect(
      assertSafeImageUrl("https://evil.example/54541/slike/a.jpg", {
        lookup: async () => ({ address: "1.2.3.4", family: 4 }),
      }),
    ).rejects.toThrow(/allowlist/i);

    await expect(
      assertSafeImageUrl("http://img.cityexpert.rs/properties/1920x/54000/54541/slike/a.jpg", {
        lookup: async () => ({ address: "1.2.3.4", family: 4 }),
      }),
    ).rejects.toThrow(/https/i);

    await expect(
      assertSafeImageUrl("https://img.cityexpert.rs/properties/1920x/54000/54541/slike/a.jpg", {
        lookup: async () => ({ address: "127.0.0.1", family: 4 }),
      }),
    ).rejects.toThrow(/private/i);
  });
});
