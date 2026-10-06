/**
 * Mobile number for a signed-in buyer whose account has none on file. Shown
 * only after a checkout function answered phone_required; the next checkout
 * sends it and the server stores it privately.
 */
import { Text, TextInput, View } from "react-native";
import { useCheckoutPhoneStore } from "@dvnt/app/lib/stores/checkout-phone-store";

export function CheckoutPhoneField() {
  const needed = useCheckoutPhoneStore((s) => s.needed);
  const phone = useCheckoutPhoneStore((s) => s.phone);
  const setPhone = useCheckoutPhoneStore((s) => s.setPhone);
  if (!needed) return null;

  return (
    <View style={{ marginTop: 12, gap: 6 }}>
      <Text
        style={{
          color: "#a1a1aa",
          fontSize: 12,
          fontFamily: "InterSemiBold",
          letterSpacing: 0.5,
          textTransform: "uppercase",
        }}
      >
        Mobile number
      </Text>
      <TextInput
        value={phone}
        onChangeText={setPhone}
        placeholder="(212) 555-0142 or +44 7700 900123"
        placeholderTextColor="#71717a"
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        autoComplete="tel"
        autoFocus
        accessibilityLabel="Mobile number"
        accessibilityHint="Needed to finish checkout. It stays private."
        style={{
          height: 44,
          borderRadius: 10,
          backgroundColor: "rgba(255,255,255,0.06)",
          borderWidth: 1,
          borderColor: phone.trim() ? "#8A40CF60" : "rgba(255,255,255,0.08)",
          paddingHorizontal: 12,
          color: "#fff",
          fontSize: 15,
          fontFamily: "InterSemiBold",
        }}
      />
      <Text style={{ color: "#71717a", fontSize: 12, lineHeight: 17 }}>
        Add a mobile number to finish checkout. It stays private and never shows on your profile.
      </Text>
    </View>
  );
}
