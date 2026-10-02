"use client";

import type { AdmissionVerdict } from "@dvnt/app/lib/auth/verified-admission";
import { useStartVerification } from "@dvnt/app/lib/hooks/use-age-verification";
import { handleSignOut } from "@dvnt/app/lib/auth-client";

export function AdultPlatformGate({ verdict }: { verdict: AdmissionVerdict }) {
  const start = useStartVerification();
  const underage = verdict.reason === "underage";

  const verify = async () => {
    const result = await start.mutateAsync({
      returnUrl: typeof window !== "undefined" ? window.location.href : undefined,
    });
    if (result.url) window.location.assign(result.url);
  };

  return (
    <main className="min-h-dvh bg-black px-6 text-white grid place-items-center">
      <section className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0c0d12] p-6 shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#3FDCFF]">
          DVNT access
        </p>
        <h1 className="mt-3 text-3xl font-extrabold">
          {underage ? "DVNT is 18+" : "Verify your age to enter DVNT"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-white/65">
          {underage
            ? "This account cannot access DVNT because the verified date of birth is under 18."
            : verdict.message ||
              "DVNT is an adults-only community. Complete the ID check before entering the platform."}
        </p>

        {start.isError ? (
          <p className="mt-4 text-sm text-rose-400">
            {(start.error as Error)?.message || "Couldn't start verification."}
          </p>
        ) : null}

        <div className="mt-6 grid gap-3">
          {!underage ? (
            <button
              type="button"
              onClick={verify}
              disabled={start.isPending}
              className="min-h-12 rounded-xl bg-[#3EA4E5] px-4 font-semibold disabled:opacity-60"
            >
              {start.isPending ? "Starting…" : "Verify with ID"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void handleSignOut("USER_REQUESTED")}
            className="min-h-11 rounded-xl bg-white/5 px-4 font-semibold text-white/70"
          >
            Sign out
          </button>
        </div>
      </section>
    </main>
  );
}
