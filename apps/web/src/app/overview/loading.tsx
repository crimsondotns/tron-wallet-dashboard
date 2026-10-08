import { getT } from "@/i18n/server";

// Mirrors the overview layout: title, KPI row, chart card.
export default async function Loading() {
  const { t } = await getT();
  return (
    <main className="state-page state-page-wide" aria-busy="true" aria-label={t.common.loading}>
      <span className="skel skel-title" />
      <div className="skel-kpis">
        {[0, 1, 2, 3].map((i) => <span key={i} className="skel skel-kpi" />)}
      </div>
      <span className="skel skel-block" />
    </main>
  );
}
