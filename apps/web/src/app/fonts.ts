import { Inter, JetBrains_Mono, Noto_Sans_JP, Noto_Sans_SC, Noto_Sans_Thai } from "next/font/google";

// Latin glyphs always come from Inter; each locale adds its own script font behind it
// (see --font-ui per html[data-locale] in globals.css). CJK fonts are split by unicode-range,
// so browsers only download the slices a page uses; they're not preloaded.
export const inter = Inter({ subsets: ["latin"], weight: ["400", "700"], variable: "--f-inter", display: "swap" });
export const thai = Noto_Sans_Thai({ subsets: ["thai"], weight: ["400", "700"], variable: "--f-thai", display: "swap" });
export const sc = Noto_Sans_SC({ weight: ["400", "700"], variable: "--f-sc", display: "swap", preload: false });
export const jp = Noto_Sans_JP({ weight: ["400", "700"], variable: "--f-jp", display: "swap", preload: false });
export const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "700"], variable: "--f-mono", display: "swap" });

export const fontVars = [inter, thai, sc, jp, mono].map((f) => f.variable).join(" ");
