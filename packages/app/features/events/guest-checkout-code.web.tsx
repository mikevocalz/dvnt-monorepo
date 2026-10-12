"use client";
import { View, Text } from "react-native";
import { Section, P } from "@dvnt/app/components/ui/html";
import { Input } from "@dvnt/app/components/ui/input";
import { Button } from "@dvnt/app/components/ui/button";
import { useGuestCheckoutStore } from "@dvnt/app/lib/stores/guest-checkout-store";
import { guestQuoteSelectionKey, normalizeGuestCode } from "@dvnt/app/lib/tickets/guest-checkout-quote";

export function GuestCheckoutCode() {
  const s = useGuestCheckoutStore();
  const quote = s.quoteSelectionKey === guestQuoteSelectionKey(s) ? s.quote : null;
  const dirty = normalizeGuestCode(s.codeDraft) !== s.discountCode;
  const text = { color: "#a7a7ae", fontSize: 13, lineHeight: 19 };
  const clearCodes = () => s.patch({ codeDraft: "", discountCode: "", trackedPromoterCode: "",
    quote: null, quoteError: null, quoteRevision: s.quoteRevision + 1 });
  return <Section style={{ gap: 10 }}>
    <Input label="Promo code" accessibilityLabel="Promo or promoter code"
      value={s.codeDraft} placeholder="Enter promo or promoter code"
      autoCapitalize="characters" autoCorrect={false} maxLength={64} editable={!s.loading}
      onChangeText={codeDraft => s.patch({ codeDraft })} />
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      <Button variant="outline" disabled={s.loading || !s.codeDraft.trim()}
        onPress={() => s.patch({ discountCode: normalizeGuestCode(s.codeDraft), quote: null,
          quoteError: null, quoteRevision: s.quoteRevision + 1 })}>Apply code</Button>
      {s.codeDraft || s.discountCode || s.trackedPromoterCode ?
        <Button variant="outline" disabled={s.loading} onPress={clearCodes}>Remove codes</Button> : null}
    </View>
    {s.quoteLoading ? <P style={text} accessibilityLiveRegion="polite">Checking ticket total…</P> : null}
    {dirty ? <P style={text}>Apply or remove the entered code before paying.</P> : null}
    {quote && !dirty && (quote.promo_code || quote.promoter_code) ?
      <Text accessibilityLiveRegion="polite" style={{ color: "#3FDCFF", fontSize: 13 }}>
        {[quote.promo_code, quote.promoter_code].filter(Boolean).join(" + ")} applied
        {quote.discount_cents > 0 ? ` — save $${(quote.discount_cents / 100).toFixed(2)}` : ""}
      </Text> : null}
    {s.quoteError ? <View style={{ gap: 8 }}>
      <Text accessibilityRole="alert" style={{ color: "#FC253A", fontSize: 13 }}>{s.quoteError}</Text>
      <Button variant="outline" disabled={s.loading}
        onPress={() => s.patch({ quoteRevision: s.quoteRevision + 1 })}>Retry total</Button>
    </View> : null}
    {quote ? <View style={{ gap: 6 }}>
      <P style={text}>Tickets: ${(quote.subtotal_cents / 100).toFixed(2)}</P>
      {quote.discount_cents > 0 ? <P style={text}>Discount: −${(quote.discount_cents / 100).toFixed(2)}</P> : null}
      <P style={text}>Service fee: ${(quote.buyer_fee_cents / 100).toFixed(2)}</P>
    </View> : null}
  </Section>;
}
