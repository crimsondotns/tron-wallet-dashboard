import { fmt } from "@/i18n/config";
import { explorerLink } from "@/lib/explorer";

// Small ↗ icon link that opens an address or transaction on the chain's block explorer.
export function ExplorerLink({ chain, kind, value, label }: { chain: string; kind: "address" | "tx"; value: string; label: string }) {
  const link = explorerLink(chain, kind, value);
  if (!link) return null;
  const text = fmt(label, { name: link.name });
  return (
    <a className="explorer-link" href={link.url} target="_blank" rel="noopener noreferrer" title={text} aria-label={text}>
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path d="M6.5 3.5H4A1.5 1.5 0 002.5 5v7A1.5 1.5 0 004 13.5h7a1.5 1.5 0 001.5-1.5V9.5M9 2.5h4.5V7M13.5 2.5L7 9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </a>
  );
}
