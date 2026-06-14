import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Set the root directory so Turbopack doesn't pick up lockfiles
    // from parent directories (e.g. the home directory).
    root: process.cwd(),
  },
};

export default nextConfig;
