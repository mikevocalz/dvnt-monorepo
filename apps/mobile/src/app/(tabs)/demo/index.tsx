import { useState } from "react";
import { Text, View, Alert, ScrollView } from "react-native";
import { Button, Card, Text as UIText, Badge, Input } from "ui";
import { SafeAreaView } from "react-native-safe-area-context";
import { Header } from "../../../components";

function ComponentSection({
  title,
  importStatement,
  children,
}: {
  title: string;
  importStatement: string;
  children: React.ReactNode;
}) {
  return (
    <View className="py-6 border-b border-gray-100">
      <View className="flex-row items-center justify-between mb-4">
        <Text className="text-base font-semibold text-gray-900">{title}</Text>
        <View className="bg-gray-50 px-2 py-1 rounded">
          <Text className="text-xs text-gray-500 font-mono">{importStatement}</Text>
        </View>
      </View>
      {children}
    </View>
  );
}

export default function Demo() {
  const [inputValue, setInputValue] = useState("");

  return (
    <SafeAreaView className="flex-1 bg-white" edges={['top', 'left', 'right']}>
      <Header
        title="Shared UI Components"
        subtitle="Cross-platform components with Uniwind"
      />

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerClassName="px-6"
      >
        <Text className="text-sm text-gray-400 mt-4 mb-2">
          These same components render on web via React Native Web.
        </Text>
        <Text className="text-sm text-gray-400 mb-4">
          Add, modify, or reorganize these components however you like.
        </Text>

        <ComponentSection title="Button" importStatement="from 'ui'">
          <View className="flex-row gap-3 flex-wrap">
            <Button title="Primary" onPress={() => Alert.alert('Pressed', 'Primary button')} />
            <Button title="Secondary" variant="secondary" onPress={() => {}} />
            <Button title="Outline" variant="outline" onPress={() => {}} />
          </View>
        </ComponentSection>

        <ComponentSection title="Card" importStatement="from 'ui'">
          <View className="gap-3">
            <Card>
              <UIText variant="body">Default card with subtle border styling.</UIText>
            </Card>
            <Card variant="elevated">
              <UIText variant="body">Elevated card with shadow for emphasis.</UIText>
            </Card>
          </View>
        </ComponentSection>

        <ComponentSection title="Text" importStatement="from 'ui'">
          <View className="gap-2">
            <UIText variant="title">Title variant</UIText>
            <UIText variant="body">Body variant for regular content.</UIText>
            <UIText variant="caption">Caption variant for secondary information.</UIText>
          </View>
        </ComponentSection>

        <ComponentSection title="Badge" importStatement="from 'ui'">
          <View className="flex-row gap-3 flex-wrap">
            <Badge label="Default" />
            <Badge label="Success" variant="success" />
            <Badge label="Warning" variant="warning" />
          </View>
        </ComponentSection>

        <ComponentSection title="Input" importStatement="from 'ui'">
          <Input
            label="Email address"
            placeholder="you@example.com"
            value={inputValue}
            onChangeText={setInputValue}
          />
        </ComponentSection>

      </ScrollView>
    </SafeAreaView>
  );
}
