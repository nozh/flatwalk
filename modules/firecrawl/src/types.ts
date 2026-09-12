export type AssetKind = "plan" | "photo";

export type ListingAsset = {
  id: string;
  kind: AssetKind;
  sourceUrl: string;
  localPath: string;
  bytes: number;
};

export type ListingBundle = {
  source: {
    site: string;
    url: string;
    fetchedAt: string;
    listingId?: string;
  };
  title?: string;
  areaSqm?: number;
  roomsLabel?: string;
  assets: Record<string, ListingAsset>;
};

export type ScrapePage = {
  markdown?: string;
  json?: Record<string, unknown>;
};

export type ScrapeFn = (url: string) => Promise<ScrapePage>;

export type DownloadFn = (url: string) => Promise<{
  bytes: Uint8Array;
  contentType?: string;
}>;
