// Shared by the server page and the client filters (constants can't cross a "use client" boundary).
export const RANGES = ["7", "30", "90", "all"] as const;
export type Range = (typeof RANGES)[number];
