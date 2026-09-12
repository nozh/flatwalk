import path from "node:path";
import { FlatModelSchema, type FlatModel } from "@flatwalk/contract";
import { readImageSizeFromFile } from "./image.js";
import { roomsDeclaredFromLabel } from "./rooms-label.js";
import type { ListingAsset, ListingBundle } from "./types.js";

export const IMPORTER_PROVENANCE = "importer@0.1";

const declaredMeta = { provenance: IMPORTER_PROVENANCE, basis: "declared" } as const;
const assumedMeta = { provenance: IMPORTER_PROVENANCE, basis: "assumed" } as const;

export type BundleToModelOptions = {
  readImageSize?: (localPath: string) => Promise<{ width: number; height: number }>;
  assetUrl?: (asset: ListingAsset) => string;
};

function primaryPlanId(assets: ListingBundle["assets"]): string | null {
  return (
    Object.values(assets)
      .filter((asset) => asset.kind === "plan")
      .map((asset) => asset.id)
      .sort((a, b) => a.localeCompare(b))[0] ?? null
  );
}

function defaultAssetUrl(asset: ListingAsset): string {
  return path.basename(asset.localPath);
}

export async function bundleToModel(
  bundle: ListingBundle,
  options: BundleToModelOptions = {},
): Promise<FlatModel> {
  const listingId = bundle.source.listingId;
  if (!listingId) {
    throw new Error("Cannot build rev 0 without source.listingId");
  }

  const readImageSize = options.readImageSize ?? readImageSizeFromFile;
  const assetUrl = options.assetUrl ?? defaultAssetUrl;
  const assets: FlatModel["assets"] = {};
  const roomsDeclared = roomsDeclaredFromLabel(bundle.roomsLabel);

  for (const asset of Object.values(bundle.assets)) {
    const size = await readImageSize(asset.localPath);
    if (asset.kind === "plan") {
      assets[asset.id] = {
        kind: "plan",
        url: assetUrl(asset),
        width: size.width,
        height: size.height,
        meta: declaredMeta,
      };
    } else {
      assets[asset.id] = {
        kind: "photo",
        url: assetUrl(asset),
        width: size.width,
        height: size.height,
        room: null,
        faces: null,
        meta: declaredMeta,
      };
    }
  }

  const model = {
    schemaVersion: "0.1" as const,
    id: `${bundle.source.site}-${listingId}`,
    revision: 0,
    source: {
      site: bundle.source.site,
      url: bundle.source.url,
      fetchedAt: bundle.source.fetchedAt,
      listingId,
    },
    plan: {
      asset: primaryPlanId(bundle.assets),
      meta: assumedMeta,
    },
    flat: {
      ...(bundle.areaSqm !== undefined ? { areaDeclared: bundle.areaSqm } : {}),
      ...(roomsDeclared !== undefined ? { roomsDeclared } : {}),
      meta: declaredMeta,
      defaults: {
        wallHeight: 2.8,
        doorHeight: 2.1,
        windowSill: 0.9,
        windowHeight: 1.5,
        meta: {
          wallHeight: assumedMeta,
          doorHeight: assumedMeta,
          windowSill: assumedMeta,
          windowHeight: assumedMeta,
        },
      },
    },
    vertices: {},
    walls: {},
    openings: {},
    rooms: {},
    assets,
  };

  const parsed = FlatModelSchema.safeParse(model);
  if (!parsed.success) {
    throw new Error(`Invalid FlatModel rev 0: ${parsed.error.message}`);
  }
  return parsed.data;
}
