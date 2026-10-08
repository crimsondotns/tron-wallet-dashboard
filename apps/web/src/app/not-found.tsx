import Link from "next/link";
import { getT } from "@/i18n/server";

export default async function NotFound() {
  const { t } = await getT();
  return (
    <main className="state-page state-page-center">
      <h1>{t.common.notFoundTitle}</h1>
      <p className="subdued">{t.common.notFoundBody}</p>
      <Link className="btn-primary" href="/">{t.common.goHome}</Link>
    </main>
  );
}
