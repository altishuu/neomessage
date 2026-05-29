import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Set the root directory so Turbopack doesn't pick up lockfiles
    // from parent directories (e.g. the home directory).
    root: "/home/ivanadcan35/Documents/Projects/NextJS/neomessage",
  },
};

export default nextConfig;
