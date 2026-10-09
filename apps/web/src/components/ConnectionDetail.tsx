"use client";

import { useState } from "react";
import { saveConnection } from "@/app/connections/actions";
import { createClient } from "@/lib/supabase/client";
import { useLocale, useT, useTimeZone } from "@/i18n/client";
import { diagnose, reportText, stepDefs, type Report, type Step } from "@/lib/sync/diagnose";
import { PROVIDERS } from "@/lib/sync/engine";
import { ApiKeyField } from "./ApiKeyField";
import { OtpDialog } from "./OtpDialog";
import { Dropdown } from "./Dropdown";
import { TestResults } from "./TestResults";
import { toast } from "./Toaster";

export type ProviderOption = { value: string; label: string; keyHint: string; endpointHint: string };
type Saved = { provider: string; endpoint: string | null; hasKey: boolean } | null;

// Right-hand panel of the Connections page: settings for one chain, and an in-place test
// that uses whatever is currently typed (saved or not).
export function ConnectionDetail({ chain, email, options, saved, wallets, sampleAddress }: {
  chain: string; email: string; options: ProviderOption[]; saved: Saved;
  wallets: { address: string; label: string }[]; sampleAddress: string;
}) {
  const t = useT();
  const locale = useLocale();
  const tz = useTimeZone();
  const [provider, setProvider] = useState(saved?.provider ?? options[0].value);
  const [endpoint, setEndpoint] = useState(saved?.endpoint ?? "");
  const [apiKey, setApiKey] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [address, setAddress] = useState(wallets[0]?.address ?? sampleAddress);
  const [report, setReport] = useState<Report | null>(null);
  const [running, setRunning] = useState(false);
  const [otp, setOtp] = useState(false);
  const opt = options.find((o) => o.value === provider) ?? options[0];
  const p = PROVIDERS[provider];
  const useSavedKey = !apiKey && !!saved?.hasKey && saved.provider === provider;
  const steps: Step[] = report?.steps ?? stepDefs(t).map((s) => ({ ...s, status: "pending" as const }));
  const dirty = provider !== (saved?.provider ?? options[0].value) || endpoint !== (saved?.endpoint ?? "") || !!apiKey;

  const test = async () => {
    setRunning(true); setReport(null);
    try {
      let key: string | null = apiKey.trim() || null;
      if (!key && useSavedKey) {
        const { data, error } = await createClient().rpc("my_provider_key", { p_chain: chain });
        // Saved key needs an admin with a recent email OTP; ask for the code, then test again.
        if (error?.code === "P0401") { setOtp(true); return; }
        if (error) { toast(error.code === "42501" ? t.key.adminOnly : t.common.errGeneric); return; }
        key = data?.[0]?.api_key ?? null;
      }
      await diagnose(p, { apiKey: key, endpoint: endpoint.trim() || null, chain }, address.trim(), setReport, { t, locale, tz });
    } finally {
      setRunning(false);
    }
  };
  const copy = async () => {
    if (!report) return;
    await navigator.clipboard.writeText(reportText(report, { provider: p.label, endpoint: endpoint || p.defaultEndpointFor?.(chain) || p.defaultEndpoint, address, hasKey: !!apiKey || useSavedKey }, t, locale));
    toast(t.common.copied);
  };

  return (
    <>
      <form action={saveConnection} className="detail-form" id={`conn-${chain}`}>
        <input type="hidden" name="chain_id" value={chain} />
        <div className="detail-grid">
          <div className="field">
            <span>{t.conn.provider}</span>
            <Dropdown name="provider" label={t.conn.provider} defaultValue={provider} options={options.map(({ value, label }) => ({ value, label }))} onChange={setProvider} />
          </div>
          <label className="field">
            <span>{t.conn.endpoint}</span>
            <input className="input" name="endpoint_url" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} inputMode="url" spellCheck={false} autoComplete="off" placeholder={opt.endpointHint} />
          </label>
        </div>
      </form>

      <div className="field">
          <span>{t.conn.apiKey}</span>
          {saved?.hasKey && !replacing ? (
            <>
              <ApiKeyField chain={chain} email={email} />
              <button type="button" className="btn-ghost detail-inline" onClick={() => setReplacing(true)}>{t.conn.changeKey}</button>
            </>
          ) : (
            <input className="input" name="api_key" form={`conn-${chain}`} type="password" autoComplete="off" spellCheck={false} value={apiKey} onChange={(e) => setApiKey(e.target.value)}
              placeholder={saved?.hasKey ? t.conn.newKeyPh : opt.keyHint} autoFocus={replacing} />
          )}
      </div>

      <div className="detail-test">
        <div className="field">
          <span>{t.conn.testAddress}</span>
          <input className="input mono" value={address} onChange={(e) => setAddress(e.target.value)} spellCheck={false} aria-label={t.conn.testAddress} placeholder={t.conn.testAddressPh} />
        </div>
        <div className="detail-actions">
          {dirty && <span className="caption subdued">{t.conn.unsaved}</span>}
          <button type="button" className="btn-tertiary" onClick={test} disabled={running}>{running ? t.conn.testing : report ? t.conn.retest : t.conn.test}</button>
          <button type="submit" form={`conn-${chain}`} className="btn-primary">{t.common.save}</button>
        </div>
      </div>

      <OtpDialog open={otp} email={email} onClose={() => setOtp(false)} onVerified={() => { setOtp(false); test(); }} />
      <TestResults report={report} steps={steps} running={running} address={address} command={`${chain} --provider ${provider}`}
        actions={<div className="row wrap"><button type="button" className="btn-tertiary" onClick={copy}>{t.conn.copyReport}</button></div>} />
    </>
  );
}
