// Block explorer URLs per chain. (chains.explorer_url in the DB only has the transaction prefix.)
const EXPLORERS: Record<string, { name: string; base: string; address: string; tx: string }> = {
  tron: { name: "Tronscan", base: "https://tronscan.org", address: "/#/address/", tx: "/#/transaction/" },
  ethereum: { name: "Etherscan", base: "https://etherscan.io", address: "/address/", tx: "/tx/" },
  bsc: { name: "BscScan", base: "https://bscscan.com", address: "/address/", tx: "/tx/" },
  polygon: { name: "PolygonScan", base: "https://polygonscan.com", address: "/address/", tx: "/tx/" },
  arbitrum: { name: "Arbiscan", base: "https://arbiscan.io", address: "/address/", tx: "/tx/" },
  base: { name: "BaseScan", base: "https://basescan.org", address: "/address/", tx: "/tx/" },
  optimism: { name: "Optimistic Etherscan", base: "https://optimistic.etherscan.io", address: "/address/", tx: "/tx/" },
};

export function explorerLink(chain: string, kind: "address" | "tx", value: string): { url: string; name: string } | null {
  const e = EXPLORERS[chain];
  return e ? { url: `${e.base}${e[kind]}${encodeURIComponent(value)}`, name: e.name } : null;
}
