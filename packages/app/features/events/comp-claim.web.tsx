"use client";

/**
 * Claim a phone comp on web: the page behind the link a host texted,
 * https://dvntapp.live/ticket/claim/<token> (next.config.ts sends it here,
 * ahead of the /ticket/* to /feed/ticket/* redirect).
 *
 * A public route on purpose. The /feed shell sends signed-out visitors to the
 * landing page and the link would be lost, so this page handles both states:
 * signed out it offers login with a returnTo of this exact path; signed in it
 * offers the claim.
 *
 * Claiming is a button, not automatic: the link works once and binds to the
 * account that is signed in, so the person sees which account first.
 *
 * Law 3: raw semantic HTML + Tailwind. Server state in TanStack Query.
 */

import { useParams, usePathname, useRouter } from "solito/navigation";
import { useMutation } from "@tanstack/react-query";
import { AlertCircle, LogIn, Ticket as TicketIcon } from "lucide-react";
import { claimCompTicket } from "@dvnt/app/lib/api/comp-claim";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { loginPathWithReturn } from "@dvnt/app/lib/auth/return-to";
import { claimTokenFromParam } from "@dvnt/app/lib/tickets/comp-claim-message";

export function CompClaimScreen() {
  const params = useParams<{ token: string }>();
  const token = claimTokenFromParam(params?.token);
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const hydrated = useAuthStore((s) => s._hasHydrated);
  const signedIn = useAuthStore((s) => s.isAuthenticated);
  const username = useAuthStore((s) => s.user?.username);

  const claim = useMutation({
    mutationFn: () => claimCompTicket(token!),
    onSuccess: (outcome) => {
      if (outcome.ok) router.replace(`/feed/ticket/${outcome.data.ticket_id}`);
    },
  });

  const refusal = !token
    ? "This link is incomplete. Open it again from the text you got."
    : claim.data && !claim.data.ok
      ? claim.data.message
      : null;
  const retryable =
    !!claim.data && !claim.data.ok &&
    (claim.data.status === null || claim.data.status === 429 || claim.data.status >= 500);
  const pending = claim.isPending || (claim.data?.ok ?? false);

  return (
    <main className="mx-auto flex min-h-[70dvh] w-full max-w-md flex-col justify-center gap-6 px-6 py-16">
      <span
        className="flex h-14 w-14 items-center justify-center rounded-full"
        style={{ background: refusal ? "rgba(245,158,11,0.14)" : "rgba(63,220,255,0.14)" }}
      >
        {refusal ? <AlertCircle size={26} color="#F59E0B" /> : <TicketIcon size={26} color="#3FDCFF" />}
      </span>

      <div className="space-y-2">
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-white">
          {refusal ? "This ticket can't be claimed" : "Someone comped you a ticket"}
        </h1>
        <p className="text-[15px] leading-relaxed text-white/60">
          {refusal ??
            (signedIn
              ? "Claiming puts it in your wallet with a QR code for the door. The link works once, so it can't be claimed again from another account."
              : "Sign in to claim it. New to DVNT? Create an account, then open this link again from your messages.")}
        </p>
      </div>

      {!refusal && hydrated && !signedIn ? (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => router.push(loginPathWithReturn(pathname))}
            className="flex items-center justify-center gap-2 rounded-full bg-[#3FDCFF] px-5 py-3.5 text-[16px] font-bold text-black active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <LogIn size={18} /> Sign in to claim
          </button>
          <button
            type="button"
            onClick={() => router.push("/auth/signup")}
            className="rounded-full bg-white/8 px-5 py-3.5 text-[16px] font-semibold text-white hover:bg-white/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
          >
            Create an account
          </button>
        </div>
      ) : null}

      {!refusal && signedIn ? (
        <button
          type="button"
          onClick={() => claim.mutate()}
          disabled={pending}
          className="flex items-center justify-center gap-2 rounded-full bg-[#3FDCFF] px-5 py-3.5 text-[16px] font-bold text-black disabled:opacity-60 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        >
          {pending ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/20 border-t-black" />
          ) : null}
          {username ? `Claim as @${username}` : "Claim ticket"}
        </button>
      ) : null}

      {retryable ? (
        <button
          type="button"
          onClick={() => claim.mutate()}
          className="rounded-full bg-white/8 px-5 py-3.5 text-[16px] font-semibold text-white hover:bg-white/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60"
        >
          Try again
        </button>
      ) : null}
    </main>
  );
}
