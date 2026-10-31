"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "solito/navigation";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { getSession } from "@dvnt/app/lib/auth-client";
import { authPathWithReturn, readReturnToFromUrl } from "@dvnt/app/lib/auth/return-to";
import { hasSignupContinuation, clearSignupContinuation } from "@dvnt/app/lib/auth/signup-continuation";

/** Decide once at entry, before mounting signup. Becoming authenticated during
 * account creation must not interrupt the existing ID/email verification flow. */
export function SignupEntry({ children }: { children: React.ReactNode }) {
  const hydrated = useAuthStore(s => s._hasHydrated);
  const router = useRouter();
  const decided = useRef(false);
  const [state, setState] = useState<"checking" | "guest" | "redirecting" | "error">("checking");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!hydrated || decided.current) return;
    let active = true;
    setState("checking");
    void getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) { setState("error"); return; }
      if (data?.session && data?.user) {
        if (!data.user.emailVerified && hasSignupContinuation(data.user.id)) {
          // ID approval removes this marker before the email step. On refresh,
          // resume that step instead of remounting the initial signup form.
          const pendingIdentity = window.sessionStorage.getItem("dvnt:signup:verification") === "pending";
          decided.current = true;
          if (pendingIdentity) setState("guest");
          else {
            setState("redirecting");
            router.replace(authPathWithReturn("/auth/verify-email", readReturnToFromUrl("")));
          }
          return;
        }
        decided.current = true;
        setState("redirecting");
        // Already-sent Join links are direct signup URLs. Only the explicit
        // login->signup handoff keeps a Rate action's destination on auth races.
        const fromLogin = new URLSearchParams(window.location.search).get("entry") === "login";
        router.replace(fromLogin ? readReturnToFromUrl("/feed") : "/feed");
      } else { clearSignupContinuation(); decided.current = true; setState("guest"); }
    }).catch(() => { if (active) setState("error"); });
    return () => { active = false; };
  }, [hydrated, attempt, router]);
  if (!hydrated || state === "checking" || state === "redirecting") return null;
  if (state === "error") return <div role="status">Unable to check your session. <button onClick={() => setAttempt(n => n + 1)}>Try again</button></div>;
  return <>{children}</>;
}
