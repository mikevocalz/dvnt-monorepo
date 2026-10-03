/**
 * Claim a phone comp: the screen behind the link a host texted,
 *
 *     https://dvntapp.live/ticket/claim/<token>
 *
 * Protected route. A signed-out recipient is sent through login by the deep
 * link engine (the link is held as pending and replayed after sign-in).
 *
 * Claiming is a button, not an automatic action on open: the link works once
 * and binds to whichever account is signed in, so the person sees which
 * account that is before it happens.
 */
import React, { useCallback } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { Ticket as TicketIcon, AlertCircle, X } from "lucide-react-native";
import { claimCompTicket } from "@dvnt/app/lib/api/comp-claim";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { claimTokenFromParam } from "@dvnt/app/lib/tickets/comp-claim-message";

const ACCENT = "#3FDCFF";

export default function ClaimCompTicketScreen() {
  const { token: param } = useLocalSearchParams<{ token: string }>();
  const token = claimTokenFromParam(param);
  const router = useRouter();
  const username = useAuthStore((s) => s.user?.username);

  const claim = useMutation({
    mutationFn: () => claimCompTicket(token!),
    onSuccess: (outcome) => {
      if (outcome.ok) router.replace(`/(protected)/ticket/${outcome.data.ticket_id}`);
    },
  });

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }, [router]);

  const refusal = !token
    ? "This link is incomplete. Open it again from the text you got."
    : claim.data && !claim.data.ok
      ? claim.data.message
      : claim.isError
        ? "Could not reach DVNT. Check your connection and try again."
        : null;
  const pending = claim.isPending || (claim.data?.ok ?? false);
  // Network trouble, a 5xx or the rate limit can pass. An expired or taken
  // link cannot, so those get no retry button.
  const retryable =
    !!claim.data && !claim.data.ok &&
    (claim.data.status === null || claim.data.status === 429 || claim.data.status >= 500);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: "#0a0a0a" }}
      contentContainerStyle={{ padding: 24, paddingTop: 56, gap: 20, flexGrow: 1 }}
    >
      <Pressable
        onPress={close}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={{ alignSelf: "flex-end" }}
      >
        <X size={22} color="#fff" />
      </Pressable>

      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: "rgba(63,220,255,0.14)",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {refusal ? (
          <AlertCircle size={26} color="#F59E0B" />
        ) : (
          <TicketIcon size={26} color={ACCENT} />
        )}
      </View>

      <View style={{ gap: 8 }}>
        <Text style={{ color: "#fff", fontSize: 26, fontWeight: "700", letterSpacing: -0.4 }}>
          {refusal ? "This ticket can't be claimed" : "Someone comped you a ticket"}
        </Text>
        <Text selectable style={{ color: "rgba(255,255,255,0.6)", fontSize: 15, lineHeight: 22 }}>
          {refusal ??
            "Claiming puts it in your wallet with a QR code for the door. The link works once, so it can't be claimed again from another account."}
        </Text>
      </View>

      {!refusal && (
        <Pressable
          onPress={() => claim.mutate()}
          disabled={pending}
          accessibilityRole="button"
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            paddingVertical: 15,
            borderRadius: 999,
            borderCurve: "continuous",
            backgroundColor: ACCENT,
            opacity: pending ? 0.6 : 1,
          }}
        >
          {pending ? <ActivityIndicator color="#000" /> : null}
          <Text style={{ color: "#000", fontSize: 16, fontWeight: "700" }}>
            {username ? `Claim as @${username}` : "Claim ticket"}
          </Text>
        </Pressable>
      )}

      {retryable ? (
        <Pressable
          onPress={() => claim.mutate()}
          accessibilityRole="button"
          style={{
            paddingVertical: 15,
            borderRadius: 999,
            alignItems: "center",
            backgroundColor: "rgba(255,255,255,0.08)",
          }}
        >
          <Text style={{ color: "#fff", fontSize: 16, fontWeight: "600" }}>Try again</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}
