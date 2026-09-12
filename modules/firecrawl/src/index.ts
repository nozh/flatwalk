import path from "node:path";
import { extractListingMedia } from "./extract.js";
import { downloadHttp, listingOutputDir, saveListingAssets } from "./assets.js";
import { createFirecrawlScraper, loadFirecrawlEnv } from "./scrape.js";
import type { DownloadFn, ListingBundle, ScrapeFn } from "./types.js";

function siteFromUrl(url: string): string {
  const host = new URL(url).hostname.replace(/^www\./, "");
  return host.split(".")[0] ?? host;
}

export async function fetchListing(options: {
  url: string;
  assetsDir?: string;
  scrape?: ScrapeFn;
  download?: DownloadFn;
  writeManifest?: boolean;
}): Promise<ListingBundle> {
  if (!options.scrape) loadFirecrawlEnv();
  const scrape = options.scrape ?? createFirecrawlScraper();
  const download = options.download ?? downloadHttp;
  const assetsRoot = options.assetsDir ?? path.resolve("assets");

  const page = await scrape(options.url);
  if (!page.markdown) {
    throw new Error(`Firecrawl returned no markdown for ${options.url}`);
  }

  const media = extractListingMedia({ url: options.url, markdown: page.markdown });
  if (!media.listingId) {
    throw new Error(`Could not determine listing id from ${options.url}`);
  }
  if (media.floorPlanUrls.length === 0 && media.photoUrls.length === 0) {
    throw new Error(`No floor plan or listing photos found at ${options.url}`);
  }

  const assetsDir = listingOutputDir(assetsRoot, media.listingId);

  const makeBundle = (assets: ListingBundle["assets"]): ListingBundle => ({
    source: {
      site: siteFromUrl(options.url),
      url: options.url,
      fetchedAt: new Date().toISOString(),
      listingId: media.listingId,
    },
    title: media.title,
    areaSqm: media.areaSqm,
    roomsLabel: media.roomsLabel,
    assets,
  });

  const assets = await saveListingAssets({
    media,
    assetsDir,
    download,
    extraFiles:
      options.writeManifest === false
        ? undefined
        : (saved) => ({
            "listing.json": `${JSON.stringify(makeBundle(saved), null, 2)}\n`,
          }),
  });

  return makeBundle(assets);
}

export { createFirecrawlScraper, loadFirecrawlEnv } from "./scrape.js";
export { extractListingMedia, listingIdFromUrl, upgradeImageSize } from "./extract.js";
export { listingOutputDir } from "./assets.js";
export { bundleToModel } from "./bundle-to-model.js";
export { roomsDeclaredFromLabel } from "./rooms-label.js";
export { imageSizeFromBytes, readImageSizeFromFile } from "./image.js";
export type { ListingBundle, ListingAsset, ScrapeFn, DownloadFn } from "./types.js";
export type { BundleToModelOptions } from "./bundle-to-model.js";
