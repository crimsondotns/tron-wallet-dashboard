// Base58 + associated token account (ATA) derivation, so token history can be found on
// keyless RPCs that block getTokenAccountsByOwner. Pure JS (BigInt + WebCrypto SHA-256).
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EHFLe1KeHZsGJPHbXZBC5o";
const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

export function base58Decode(s: string): Uint8Array {
  let n = BigInt(0);
  for (const c of s) {
    const i = ALPHABET.indexOf(c);
    if (i < 0) throw new Error("bad base58");
    n = n * BigInt(58) + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > BigInt(0)) { bytes.unshift(Number(n % BigInt(256))); n /= BigInt(256); }
  for (const c of s) { if (c !== "1") break; bytes.unshift(0); }
  return Uint8Array.from(bytes);
}

export function base58Encode(b: Uint8Array): string {
  let n = BigInt(0);
  for (const x of b) n = n * BigInt(256) + BigInt(x);
  let out = "";
  while (n > BigInt(0)) { out = ALPHABET[Number(n % BigInt(58))] + out; n /= BigInt(58); }
  for (const x of b) { if (x !== 0) break; out = "1" + out; }
  return out;
}

// A valid wallet address decodes to exactly 32 bytes.
export function isSolanaAddress(s: string): boolean {
  if (!SOLANA_ADDRESS_RE.test(s)) return false;
  try { return base58Decode(s).length === 32; } catch { return false; }
}

// ed25519: is this 32-byte string the compressed form of a curve point? (PDAs must not be.)
const P = (BigInt(1) << BigInt(255)) - BigInt(19);
const mod = (a: bigint) => ((a % P) + P) % P;
function pow(b: bigint, e: bigint): bigint {
  let r = BigInt(1);
  b = mod(b);
  while (e > BigInt(0)) {
    if (e & BigInt(1)) r = mod(r * b);
    b = mod(b * b);
    e >>= BigInt(1);
  }
  return r;
}
const D = mod(BigInt(-121665) * pow(BigInt(121666), P - BigInt(2)));
function onCurve(b: Uint8Array): boolean {
  let y = BigInt(0);
  for (let i = 31; i >= 0; i--) y = (y << BigInt(8)) | BigInt(b[i]);
  y &= (BigInt(1) << BigInt(255)) - BigInt(1);
  if (y >= P) return false;
  const y2 = mod(y * y);
  const u = mod(y2 - BigInt(1)), v = mod(D * y2 + BigInt(1));
  const x2 = mod(u * pow(v, P - BigInt(2)));
  if (x2 === BigInt(0)) return true;
  return pow(x2, (P - BigInt(1)) / BigInt(2)) === BigInt(1);
}

async function sha256(parts: Uint8Array[]): Promise<Uint8Array> {
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  return new Uint8Array(await crypto.subtle.digest("SHA-256", all));
}

// findProgramAddress([owner, tokenProgram, mint], ATA program)
export async function associatedTokenAddress(owner: string, mint: string, tokenProgram = TOKEN_PROGRAM): Promise<string> {
  const seeds = [base58Decode(owner), base58Decode(tokenProgram), base58Decode(mint)];
  const tail = [base58Decode(ATA_PROGRAM), new TextEncoder().encode("ProgramDerivedAddress")];
  for (let bump = 255; bump >= 0; bump--) {
    const h = await sha256([...seeds, Uint8Array.of(bump), ...tail]);
    if (!onCurve(h)) return base58Encode(h);
  }
  throw new Error("no ATA bump");
}
