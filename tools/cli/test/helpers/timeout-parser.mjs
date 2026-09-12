#!/usr/bin/env node
await new Promise((resolve) => setTimeout(resolve, 30_000));
process.stdout.write(`${JSON.stringify({ patch: null, reason: "not-implemented" })}\n`);
