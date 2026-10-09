// Chains the sync engine can read today, with their provider ids (see ./providers and PROVIDERS in ./engine).
// Chains without a provider stay hidden from pickers and are rejected by server actions.
export const CHAIN_PROVIDERS: Record<string, readonly string[]> = {
  tron: ["tronscan", "trongrid"],
  solana: ["solana_rpc"],
};

export const isSupportedChain = (chain: string) => Object.hasOwn(CHAIN_PROVIDERS, chain);
export const isSupportedProvider = (chain: string, provider: string) =>
  isSupportedChain(chain) && CHAIN_PROVIDERS[chain].includes(provider);
