"use client";

import { useSyncExternalStore } from "react";

// Client-side stand-ins for server-action redirect() and revalidatePath(): actions call go(url)
// to navigate (NavBridge does the router.push) and refreshData() so pages reload their queries.
const NAV_EVENT = "xcap:nav";
const DATA_EVENT = "xcap:data";
let version = 0;

export function go(url: string) {
  window.dispatchEvent(new CustomEvent<string>(NAV_EVENT, { detail: url }));
}
export function onGo(fn: (url: string) => void) {
  const h = (e: Event) => fn((e as CustomEvent<string>).detail);
  window.addEventListener(NAV_EVENT, h);
  return () => window.removeEventListener(NAV_EVENT, h);
}

export function refreshData() {
  version++;
  window.dispatchEvent(new Event(DATA_EVENT));
}
const subscribe = (cb: () => void) => {
  window.addEventListener(DATA_EVENT, cb);
  return () => window.removeEventListener(DATA_EVENT, cb);
};
// Bumps whenever refreshData() runs; put it in a page's data-loading effect deps.
export const useDataVersion = () => useSyncExternalStore(subscribe, () => version, () => 0);
