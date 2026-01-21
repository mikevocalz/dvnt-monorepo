import { Text, View, ScrollView, Pressable, Linking } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link } from "expo-router";
import { Header } from "../../../components";

const technologies = [
  {
    name: "Turborepo",
    description: "High-performance build system with intelligent caching",
    image: require("../../../../assets/images/turborepo-dark.svg"),
  },
  {
    name: "Next.js 16",
    description: "React framework with App Router for the web",
    image: require("../../../../assets/images/next.svg"),
  },
  {
    name: "Expo SDK 54",
    description: "React Native framework with Expo Router",
    image: require("../../../../assets/images/expo-wordmark.png"),
  },
  {
    name: "Uniwind",
    description: "Tailwind 4 for React Native",
    image: require("../../../../assets/images/react-logo.png"),
  },
];

export default function Home() {
  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'left', 'right']}>
      <Header showNav />

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
      >
        {/* Hero Section */}
        <View className="px-6 py-12 items-center">
          <Text className="text-4xl font-bold text-gray-900 tracking-tight mb-4 text-center">
            Build once, run everywhere
          </Text>
          <Text className="text-lg text-gray-600 leading-relaxed text-center mb-8">
            A production-ready monorepo template for building cross-platform applications with shared components between React Native and Next.js.
          </Text>

          <View className="flex-row flex-wrap gap-3 justify-center">
            <Pressable
              className="px-5 py-2.5 bg-gray-900 rounded-md active:opacity-80"
              onPress={() => Linking.openURL("https://github.com/gurselcakar/universal-react-monorepo")}
            >
              <Text className="text-white text-sm font-medium">Star on GitHub</Text>
            </Pressable>
            <Pressable
              className="px-5 py-2.5 border border-gray-300 rounded-md active:opacity-80"
              onPress={() => Linking.openURL("https://gurselcakar.com/monorepo")}
            >
              <Text className="text-gray-700 text-sm font-medium">Read Blog Post</Text>
            </Pressable>
            <Link href="/(tabs)/demo" asChild>
              <Pressable className="px-5 py-2.5 active:opacity-80">
                <Text className="text-gray-500 text-sm font-medium">View Components</Text>
              </Pressable>
            </Link>
          </View>
        </View>

        {/* Tech Stack */}
        <View className="px-6 pb-8 border-t border-gray-100 pt-8">
          <Text className="text-2xl font-semibold text-gray-900 mb-8 text-center">
            Tech Stack
          </Text>
          <View className="flex-row flex-wrap gap-6">
            {technologies.map((tech) => (
              <View key={tech.name} className="flex-row items-center gap-4 w-[45%]">
                <View className="w-16 h-16 items-center justify-center">
                  <Image
                    source={tech.image}
                    style={{ width: 64, height: 64 }}
                    contentFit="contain"
                  />
                </View>
                <View className="flex-1">
                  <Text className="font-medium text-gray-900">{tech.name}</Text>
                  <Text className="text-sm text-gray-500">{tech.description}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* Quick Start */}
        <View className="px-6 pb-8 border-t border-gray-100 pt-8">
          <Text className="text-2xl font-semibold text-gray-900 mb-8 text-center">
            Quick Start
          </Text>
          <View className="bg-gray-900 rounded-lg p-5">
            <Text className="text-gray-400 font-mono text-sm mb-2"># Clone and install</Text>
            <Text className="text-gray-100 font-mono text-sm mb-1">
              <Text className="text-gray-500">$ </Text>git clone https://github.com/gurselcakar/universal-react-monorepo.git
            </Text>
            <Text className="text-gray-100 font-mono text-sm mb-1">
              <Text className="text-gray-500">$ </Text>cd universal-react-monorepo
            </Text>
            <Text className="text-gray-100 font-mono text-sm mb-3">
              <Text className="text-gray-500">$ </Text>pnpm install
            </Text>
            <Text className="text-gray-400 font-mono text-sm mb-2"># Start development</Text>
            <Text className="text-gray-100 font-mono text-sm">
              <Text className="text-gray-500">$ </Text>pnpm dev
            </Text>
          </View>
          <Text className="text-sm text-gray-500 text-center mt-4">
            Runs both web and mobile apps simultaneously with hot reload
          </Text>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}
