import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { downloadHttp, saveListingAssets } from "./assets.js";
import { TINY_PNG } from "./test-fixtures.js";

describe("saveListingAssets", () => {
  it("writes into a staging dir and does not leave partial files on failure", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "flatwalk-assets-"));
    try {
      await expect(
        saveListingAssets({
          media: {
            listingId: "54541",
            floorPlanUrls: [
              "https://img.cityexpert.rs/properties/1920x/54000/54541/tlocrt/a.png",
              "https://img.cityexpert.rs/properties/1920x/54000/54541/tlocrt/b.png",
            ],
            photoUrls: [
              "https://img.cityexpert.rs/properties/1920x/54000/54541/slike/a.jpg",
            ],
          },
          assetsDir: dir,
          download: async (url) => {
            if (url.endsWith("a.jpg")) throw new Error("boom");
            return { bytes: TINY_PNG, contentType: "image/png" };
          },
        }),
      ).rejects.toThrow("boom");

      expect(await readdir(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("replaces a previous listing folder instead of mixing old photos", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "flatwalk-assets-"));
    try {
      await writeFile(path.join(dir, "photo-99.jpg"), "stale");
      const assets = await saveListingAssets({
        media: {
          listingId: "54541",
          floorPlanUrls: [
            "https://img.cityexpert.rs/properties/1920x/54000/54541/tlocrt/a.png",
          ],
          photoUrls: [
            "https://img.cityexpert.rs/properties/1920x/54000/54541/slike/a.jpg",
          ],
        },
        assetsDir: dir,
        download: async () => ({ bytes: TINY_PNG, contentType: "image/png" }),
      });

      const names = (await readdir(dir)).sort();
      expect(names).toEqual(["photo-01.png", "plan-01.png"]);
      expect(assets["plan-01"]?.localPath).toBe(path.join(dir, "plan-01.png"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("downloadHttp", () => {
  it("rejects html bodies even with 200 and image content-type", async () => {
    await expect(
      downloadHttp("https://img.cityexpert.rs/properties/1920x/54000/54541/slike/a.jpg", {
        lookup: async () => ({ address: "1.2.3.4", family: 4 }),
        fetch: async () =>
          new Response("<html>login</html>", {
            status: 200,
            headers: { "content-type": "image/jpeg" },
          }),
      }),
    ).rejects.toThrow(/not an image/i);
  });

  it("refuses redirects that leave the allowlist", async () => {
    await expect(
      downloadHttp("https://img.cityexpert.rs/properties/1920x/54000/54541/slike/a.jpg", {
        lookup: async () => ({ address: "1.2.3.4", family: 4 }),
        fetch: async () =>
          new Response(null, {
            status: 302,
            headers: { location: "http://127.0.0.1/secret" },
          }),
      }),
    ).rejects.toThrow();
  });

  it("accepts a png and enforces the size cap from content-length", async () => {
    await expect(
      downloadHttp("https://img.cityexpert.rs/properties/1920x/54000/54541/tlocrt/a.png", {
        lookup: async () => ({ address: "1.2.3.4", family: 4 }),
        maxBytes: 10,
        fetch: async () =>
          new Response(TINY_PNG, {
            status: 200,
            headers: { "content-type": "image/png", "content-length": "99999" },
          }),
      }),
    ).rejects.toThrow(/too large/i);
  });
});
