"use client";

import Link from "next/link";
import { useT } from "@/i18n/client";

export default function NotFound() {
  const t = useT();
  return (
    <main className="state-page state-page-center">
      <h1>{t.common.notFoundTitle}</h1>
      <p className="subdued">{t.common.notFoundBody}</p>
      <Link className="btn-primary" href="/">{t.common.goHome}</Link>
    </main>
  );
}
