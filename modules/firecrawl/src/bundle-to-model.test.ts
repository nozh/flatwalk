import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateFlatModel } from "@flatwalk/contract";
import { bundleToModel } from "./bundle-to-model.js";
import { TINY_PNG } from "./test-fixtures.js";
import type { ListingBundle } from "./types.js";

const FIXTURE_LISTING = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/54541/listing.json",
);

const declaredMeta = { provenance: "importer@0.1", basis: "declared" } as const;
const assumedMeta = { provenance: "importer@0.1", basis: "assumed" } as const;
const assumedDefaultsMeta = {
  wallHeight: assumedMeta,
  doorHeight: assumedMeta,
  windowSill: assumedMeta,
  windowHeight: assumedMeta,
};

function expectValidRev0(model: unknown) {
  const result = validateFlatModel(model);
  expect(result.success, result.success ? "" : JSON.stringify(result.error.issues, null, 2)).toBe(
    true,
  );
}

function bundle(overrides: Partial<ListingBundle> = {}): ListingBundle {
  return {
    source: {
      site: "cityexpert",
      url: "https://cityexpert.rs/izdavanje-nekretnina/beograd/54541/stan",
      fetchedAt: "2026-09-12T11:30:00Z",
      listingId: "54541",
    },
    areaSqm: 105,
    roomsLabel: "Troiposoban",
    assets: {},
    ...overrides,
  };
}

async function withPngAsset(id: string, kind: "plan" | "photo") {
  const dir = await mkdtemp(path.join(os.tmpdir(), "flatwalk-rev0-"));
  const localPath = path.join(dir, `${id}.png`);
  await writeFile(localPath, TINY_PNG);
  return {
    dir,
    asset: {
      id,
      kind,
      sourceUrl: `https://img.cityexpert.rs/properties/1920x/54000/54541/${kind === "plan" ? "tlocrt" : "slike"}/${id}.png`,
      localPath,
      bytes: TINY_PNG.byteLength,
    },
  };
}

describe("bundleToModel", () => {
  it("builds rev 0 with declared fields, assumed defaults, empty geometry and no scale", async () => {
    const plan = await withPngAsset("plan-01", "plan");
    const photo = await withPngAsset("photo-01", "photo");
    const model = await bundleToModel(
      bundle({
        assets: {
          "plan-01": plan.asset,
          "photo-01": photo.asset,
        },
      }),
    );

    expectValidRev0(model);
    expect(model.schemaVersion).toBe("0.1");
    expect(model.id).toBe("cityexpert-54541");
    expect(model.revision).toBe(0);
    expect(model.source).toEqual({
      site: "cityexpert",
      url: "https://cityexpert.rs/izdavanje-nekretnina/beograd/54541/stan",
      fetchedAt: "2026-09-12T11:30:00Z",
      listingId: "54541",
    });
    expect(model.flat.areaDeclared).toBe(105);
    expect(model.flat.roomsDeclared).toBe(3.5);
    expect(model.flat.meta).toEqual(declaredMeta);
    expect(model.flat.defaults).toEqual({
      wallHeight: 2.8,
      doorHeight: 2.1,
      windowSill: 0.9,
      windowHeight: 1.5,
      meta: assumedDefaultsMeta,
    });
    expect(model.plan.asset).toBe("plan-01");
    expect(model.plan.meta).toEqual(assumedMeta);
    expect(model.plan).not.toHaveProperty("pxPerMeter");
    expect(model.vertices).toEqual({});
    expect(model.walls).toEqual({});
    expect(model.openings).toEqual({});
    expect(model.rooms).toEqual({});
    expect(model.assets["plan-01"]).toEqual({
      kind: "plan",
      url: "plan-01.png",
      width: 1,
      height: 1,
      meta: declaredMeta,
    });
    expect(model.assets["photo-01"]).toEqual({
      kind: "photo",
      url: "photo-01.png",
      width: 1,
      height: 1,
      room: null,
      faces: null,
      meta: declaredMeta,
    });
  });

  it("omits undeclared area and unknown roomsLabel instead of inventing values", async () => {
    const model = await bundleToModel(
      bundle({
        areaSqm: undefined,
        roomsLabel: "Penthouse",
        assets: {},
      }),
    );

    expectValidRev0(model);
    expect(model.plan.asset).toBeNull();
    expect(model.plan).not.toHaveProperty("pxPerMeter");
    expect(model.flat).not.toHaveProperty("areaDeclared");
    expect(model.flat).not.toHaveProperty("roomsDeclared");
    expect(model.flat.defaults.wallHeight).toBe(2.8);
    expect(model.assets).toEqual({});
  });

  it("keeps every plan asset, points plan.asset at plan-01, and does not drop extras", async () => {
    const first = await withPngAsset("plan-01", "plan");
    const second = await withPngAsset("plan-02", "plan");
    const model = await bundleToModel(
      bundle({
        assets: {
          "plan-02": second.asset,
          "plan-01": first.asset,
        },
      }),
    );

    expectValidRev0(model);
    expect(model.plan.asset).toBe("plan-01");
    expect(Object.keys(model.assets).sort()).toEqual(["plan-01", "plan-02"]);
    expect(model.assets["plan-02"]?.kind).toBe("plan");
  });
});

function fixtureMaterialsReady(): boolean {
  if (!existsSync(FIXTURE_LISTING)) return false;
  const listing = JSON.parse(readFileSync(FIXTURE_LISTING, "utf8")) as ListingBundle;
  const assets = Object.values(listing.assets ?? {});
  return assets.length > 0 && assets.every((asset) => existsSync(asset.localPath));
}

describe("bundleToModel fixtures/54541", () => {
  it.skipIf(!fixtureMaterialsReady())(
    "builds rev 0 from the listing fixture when present",
    async () => {
      const listing = JSON.parse(await readFile(FIXTURE_LISTING, "utf8")) as ListingBundle;
      const model = await bundleToModel(listing, {
        assetUrl: (asset) => path.basename(asset.localPath),
      });

      expectValidRev0(model);
      expect(model.id).toBe("cityexpert-54541");
      expect(model.revision).toBe(0);
      expect(model.flat.areaDeclared).toBe(105);
      expect(model.flat.roomsDeclared).toBe(3.5);
      expect(model.plan.asset).toBeTruthy();
      expect(model.plan).not.toHaveProperty("pxPerMeter");
      expect(model.vertices).toEqual({});
      expect(model.rooms).toEqual({});
      const planId = model.plan.asset;
      expect(planId).toBeDefined();
      expect(model.assets[planId!]?.kind).toBe("plan");
      expect(model.assets[planId!]?.width).toBeGreaterThan(0);
      expect(Object.values(model.assets).some((asset) => asset.kind === "photo")).toBe(true);
    },
  );
});
