import { View, Text, Pressable, Linking } from 'react-native';
import { Link } from 'expo-router';

interface HeaderProps {
  title?: string;
  subtitle?: string;
  showNav?: boolean;
}

export function Header({ title = "Universal React Monorepo", subtitle, showNav = false }: HeaderProps) {
  return (
    <View className="px-6 py-4 border-b border-gray-200 bg-white">
      <View className="flex-row items-center justify-between">
        <Text className="text-lg font-semibold text-gray-900">{title}</Text>

        {showNav && (
          <View className="flex-row items-center gap-4">
            <Link href="/(tabs)/demo" asChild>
              <Pressable>
                <Text className="text-sm text-gray-600">Components</Text>
              </Pressable>
            </Link>
            <Pressable onPress={() => Linking.openURL("https://github.com/gurselcakar/universal-react-monorepo")}>
              <Text className="text-sm text-gray-600">GitHub</Text>
            </Pressable>
          </View>
        )}
      </View>

      {subtitle && (
        <Text className="text-sm text-gray-500 mt-1">{subtitle}</Text>
      )}
    </View>
  );
}
