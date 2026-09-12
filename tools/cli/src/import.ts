import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { bundleToModel, fetchListing, type ListingBundle } from "@flatwalk/firecrawl";
import { refuseSilentLive, requireLiveMode, type AdapterMode } from "./adapters.ts";
import type { ParsedArgs } from "./args.ts";
import { CliError, EXIT } from "./errors.ts";
import { prepareRunDir } from "./layout.ts";
import { loadModelFile, writeModelFiles } from "./model-io.ts";
import { defaultFixtureDir, defaultSeedModel, resolveExistingPath } from "./resolve-path.ts";

function runRelative(runRoot: string, absoluteFile: string): string {
  return path.relative(runRoot, absoluteFile).split(path.sep).join("/");
}

async function copyFileToMaterials(
  source: string,
  materialsDir: string,
  relativeName: string,
): Promise<string> {
  const dest = path.join(materialsDir, relativeName);
  await mkdir(path.dirname(dest), { recursive: true });
  await cp(source, dest);
  return dest;
}

function materialNameForAsset(asset: ListingBundle["assets"][string], fallbackId: string): string {
  const base = path.basename(asset.localPath);
  if (asset.kind === "plan") return base || `${fallbackId}.png`;
  return path.join("photos", base || `${fallbackId}.jpg`);
}

async function resolveAssetFile(asset: ListingBundle["assets"][string], fromDir?: string): Promise<string | undefined> {
  const base = path.basename(asset.localPath);
  const candidates = [asset.localPath];
  if (fromDir) {
    candidates.push(
      path.join(fromDir, base),
      path.join(fromDir, "photos", base),
      path.join(fromDir, asset.kind === "plan" ? "plan.png" : path.join("photos", base)),
    );
  }
  for (const candidate of candidates) {
    const resolved = await resolveExistingPath(candidate);
    if (resolved) return resolved;
  }
  return undefined;
}

async function copyBundleAssets(
  bundle: ListingBundle,
  materialsDir: string,
  fromDir?: string,
): Promise<ListingBundle> {
  const assets: ListingBundle["assets"] = {};
  for (const [id, asset] of Object.entries(bundle.assets)) {
    const source = await resolveAssetFile(asset, fromDir);
    if (!source) {
      throw new CliError(
        EXIT.io,
        `Material file missing for asset ${id}: ${asset.localPath}. Fixture mode will not fetch it from the network.`,
      );
    }
    const relative = materialNameForAsset(asset, id);
    const dest = await copyFileToMaterials(source, materialsDir, relative);
    assets[id] = { ...asset, localPath: dest };
  }
  return { ...bundle, assets };
}

async function loadListingBundle(fromDir: string): Promise<ListingBundle> {
  const listingPath = path.join(fromDir, "listing.json");
  const resolved = await resolveExistingPath(listingPath);
  if (!resolved) {
    refuseSilentLive(`No listing.json in ${fromDir}.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(resolved, "utf8")) as unknown;
  } catch {
    throw new CliError(EXIT.io, `Cannot parse listing bundle: ${resolved}`);
  }
  if (!parsed || typeof parsed !== "object" || !("assets" in parsed) || !("source" in parsed)) {
    throw new CliError(EXIT.io, `listing.json is not a ListingBundle: ${resolved}`);
  }
  return parsed as ListingBundle;
}

async function copyFixtureTree(fromDir: string, materialsDir: string): Promise<void> {
  const plan = await resolveExistingPath(path.join(fromDir, "plan.png"));
  if (plan) await copyFileToMaterials(plan, materialsDir, "plan.png");
  const photosDir = await resolveExistingPath(path.join(fromDir, "photos"));
  if (photosDir) await cp(photosDir, path.join(materialsDir, "photos"), { recursive: true });
}

async function resolveSeedFile(args: ParsedArgs): Promise<string> {
  const raw =
    typeof args.seed === "string"
      ? args.seed
      : args.from
        ? path.join(args.from, "flat.model.json")
        : defaultSeedModel();
  const seedFile = await resolveExistingPath(raw);
  if (!seedFile) refuseSilentLive(`Seed model not found: ${raw}.`);
  return seedFile;
}

export async function runImport(args: ParsedArgs, adapters: AdapterMode): Promise<void> {
  if (!args.runDir) throw new CliError(EXIT.usage, "import requires a run directory");
  if (!args.from && !args.url) {
    throw new CliError(
      EXIT.usage,
      "import requires --from <dir> (fixture materials) or --url <listing> with --adapters live",
    );
  }
  if (args.url && args.from) {
    throw new CliError(EXIT.usage, "import accepts either --from or --url, not both");
  }

  const paths = await prepareRunDir(args.runDir, args.force);
  let bundle: ListingBundle;

  if (args.url) {
    requireLiveMode(adapters, "import --url");
    const fetched = await fetchListing({
      url: args.url,
      assetsDir: paths.materials,
      writeManifest: false,
    });
    bundle = await copyBundleAssets(fetched, paths.materials);
  } else {
    const fromDir = await resolveExistingPath(args.from!);
    if (!fromDir) {
      refuseSilentLive(`Source directory not found: ${args.from}. Looked in cwd and ${defaultFixtureDir()}.`);
    }
    bundle = await copyBundleAssets(await loadListingBundle(fromDir), paths.materials, fromDir);
    await copyFixtureTree(fromDir, paths.materials);
  }

  const listingOnDisk: ListingBundle = {
    ...bundle,
    assets: Object.fromEntries(
      Object.entries(bundle.assets).map(([id, asset]) => [
        id,
        { ...asset, localPath: runRelative(paths.root, asset.localPath) },
      ]),
    ),
  };
  await writeFile(paths.listing, `${JSON.stringify(listingOnDisk, null, 2)}\n`);
  console.log(`import: materials → ${paths.materials}`);

  if (args.seed) {
    const seedFile = await resolveSeedFile(args);
    const model = await loadModelFile(seedFile);
    const written = await writeModelFiles(paths.root, model);
    console.log(
      `import: seeded ${model.id} rev ${model.revision} → ${written.revision} (manual fixture, not recognition)`,
    );
    return;
  }

  const model = await bundleToModel(bundle, {
    assetUrl: (asset) => runRelative(paths.root, asset.localPath),
  });
  const written = await writeModelFiles(paths.root, model);
  console.log(`import: bundleToModel rev ${model.revision} → ${written.revision} (empty geometry; parse is separate)`);
}
