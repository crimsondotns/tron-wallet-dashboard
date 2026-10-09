"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useDataVersion } from "@/lib/nav";
import { reportError } from "@/lib/sync/log";

// Static-export stand-in for an async server component: `build` queries Supabase in the browser
// and returns the page's JSX. Re-runs when `deps` change or after refreshData(); the previous
// view stays on screen meanwhile, `fallback` shows only on first load.
export function PageLoader({ build, deps, fallback }: { build: () => Promise<ReactNode>; deps: unknown[]; fallback: ReactNode }) {
  const version = useDataVersion();
  const [view, setView] = useState<ReactNode>(null);
  useEffect(() => {
    let live = true;
    build().then((v) => { if (live) setView(v); }, (e) => { reportError("page: load failed", e); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `build` is recreated each render; deps carry its inputs
  }, [version, ...deps]);
  return <>{view ?? fallback}</>;
}
