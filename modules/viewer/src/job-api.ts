/** Browser helper for the listing job API. Viewer owner wires this after the static-demo handoff. */

export type JobSnapshot = {
  job: {
    id: string;
    status: "queued" | "running" | "waiting_for_review" | "succeeded" | "failed" | "cancelled";
    stage: string;
    error?: string;
    modelId?: string;
    revision?: number;
    walkReady?: boolean;
  };
  runs: Array<{ stage: string; outcome: string; error?: string; diagnostics?: Record<string, unknown> }>;
  materials: Array<{ assetId: string; kind: string; url: string }>;
  model?: { id: string; revision: number };
  report?: { modelId: string; revision: number; walkReady: boolean };
};

export function jobApiBase(): string | undefined {
  const convex = import.meta.env.VITE_CONVEX_URL as string | undefined;
  const jobs = import.meta.env.VITE_JOB_API_URL as string | undefined;
  if (typeof jobs === "string" && jobs.trim()) return jobs.replace(/\/+$/, "");
  if (typeof convex === "string" && convex.trim()) return undefined;
  return undefined;
}

export async function submitListingJob(
  origin: string,
  body: { url?: string; from?: string; adapters?: "fixture" | "live" },
): Promise<{ job: { id: string } }> {
  const response = await fetch(`${origin}/api/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Job API ${response.status}`);
  return (await response.json()) as { job: { id: string } };
}

export async function loadJobSnapshot(origin: string, jobId: string): Promise<JobSnapshot> {
  const response = await fetch(`${origin}/api/jobs/${jobId}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Job ${jobId} ${response.status}`);
  return (await response.json()) as JobSnapshot;
}
