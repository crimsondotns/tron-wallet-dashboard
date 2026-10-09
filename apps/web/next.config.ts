import type { NextConfig } from "next";

// Static export for GitHub Pages: no server, so everything (auth, data, exports) runs in the
// browser against Supabase, where RLS and the RPCs enforce access. NEXT_PUBLIC_BASE_PATH is the
// Pages project path ("/xcap-insight"); unset for local dev at the root.
const nextConfig: NextConfig = {
  output: "export",
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
