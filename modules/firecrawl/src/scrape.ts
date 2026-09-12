import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { Firecrawl } from "firecrawl";
import type { ScrapePage } from "./types.js";

export function loadFirecrawlEnv(): void {
  if (process.env.FIRECRAWL_API_KEY) return;
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "modules/firecrawl/.env"),
    path.resolve(moduleDir, "../../.env"),
    path.resolve(moduleDir, "../.env"),
  ];
  for (const envPath of candidates) {
    config({ path: envPath });
    if (process.env.FIRECRAWL_API_KEY) return;
  }
}

export function createFirecrawlScraper(options?: {
  apiKey?: string;
}): (url: string) => Promise<ScrapePage> {
  loadFirecrawlEnv();
  const apiKey = options?.apiKey ?? process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error("FIRECRAWL_API_KEY is missing. Copy .env.example to .env.");
  }

  const client = new Firecrawl({ apiKey });

  return async (url: string): Promise<ScrapePage> => {
    const doc = await client.scrape(url, {
      formats: ["markdown"],
      onlyMainContent: true,
      waitFor: 2500,
    });
    return {
      markdown: typeof doc.markdown === "string" ? doc.markdown : undefined,
    };
  };
}
