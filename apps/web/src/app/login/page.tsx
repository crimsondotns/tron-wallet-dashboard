import Link from "next/link";
import { AuthShell, Notice } from "@/components/AuthShell";
import { signIn } from "./actions";

const MESSAGES: Record<string, string> = {
  "check-email": "ส่งลิงก์ยืนยันไปที่อีเมลแล้ว กดลิงก์ในอีเมลแล้วกลับมาเข้าสู่ระบบ",
};
const ERRORS: Record<string, string> = {
  // Supabase confirms the email before redirecting here, so a failed auto sign-in
  // (e.g. link opened in another browser) usually still leaves the account usable.
  confirm: "ยืนยันอีเมลแล้ว แต่เข้าสู่ระบบอัตโนมัติไม่สำเร็จ (มักเกิดจากเปิดลิงก์คนละ browser กับที่สมัคร) เข้าสู่ระบบด้วยอีเมลและรหัสผ่านได้เลย",
  "Invalid login credentials": "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
  "Email not confirmed": "ยังไม่ได้ยืนยันอีเมล กดลิงก์ที่ส่งไปในอีเมลก่อน",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; message?: string }> }) {
  const { error, message } = await searchParams;
  return (
    <AuthShell mode="login">
      <div className="stack-sm">
        <h1>เข้าสู่ระบบ</h1>
        <p className="subdued small">ยังไม่มีบัญชี? <Link className="link" href="/register">สมัครสมาชิก</Link></p>
      </div>
      <Notice error={error && (ERRORS[error] ?? error)} message={message && MESSAGES[message]} />
      <form action={signIn} className="stack">
        <label className="field">
          <span>อีเมล</span>
          <input className="input" name="email" type="email" required autoComplete="email" placeholder="you@company.com" />
        </label>
        <label className="field">
          <span>รหัสผ่าน</span>
          <input className="input" name="password" type="password" required minLength={6} autoComplete="current-password" />
        </label>
        <button className="btn-primary">เข้าสู่ระบบ</button>
      </form>
    </AuthShell>
  );
}
