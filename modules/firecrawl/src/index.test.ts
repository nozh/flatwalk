import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fetchListing } from "./index.js";
import { TINY_JPEG, TINY_PNG } from "./test-fixtures.js";

describe("fetchListing", () => {
  it("nests files under the listing id and writes the manifest there", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "flatwalk-fetch-"));
    try {
      const bundle = await fetchListing({
        url: "https://cityexpert.rs/izdavanje-nekretnina/beograd/54541/stan",
        assetsDir: dir,
        scrape: async () => ({
          markdown: `
![photo](https://img.cityexpert.rs/properties/1920x/54000/54541/slike/a.jpg)
![floor plan](https://img.cityexpert.rs/properties/470x/54000/54541/tlocrt/plan.png)
###### Površina
##### 105  m²
`,
        }),
        download: async () => ({
          bytes: TINY_PNG,
          contentType: "image/png",
        }),
      });

      const listingDir = path.join(dir, "54541");
      expect(bundle.assets["plan-01"]?.kind).toBe("plan");
      expect(bundle.assets["plan-01"]?.sourceUrl).toContain("/1920x/");
      expect(bundle.assets["photo-01"]?.kind).toBe("photo");
      expect(await readdir(dir)).toEqual(["54541"]);
      expect((await readdir(listingDir)).sort()).toEqual([
        "listing.json",
        "photo-01.png",
        "plan-01.png",
      ]);
      const manifest = JSON.parse(await readFile(path.join(listingDir, "listing.json"), "utf8"));
      expect(manifest.assets["plan-01"].localPath).toBe(path.join(listingDir, "plan-01.png"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("names files from sniffed bytes and keeps photos without inventing a floor plan", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "flatwalk-fetch-noplan-"));
    try {
      const bundle = await fetchListing({
        url: "https://cityexpert.rs/izdavanje-nekretnina/beograd/54541/stan",
        assetsDir: dir,
        writeManifest: false,
        scrape: async () => ({
          markdown: `
![photo](https://img.cityexpert.rs/properties/1920x/54000/54541/slike/a.jpg)
###### Površina
##### 105  m²
`,
        }),
        download: async (url) =>
          url.includes("/tlocrt/")
            ? { bytes: TINY_PNG, contentType: "image/png" }
            : { bytes: TINY_JPEG, contentType: "image/jpeg" },
      });

      expect(bundle.assets["plan-01"]).toBeUndefined();
      expect(Object.values(bundle.assets).every((asset) => asset.kind === "photo")).toBe(true);
      expect(bundle.assets["photo-01"]?.localPath.endsWith("photo-01.jpg")).toBe(true);
      expect((await readdir(path.join(dir, "54541"))).sort()).toEqual(["photo-01.jpg"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
