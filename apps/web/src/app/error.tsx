"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";
import { useT } from "@/i18n/client";

// Never show error.message: server errors are opaque digests and may carry internals.
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useT();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="state-page" role="alert">
      <h1>{t.common.errTitle}</h1>
      <p className="subdued">{t.common.errGeneric}</p>
      <button type="button" className="btn-primary" onClick={() => retry()}>{t.common.retry}</button>
    </main>
  );
}
