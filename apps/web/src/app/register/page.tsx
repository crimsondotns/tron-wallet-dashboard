import Link from "next/link";
import { AuthShell, Notice } from "@/components/AuthShell";
import { signUp } from "../login/actions";

const ERRORS: Record<string, string> = {
  mismatch: "รหัสผ่านทั้งสองช่องไม่ตรงกัน",
  "User already registered": "อีเมลนี้มีบัญชีแล้ว เข้าสู่ระบบแทน",
};

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <AuthShell mode="register">
      <div className="stack-sm">
        <h1>สร้างบัญชี</h1>
        <p className="subdued small">มีบัญชีแล้ว? <Link className="link" href="/login">เข้าสู่ระบบ</Link></p>
      </div>
      <Notice error={error && (ERRORS[error] ?? error)} />
      <form action={signUp} className="stack">
        <label className="field">
          <span>อีเมล</span>
          <input className="input" name="email" type="email" required autoComplete="email" placeholder="you@company.com" />
        </label>
        <label className="field">
          <span>รหัสผ่าน</span>
          <input className="input" name="password" type="password" required minLength={8} autoComplete="new-password" placeholder="อย่างน้อย 8 ตัวอักษร" />
        </label>
        <label className="field">
          <span>ยืนยันรหัสผ่าน</span>
          <input className="input" name="confirm" type="password" required minLength={8} autoComplete="new-password" placeholder="พิมพ์รหัสผ่านอีกครั้ง" />
        </label>
        <button className="btn-primary">สร้างบัญชี</button>
        <p className="placeholder caption">หลังสมัคร เราจะส่งลิงก์ยืนยันไปที่อีเมลของคุณ</p>
      </form>
    </AuthShell>
  );
}
