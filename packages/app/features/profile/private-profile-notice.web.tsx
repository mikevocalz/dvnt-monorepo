import { privateProfilePresentation } from "@dvnt/app/lib/profile/private-profile";

export function PrivateProfileNotice({ pending = false }: { pending?: boolean }) {
  const copy = privateProfilePresentation({ isPrivate: true, requestPending: pending });
  return (
    <section aria-label="Private account" className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <h2 className="text-lg font-semibold">{copy.title}</h2>
      <p className="max-w-sm text-sm text-white/65">{copy.message}</p>
    </section>
  );
}
