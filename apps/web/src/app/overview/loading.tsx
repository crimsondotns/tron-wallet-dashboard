import { getT } from "@/i18n/server";
import { AppShell } from "@/components/AppShell";
import { createClient } from "@/lib/supabase/server";

// Mirrors the overview layout (title, KPI row, chart card) inside the app shell, so the sidebar stays put while loading.
export default async function Loading() {
  const { t } = await getT();
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  return (
    <AppShell email={claims?.claims.email as string | undefined} active="overview">
      <div className="state-page state-page-wide" aria-busy="true" aria-label={t.common.loading}>
        <span className="skel skel-title" />
        <div className="skel-kpis">
          {[0, 1, 2, 3].map((i) => <span key={i} className="skel skel-kpi" />)}
        </div>
        <span className="skel skel-block" />
      </div>
    </AppShell>
  );
}
