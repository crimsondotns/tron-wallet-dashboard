import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit reads its built-in font metrics from disk at runtime; bundling breaks those paths.
  serverExternalPackages: ["pdfkit"],
};

export default nextConfig;
