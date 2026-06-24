import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin this directory as the workspace root. Without it, Turbopack walks up and
  // can latch onto an unrelated lockfile on the Desktop, picking the wrong
  // package manager (npm instead of pnpm) and skipping our pnpm.overrides.
  turbopack: {
    root: import.meta.dirname,
  },
  // Keep Better Auth (and its DB adapters) out of the Turbopack server bundle.
  // The kysely adapter does a named import that kysely 0.29.x doesn't expose
  // as a top-level ESM export; bundling trips Turbopack's strict static check,
  // but at runtime Node resolves it fine. Externalizing = load via Node require.
  serverExternalPackages: [
    "better-auth",
    "@better-auth/core",
    "@better-auth/kysely-adapter",
    "@better-auth/drizzle-adapter",
    "kysely",
    "twilio",
    "googleapis",
    "@anthropic-ai/sdk",
    "cheerio",
  ],
};

export default nextConfig;
