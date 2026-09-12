import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateFlatModel } from "@flatwalk/contract";
import type { ListingBundle } from "@flatwalk/firecrawl";
import { runImport, type ImportFetchListing } from "../src/import.ts";
import { repoRoot } from "../src/paths.ts";

const LISTING_URL = "https://cityexpert.rs/izdavanje-nekretnina/beograd/54541/troiposoban-stan-svetogorska-stari-grad";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const TINY_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
]);

function args(runDir: string): Parameters<typeof runImport>[0] {
  return {
    help: false,
    force: true,
    command: "import",
    runDir,
    url: LISTING_URL,
  };
}

function writeNestedFetch(options: {
  assetsDir: string;
  withPlan: boolean;
}): Promise<ListingBundle> {
  return (async () => {
    const listingDir = path.join(options.assetsDir, "54541");
    await mkdir(listingDir, { recursive: true });
    const assets: ListingBundle["assets"] = {};
    if (options.withPlan) {
      const localPath = path.join(listingDir, "plan-01.png");
      await writeFile(localPath, TINY_PNG);
      assets["plan-01"] = {
        id: "plan-01",
        kind: "plan",
        sourceUrl: "https://img.cityexpert.rs/properties/1920x/54000/54541/tlocrt/plan.png",
        localPath,
        bytes: TINY_PNG.byteLength,
      };
    }
    const photoPath = path.join(listingDir, "photo-01.jpg");
    await writeFile(photoPath, TINY_JPEG);
    assets["photo-01"] = {
      id: "photo-01",
      kind: "photo",
      sourceUrl: "https://img.cityexpert.rs/properties/1920x/54000/54541/slike/a.jpg",
      localPath: photoPath,
      bytes: TINY_JPEG.byteLength,
    };
    return {
      source: {
        site: "cityexpert",
        url: LISTING_URL,
        fetchedAt: "2026-09-12T15:00:00.000Z",
        listingId: "54541",
      },
      title: "Svetogorska",
      areaSqm: 105,
      roomsLabel: "Troiposoban",
      assets,
    };
  })();
}

describe("CLI live import layout", () => {
  it("refuses --url unless live adapters are explicit", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "flatwalk-cli-url-fixture-"));
    try {
      await expect(runImport(args(runDir), "fixture")).rejects.toThrow(/requires --adapters live/);
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });

  it("places fetch output in materials/ without a nested listing id", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "flatwalk-cli-live-layout-"));
    const fetchListing: ImportFetchListing = async ({ assetsDir }) =>
      writeNestedFetch({ assetsDir: assetsDir ?? runDir, withPlan: true });
    try {
      await runImport(args(runDir), "live", { fetchListing });

      const names = await readdir(path.join(runDir, "materials"));
      expect(names).not.toContain("54541");
      expect(names.sort()).toEqual(["listing.json", "photos", "plan-01.png"].sort());
      await access(path.join(runDir, "materials/plan-01.png"));
      await access(path.join(runDir, "materials/photos/photo-01.jpg"));

      const listing = JSON.parse(await readFile(path.join(runDir, "materials/listing.json"), "utf8")) as ListingBundle;
      expect(listing.assets["plan-01"]?.localPath).toBe("materials/plan-01.png");
      expect(listing.assets["photo-01"]?.localPath).toBe("materials/photos/photo-01.jpg");
      expect(listing.assets["plan-01"]?.kind).toBe("plan");
      expect(listing.assets["photo-01"]?.kind).toBe("photo");

      const model = JSON.parse(await readFile(path.join(runDir, "model/latest.json"), "utf8"));
      expect(() => validateFlatModel(model)).not.toThrow();
      expect(model.plan.asset).toBe("plan-01");
      expect(model.assets["plan-01"].url).toBe("materials/plan-01.png");
      expect(model.assets["photo-01"].url).toBe("materials/photos/photo-01.jpg");
      expect(model.revision).toBe(0);
      expect(model.rooms).toEqual({});
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });

  it("leaves plan.asset null when Firecrawl finds no plan and does not copy the 54541 fixture plan", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "flatwalk-cli-noplan-"));
    const fetchListing: ImportFetchListing = async ({ assetsDir }) =>
      writeNestedFetch({ assetsDir: assetsDir ?? runDir, withPlan: false });
    try {
      await runImport(args(runDir), "live", { fetchListing });

      const materials = await readdir(path.join(runDir, "materials"));
      expect(materials).not.toContain("plan.png");
      expect(materials).not.toContain("plan-01.png");
      expect(materials).not.toContain("54541");

      const listing = JSON.parse(await readFile(path.join(runDir, "materials/listing.json"), "utf8")) as ListingBundle;
      expect(Object.values(listing.assets).some((asset) => asset.kind === "plan")).toBe(false);

      const model = JSON.parse(await readFile(path.join(runDir, "model/latest.json"), "utf8"));
      expect(() => validateFlatModel(model)).not.toThrow();
      expect(model.plan.asset).toBeNull();

      const fixturePlan = await readFile(path.join(repoRoot(), "fixtures/54541/plan.png"));
      await expect(access(path.join(runDir, "materials/plan.png"))).rejects.toMatchObject({ code: "ENOENT" });
      expect(fixturePlan.byteLength).toBeGreaterThan(100);
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });
});
