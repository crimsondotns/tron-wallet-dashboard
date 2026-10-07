import { AppShell } from "@/components/AppShell";
import { ChainIcon } from "@/components/ChainIcon";
import { ConfirmButton } from "@/components/ConfirmDialog";
import { Dropdown } from "@/components/Dropdown";
import { createClient } from "@/lib/supabase/server";
import { addWallet, deleteWallet } from "./actions";

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const short = (a: string) => (a.length > 16 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const email = claims?.claims.email as string | undefined;
  const since = daysAgo(30);

  const [{ data: orgs }, { data: chains }, { data: wallets }, { data: cursors }, { data: flows }] = await Promise.all([
    supabase.from("orgs").select("id").order("created_at"),
    supabase.from("chains").select("id, name, family").order("family", { ascending: false }).order("name"),
    supabase.from("wallets").select("id, chain_id, address, label").order("created_at"),
    supabase.from("sync_cursors").select("wallet_id, done"),
    supabase.from("daily_flows").select("wallet_id, token_symbol, amount_in, amount_out").gte("day", since),
  ]);
  const org = orgs?.[0];
  const chainName = (id: string) => chains?.find((c) => c.id === id)?.name ?? id;

  // 30-day totals per wallet, per token.
  const totals = new Map<string, Map<string, { in: number; out: number }>>();
  flows?.forEach((f) => {
    const byToken = totals.get(f.wallet_id) ?? new Map();
    const t = byToken.get(f.token_symbol) ?? { in: 0, out: 0 };
    t.in += Number(f.amount_in);
    t.out += Number(f.amount_out);
    byToken.set(f.token_symbol, t);
    totals.set(f.wallet_id, byToken);
  });
  const status = (walletId: string) => {
    const mine = cursors?.filter((c) => c.wallet_id === walletId) ?? [];
    if (!mine.length) return <span className="status">รอดึงข้อมูล</span>;
    if (mine.every((c) => c.done)) return <span className="status">ประวัติครบแล้ว</span>;
    return <span className="status"><span className="bar bar-busy"><b /></span>กำลังดึงประวัติ</span>;
  };
  const chainCount = new Set(wallets?.map((w) => w.chain_id)).size;

  return (
    <AppShell email={email} active="Wallets">
      <div className="page-head">
        <h1>Wallets</h1>
        {!!wallets?.length && <span className="subdued small">{wallets.length} wallets · {chainCount} chains</span>}
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      {!org ? (
        <p className="error">ยังไม่พบพื้นที่ทำงานของบัญชีนี้ ลองออกจากระบบแล้วเข้าใหม่</p>
      ) : (
        <>
          <form action={addWallet} className="card row wrap">
            <input type="hidden" name="org_id" value={org.id} />
            <Dropdown
              name="chain_id"
              label="Chain"
              defaultValue="tron"
              options={(chains ?? []).map((c) => ({ value: c.id, label: c.name, icon: c.id }))}
            />
            <input className="input grow" name="address" placeholder="Address (T… หรือ 0x…)" required aria-label="Address" />
            <input className="input" name="label" placeholder="ชื่อเรียก เช่น Treasury หลัก" aria-label="ชื่อเรียก" />
            <button className="btn-primary">เพิ่ม</button>
          </form>

          <section className="card">
            {!wallets?.length ? (
              <p className="subdued">ยังไม่มี wallet ใส่ address ด้านบนเพื่อเริ่มติดตาม</p>
            ) : (
              <table>
                <thead>
                  <tr><th>ชื่อ</th><th>Chain</th><th>Address</th><th>เข้า / ออก 30 วัน</th><th>สถานะ</th><th /></tr>
                </thead>
                <tbody>
                  {wallets.map((w) => {
                    const t = [...(totals.get(w.id) ?? new Map()).entries()];
                    return (
                      <tr key={w.id}>
                        <td><strong>{w.label || <span className="placeholder">—</span>}</strong></td>
                        <td><span className="chain"><ChainIcon chain={w.chain_id} />{chainName(w.chain_id)}</span></td>
                        <td className="mono" title={w.address}>{short(w.address)}</td>
                        <td>
                          {!t.length ? <span className="placeholder">—</span> : t.map(([sym, v]) => (
                            <div key={sym}>+{fmt(v.in)} <span className="subdued">/ −{fmt(v.out)} {sym}</span></div>
                          ))}
                        </td>
                        <td>{status(w.id)}</td>
                        <td>
                          <ConfirmButton
                            className="btn-ghost"
                            ariaLabel={`ลบ ${w.label || w.address}`}
                            title="ลบ wallet นี้?"
                            body={<>เลิกติดตาม <strong className="in">{w.label || short(w.address)}</strong> และลบประวัติรายการทั้งหมดของ wallet นี้ ย้อนกลับไม่ได้</>}
                            confirmLabel="ลบ wallet"
                            danger
                            action={deleteWallet}
                            fields={{ id: w.id }}
                          >ลบ</ConfirmButton>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </AppShell>
  );
}
