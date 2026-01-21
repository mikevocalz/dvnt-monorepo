import { useState } from "react";
import { Text, View, Alert, ScrollView } from "react-native";
import { Badge, Button, Card, CardBody, Input, Text as HeroText } from "ui";
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
            <Button color="primary" onPress={() => Alert.alert('Pressed', 'Primary button')}>
              Primary
            </Button>
            <Button color="secondary" variant="flat" onPress={() => {}}>
              Secondary
            </Button>
            <Button variant="bordered" onPress={() => {}}>
              Outline
            </Button>
          </View>
        </ComponentSection>

        <ComponentSection title="Card" importStatement="from 'ui'">
          <View className="gap-3">
            <Card>
              <CardBody>
                <HeroText className="text-base text-gray-700">
                  Default card with subtle border styling.
                </HeroText>
              </CardBody>
            </Card>
            <Card shadow="md">
              <CardBody>
                <HeroText className="text-base text-gray-700">
                  Elevated card with shadow for emphasis.
                </HeroText>
              </CardBody>
            </Card>
          </View>
        </ComponentSection>

        <ComponentSection title="Text" importStatement="from 'ui'">
          <View className="gap-2">
            <HeroText className="text-xl font-semibold text-gray-900">Title variant</HeroText>
            <HeroText className="text-base text-gray-700">Body variant for regular content.</HeroText>
            <HeroText className="text-sm text-gray-500">Caption variant for secondary information.</HeroText>
          </View>
        </ComponentSection>

        <ComponentSection title="Badge" importStatement="from 'ui'">
          <View className="flex-row gap-3 flex-wrap">
            <Badge content="Default" color="default">
              <Button size="sm" variant="flat">
                Inbox
              </Button>
            </Badge>
            <Badge content="Success" color="success">
              <Button size="sm" variant="flat">
                Team
              </Button>
            </Badge>
            <Badge content="Warning" color="warning">
              <Button size="sm" variant="flat">
                Alerts
              </Button>
            </Badge>
          </View>
        </ComponentSection>

        <ComponentSection title="Input" importStatement="from 'ui'">
          <Input
            label="Email address"
            placeholder="you@example.com"
            value={inputValue}
            onValueChange={setInputValue}
          />
        </ComponentSection>

      </ScrollView>
    </SafeAreaView>
  );
}
