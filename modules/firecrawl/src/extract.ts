import { DEFAULT_IMAGE_HOSTS } from "./ssrf.js";

export type ListingMedia = {
  listingId?: string;
  title?: string;
  areaSqm?: number;
  roomsLabel?: string;
  floorPlanUrls: string[];
  photoUrls: string[];
};

const MARKDOWN_IMAGE_RE = /!\[[^\]]*]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const BARE_IMAGE_RE =
  /https?:\/\/[^\s)"'\\]+?(?:\.(?:jpe?g|png|webp|avif|gif))(?:\?[^\s)"'\\]*)?/gi;
const JUNK_RE = /\/assets\/|\/icons\/|banner|cookies\.png|\.svg(?:\?|$)/i;
const MEDIA_PATH_RE = /\/(slike|tlocrt)\//i;
const LISTING_HOSTS = new Set(["cityexpert.rs", "www.cityexpert.rs"]);

export function listingIdFromUrl(url: string): string | undefined {
  const match = url.match(/\/(\d{4,})(?:\/|$|\?)/);
  return match?.[1];
}

export function upgradeImageSize(url: string): string {
  return url.replace(/\/properties\/\d+x\//, "/properties/1920x/");
}

function uniquePreserveOrder(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

function collectRawImageRefs(markdown: string): string[] {
  const refs: string[] = [];
  for (const match of markdown.matchAll(MARKDOWN_IMAGE_RE)) {
    if (match[1]) refs.push(match[1]);
  }
  for (const match of markdown.matchAll(BARE_IMAGE_RE)) {
    refs.push(match[0]);
  }
  return uniquePreserveOrder(refs);
}

function rewriteCityExpertImageHost(url: URL): URL {
  const host = url.hostname.toLowerCase();
  if (LISTING_HOSTS.has(host) && url.pathname.includes("/properties/")) {
    url.hostname = DEFAULT_IMAGE_HOSTS[0];
  }
  return url;
}

function resolveListingImage(raw: string, pageUrl: string): URL | undefined {
  try {
    return rewriteCityExpertImageHost(new URL(raw, pageUrl));
  } catch {
    return undefined;
  }
}

function isAllowedImageHost(hostname: string): boolean {
  return (DEFAULT_IMAGE_HOSTS as readonly string[]).includes(hostname.toLowerCase());
}

function isListingMediaUrl(url: URL, listingId: string): boolean {
  if (url.protocol !== "https:") return false;
  if (!isAllowedImageHost(url.hostname)) return false;
  if (!url.pathname.includes(`/${listingId}/`)) return false;
  if (JUNK_RE.test(url.pathname) || JUNK_RE.test(url.href)) return false;
  return MEDIA_PATH_RE.test(url.pathname);
}

function parseAreaSqm(markdown: string): number | undefined {
  const labeled = markdown.match(/Povr[šs]ina[\s\S]{0,80}?(\d+(?:[.,]\d+)?)\s*m²/i);
  if (labeled) return Number(labeled[1].replace(",", "."));
  const loose = markdown.match(/(\d+(?:[.,]\d+)?)\s*m²/);
  return loose ? Number(loose[1].replace(",", ".")) : undefined;
}

function parseRoomsLabel(markdown: string): string | undefined {
  const labeled = markdown.match(/Struktura[\s\S]{0,80}?\n#{0,6}\s*([^\n]+)/i);
  if (labeled) return labeled[1].trim();
  const known = markdown.match(
    /\b(Troiposoban|Trosoban|Dvosoban|Jednosoban|Garsonjera|Četvorosoban|Cetvorosoban)\b/i,
  );
  return known?.[1];
}

function parseTitle(markdown: string): string | undefined {
  const heading = markdown.match(/^#\s+(.+)$/m);
  return heading?.[1]?.replace(/\s+/g, " ").trim();
}

export function extractListingMedia(input: {
  url: string;
  markdown: string;
}): ListingMedia {
  const listingId = listingIdFromUrl(input.url);
  const images = listingId
    ? uniquePreserveOrder(
        collectRawImageRefs(input.markdown)
          .map((ref) => resolveListingImage(ref, input.url))
          .filter((url): url is URL => url !== undefined)
          .filter((url) => isListingMediaUrl(url, listingId))
          .map((url) => upgradeImageSize(url.href)),
      )
    : [];

  const floorPlanUrls = images.filter((url) => /\/tlocrt\//i.test(url));
  const photoUrls = images.filter((url) => /\/slike\//i.test(url));

  return {
    listingId,
    title: parseTitle(input.markdown),
    areaSqm: parseAreaSqm(input.markdown),
    roomsLabel: parseRoomsLabel(input.markdown),
    floorPlanUrls,
    photoUrls,
  };
}
