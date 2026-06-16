'use client';

/**
 * Guest checkout success landing — where Stripe redirects after a no-account
 * ticket purchase. The tickets are issued + emailed by stripe-webhook, so this
 * page just confirms and points the buyer at their inbox. Public (no auth).
 */
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import Link from 'next/link';
import { CheckCircle2, Mail } from 'lucide-react';

function SuccessBody() {
  const params = useSearchParams();
  const email = params.get('email');
  return (
    <main
      style={{ minHeight: '100dvh', background: '#02030A', color: '#FAFAF9' }}
      className="flex items-center justify-center px-6"
    >
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#0b0d16]/80 p-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#3FDCFF]/10">
          <CheckCircle2 size={36} color="#3FDCFF" />
        </div>
        <h1 className="text-2xl font-extrabold">You&apos;re going! 🎟</h1>
        <p className="mt-3 text-sm leading-relaxed text-white/70">
          Payment confirmed. Your ticket{`(s)`} {email ? 'are' : 'are'} on the way to{' '}
          {email ? <b className="text-white">{email}</b> : 'your email'} — each with its own QR for
          the door.
        </p>
        <div className="mt-5 flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/60">
          <Mail size={16} color="#3FDCFF" />
          Check your inbox (and spam) in the next minute.
        </div>
        <Link
          href="/events"
          className="mt-6 inline-flex h-12 w-full items-center justify-center rounded-xl bg-linear-to-r from-[#3FDCFF] to-[#8A40CF] font-bold text-white"
        >
          Browse more events
        </Link>
        <p className="mt-4 text-[12px] text-white/40">
          Want to manage your tickets? Create an account with this email anytime.
        </p>
      </div>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100dvh', background: '#02030A' }} />}>
      <SuccessBody />
    </Suspense>
  );
}
