"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { onGo } from "@/lib/nav";

type Auth = { uid: string; email: string } | null;
const Ctx = createContext<Auth>(null);
const PUBLIC_PATHS = ["/login", "/register", "/auth", "/forgot", "/reset"];

// Replaces the old proxy.ts: the browser client keeps the session (and handles the ?code= of an
// email confirmation link); signed-out visitors are sent to /login. Protected pages render only
// once a session exists. Also carries out go() navigations from client actions.
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [state, setState] = useState<{ ready: boolean; auth: Auth }>({ ready: false, auth: null });

  useEffect(() => {
    const supabase = createClient();
    const set = (s: { user: { id: string; email?: string } } | null) =>
      setState({ ready: true, auth: s ? { uid: s.user.id, email: s.user.email ?? "" } : null });
    void supabase.auth.getSession().then(({ data }) => set(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => set(s));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => onGo((url) => router.push(url)), [router]);

  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p));
  useEffect(() => {
    if (state.ready && !state.auth && !isPublic) router.replace("/login/");
  }, [state, isPublic, router]);

  if (!state.ready || (!state.auth && !isPublic)) return null;
  return <Ctx.Provider value={state.auth}>{children}</Ctx.Provider>;
}

// Signed-in user (null on the public auth pages when signed out).
export const useAuth = () => useContext(Ctx);
