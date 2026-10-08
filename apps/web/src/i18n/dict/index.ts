import type { Locale } from "../config";
import { en } from "./en";
import { ja } from "./ja";
import { th, type Dict } from "./th";
import { zh } from "./zh";

export type { Dict };
export const DICTS: Record<Locale, Dict> = { th, en, zh, ja };
