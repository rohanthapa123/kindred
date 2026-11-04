import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // the word data is read with fs at runtime; make sure deploys ship it
  outputFileTracingIncludes: {
    "/api/**": ["./data/**"],
  },
};

export default nextConfig;
