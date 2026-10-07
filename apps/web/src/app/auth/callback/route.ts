import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Email confirmation link lands here with ?code=...
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}/`);
    console.error("[auth/callback] exchangeCodeForSession failed:", error.code, error.message);
  }
  return NextResponse.redirect(`${origin}/login?error=confirm`);
}
