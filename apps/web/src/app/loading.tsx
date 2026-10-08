import { getT } from "@/i18n/server";

export default async function Loading() {
  const { t } = await getT();
  return (
    <main className="state-page" aria-busy="true" aria-label={t.common.loading}>
      <span className="skel skel-title" />
      <span className="skel skel-line" />
      <span className="skel skel-line short" />
    </main>
  );
}
