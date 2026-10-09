"use client";

import { useState } from "react";
import { ChainIcon } from "./ChainIcon";

// Trust Wallet's open asset repo (served by jsDelivr): per-chain token logos keyed by contract.
const CDN = "https://cdn.jsdelivr.net/gh/trustwallet/assets@master/blockchains";
const REPO_CHAIN: Record<string, string> = { tron: "tron", ethereum: "ethereum", bsc: "smartchain", polygon: "polygon", arbitrum: "arbitrum", optimism: "optimism", base: "base", solana: "solana" };
const NATIVE: Record<string, string> = { tron: "TRX", ethereum: "ETH", bsc: "BNB", polygon: "POL", arbitrum: "ETH", optimism: "ETH", base: "ETH", solana: "SOL" };
// Well-known contracts by symbol. Matching on symbol alone could show a real logo on a fake
// token of the same name, so only major tokens are listed; anything else gets a letter avatar.
const KNOWN: Record<string, Record<string, string>> = {
  tron: {
    USDT: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    USDC: "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8",
    USDD: "TXDk8mbtRbXeYuMNS83CfKPaYYT8XWv9Hz",
    TUSD: "TUpMhErZL2fhh4sVNULAbNKLokS4GjC1F4",
    BTT: "TAFjULxiVgT4qWk6UZwjqwZXTSaGaqnVp4",
    JST: "TCFLL5dx5ZJdKnWuesXxi1VPwjLVmWZZy9",
    SUN: "TSSMHYeV2uE9qYH95DqyoCuNCzEL1NvU3S",
    WIN: "TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7",
    WTRX: "TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR",
  },
  solana: {
    USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  },
  ethereum: {
    USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  },
};

function logoUrl(symbol: string, chain: string): string | null {
  const repo = REPO_CHAIN[chain];
  if (!repo) return null;
  if (NATIVE[chain] === symbol.toUpperCase()) return `${CDN}/${repo}/info/logo.png`;
  const contract = KNOWN[chain]?.[symbol.toUpperCase()];
  return contract ? `${CDN}/${repo}/assets/${contract}/logo.png` : null;
}

// Token logo with the chain's mark as a small badge at the bottom-right.
export function TokenIcon({ symbol, chain, size = 20 }: { symbol: string; chain: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const url = failed ? null : logoUrl(symbol, chain);
  const badge = Math.round(size * 0.5);
  return (
    <span className="token-icon" style={{ width: size, height: size }} aria-hidden="true">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- tiny third-party logo; no optimisation needed
        <img src={url} alt="" width={size} height={size} loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <span className="token-letter" style={{ fontSize: Math.round(size * 0.45) }}>{symbol.replace(/[^A-Za-z0-9]/g, "").slice(0, 1).toUpperCase() || "?"}</span>
      )}
      {NATIVE[chain] !== symbol.toUpperCase() && (
        <span className="token-badge" style={{ width: badge, height: badge }}><ChainIcon chain={chain} size={badge} /></span>
      )}
    </span>
  );
}
