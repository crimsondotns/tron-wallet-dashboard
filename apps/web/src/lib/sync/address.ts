import { isSolanaAddress } from "./solanaAddress";

// Address format per chain. EVM addresses are stored lowercase (checksum or not on input),
// matching the wallets check constraint and the exact from/to match in ingest_transfers.
// Solana base58 is case-sensitive and kept as typed.
const TRON_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const EVM_RE = /^0x[0-9a-fA-F]{40}$/;

// Seeded EVM chains (chains.family = 'evm') and their chain ids.
export const EVM_CHAIN_IDS: Record<string, number> = { ethereum: 1, bsc: 56, polygon: 137, arbitrum: 42161, base: 8453, optimism: 10 };
export const isEvmChain = (chain: string) => Object.hasOwn(EVM_CHAIN_IDS, chain);

// Returns the address as it must be stored, or null if it doesn't fit the chain.
export function normalizeAddress(chain: string, address: string): string | null {
  const a = address.trim();
  if (chain === "tron") return TRON_RE.test(a) ? a : null;
  if (isEvmChain(chain)) return EVM_RE.test(a) ? a.toLowerCase() : null;
  if (chain === "solana") return isSolanaAddress(a) ? a : null;
  return a || null; // other families validate in the database
}
