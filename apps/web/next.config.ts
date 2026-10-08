import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit reads its built-in font metrics from disk at runtime; bundling breaks those paths.
  serverExternalPackages: ["pdfkit", "fontkit"],
  // The PDF export reads the bundled Noto fonts with fs; ship them with that function.
  outputFileTracingIncludes: {
    "/overview/export": ["./assets/fonts/**/*"],
  },
};

export default nextConfig;
