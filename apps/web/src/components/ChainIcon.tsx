import { asset } from "@/lib/base";

// Official chain marks (web3icons "background" variant, MIT), served from /public/chains.
const KNOWN = new Set(["tron", "ethereum", "bsc", "polygon", "arbitrum", "optimism", "base", "solana"]);

export function ChainIcon({ chain, size = 16 }: { chain: string; size?: number }) {
  if (!KNOWN.has(chain)) {
    return (
      <svg className="chain-icon" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="8" fill="#535353" />
      </svg>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- tiny static SVG; no optimisation needed
  return <img className="chain-icon" src={asset(`/chains/${chain}.svg`)} width={size} height={size} alt="" aria-hidden="true" />;
}
