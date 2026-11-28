import {View,Text,Pressable} from 'react-native';
import {useRouter} from 'expo-router';
/** Deep-link parameters never prove payment or authorize another purchase. */
export default function CheckoutReplacementReturn(){
 const router=useRouter();
 return <View className="flex-1 gap-4 bg-background p-6"><Text className="text-foreground text-xl font-bold" accessibilityRole="header">Confirming your order</Text><Text className="text-foreground">Your payment and order still need to be verified. Please do not pay again. Check My Tickets or the original email address used for your order. Contact support if it has not appeared.</Text><Pressable className="rounded-xl bg-card p-4" accessibilityRole="button" onPress={()=>router.replace('/(protected)/events/my-tickets' as never)}><Text className="text-foreground">Check My Tickets</Text></Pressable></View>;
}
