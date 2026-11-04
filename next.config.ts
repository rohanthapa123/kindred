import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Appends ?dpl=<id> to every /_next/static URL. Bump it to force browsers past stale cached
  // responses for assets (e.g. the 308 loops cached while Cloudflare was proxying with Flexible SSL).
  deploymentId: "kindred-2",
  // the word data is read with fs at runtime; make sure deploys ship it
  outputFileTracingIncludes: {
    "/api/**": ["./data/**"],
  },
};

export default nextConfig;
