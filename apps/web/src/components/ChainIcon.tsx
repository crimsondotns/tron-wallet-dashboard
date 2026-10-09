// Simplified 16px chain marks (drawn locally, no third-party hotlinks).
const ICONS: Record<string, React.ReactNode> = {
  tron: (
    <>
      <circle cx="8" cy="8" r="8" fill="#ff060a" />
      <path d="M4 4.5l8.2 1.6L7.3 12.3 4 4.5zm1.2 1.1l2.3 5.4.4-3.6-2.7-1.8zm3.4 2l-.4 3.4 3.1-3.9-2.7.5zm-2.6-2l2.6 1.7 2.4-.4-5-1.3z" fill="#fff" />
    </>
  ),
  ethereum: (
    <>
      <circle cx="8" cy="8" r="8" fill="#627eea" />
      <path d="M8 2.5l3.3 5.6L8 10 4.7 8.1 8 2.5zm0 8.2l3.3-1.9L8 13.5 4.7 8.8 8 10.7z" fill="#fff" />
    </>
  ),
  bsc: (
    <>
      <circle cx="8" cy="8" r="8" fill="#f3ba2f" />
      <path d="M8 3.6l1.5 1.5L8 6.6 6.5 5.1 8 3.6zm-2.9 2.9l1.5 1.5-1.5 1.5L3.6 8l1.5-1.5zm5.8 0L12.4 8l-1.5 1.5L9.4 8l1.5-1.5zM8 9.4l1.5 1.5L8 12.4l-1.5-1.5L8 9.4zm0-2.2L8.8 8 8 8.8 7.2 8 8 7.2z" fill="#fff" />
    </>
  ),
  polygon: (
    <>
      <circle cx="8" cy="8" r="8" fill="#8247e5" />
      <path d="M10.4 6.2a.6.6 0 00-.6 0l-1.4.8-1 .6-1.4.8a.6.6 0 01-.6 0l-1.1-.6a.6.6 0 01-.3-.5V6.1c0-.2.1-.4.3-.5l1.1-.6a.6.6 0 01.6 0l1.1.6c.2.1.3.3.3.5v.8l1-.6v-.8a.6.6 0 00-.3-.5L7.5 3.9a.6.6 0 00-.6 0L4.8 5.1a.6.6 0 00-.3.5v2.4c0 .2.1.4.3.5l2.1 1.2c.2.1.4.1.6 0l1.4-.8 1-.6 1.4-.8a.6.6 0 01.6 0l1.1.6c.2.1.3.3.3.5v1.3c0 .2-.1.4-.3.5l-1.1.6a.6.6 0 01-.6 0l-1.1-.6a.6.6 0 01-.3-.5V9l-1 .6v.8c0 .2.1.4.3.5l2.1 1.2c.2.1.4.1.6 0l2.1-1.2c.2-.1.3-.3.3-.5V8c0-.2-.1-.4-.3-.5l-2.1-1.3z" fill="#fff" />
    </>
  ),
  arbitrum: (
    <>
      <circle cx="8" cy="8" r="8" fill="#213147" />
      <path d="M8 2.8l4.5 2.6v5.2L8 13.2l-4.5-2.6V5.4L8 2.8z" fill="none" stroke="#9dcced" strokeWidth="1" />
      <path d="M8.6 5.2l2.4 6-1 .6-2.1-5.3.7-1.3zm-1.6 2l1.7 4.4-1 .6-1.4-3.7.7-1.3z" fill="#28a0f0" />
    </>
  ),
  base: (
    <>
      <circle cx="8" cy="8" r="8" fill="#0052ff" />
      <path d="M8 13a5 5 0 10-4.98-5.5H9.7v1H3.02A5 5 0 008 13z" fill="#fff" />
    </>
  ),
  solana: (
    <>
      <circle cx="8" cy="8" r="8" fill="#121212" />
      <path d="M5.4 4.6h6.6l-1.4 1.5H4zm0 6.8h6.6l-1.4-1.5H4zm-1.4-2.65h6.6l1.4-1.5H5.4z" fill="#14f195" />
    </>
  ),
  optimism: (
    <>
      <circle cx="8" cy="8" r="8" fill="#ff0420" />
      <text x="8" y="10.4" textAnchor="middle" fontSize="6.4" fontWeight="700" fill="#fff" fontFamily="Helvetica, Arial, sans-serif">OP</text>
    </>
  ),
};

export function ChainIcon({ chain, size = 16 }: { chain: string; size?: number }) {
  const icon = ICONS[chain];
  return (
    <svg className="chain-icon" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      {icon ?? <circle cx="8" cy="8" r="8" fill="#535353" />}
    </svg>
  );
}
