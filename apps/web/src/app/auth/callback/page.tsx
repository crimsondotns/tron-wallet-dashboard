"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { reportError } from "@/lib/sync/log";

// Email confirmation link lands here with ?code=...; the browser client exchanges it on load
// (detectSessionInUrl). Then home, or the login page with an error if the exchange failed
// (e.g. the link was opened in a different browser than the one that signed up).
export default function AuthCallback() {
  const router = useRouter();
  useEffect(() => {
    void createClient().auth.getSession().then(({ data, error }) => {
      if (error) reportError("auth: confirmation link exchange failed", error);
      router.replace(data.session ? "/" : "/login/?error=confirm");
    });
  }, [router]);
  return null;
}
