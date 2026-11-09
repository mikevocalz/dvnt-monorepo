/** Verified server amounts only; never estimate fees or calculate net client-side. */
export interface PlatformFees {
  amountCents: number | null;
  currency: string | null;
  month: string;
  timeZone: "America/New_York";
  status: "ready" | "pending" | "unavailable";
  asOf?: string;
  through?: string;
  reason?: string;
}
export function platformFeePresentation(fees?: PlatformFees | null) {
  const money = (cents: number | null | undefined) => {
    if (fees?.status !== "ready" || !Number.isSafeInteger(cents) || !fees.currency || !/^[A-Z]{3}$/i.test(fees.currency)) return "—";
    try { return new Intl.NumberFormat("en-US", {style:"currency",currency:fees.currency.toUpperCase()}).format(cents! / 100); } catch { return "—"; }
  };
  const noTransactions = fees?.status === "ready" && fees.amountCents === 0 && fees.currency === null;
  const amount = money(fees?.amountCents);
  const month = fees?.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(fees.month)
    ? new Intl.DateTimeFormat("en-US", {month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(`${fees.month}-15T12:00:00Z`)) : "Current month";
  const asOfMs = fees?.asOf ? Date.parse(fees.asOf) : NaN;
  const asOf = fees?.status === "ready" && Number.isFinite(asOfMs)
    ? `Verified ${new Intl.DateTimeFormat("en-US", {month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit",timeZone:"America/New_York",timeZoneName:"short"}).format(new Date(asOfMs))}` : null;
  const throughMs = fees?.through ? Date.parse(fees.through) : NaN;
  const through = fees?.status === "ready" && Number.isFinite(throughMs)
    ? `Sales through ${new Intl.DateTimeFormat("en-US", {month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit",timeZone:"America/New_York",timeZoneName:"short"}).format(new Date(throughMs))}` : null;
  return { noTransactions, asOf, through, period: `${month} · America/New_York`, amount, unavailable: amount === "—" && !noTransactions };
}
