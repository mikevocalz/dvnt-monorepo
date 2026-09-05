/**
 * Topic Pills Component
 * Horizontal scrollable topic filter pills
 */

import { ScrollView, Text, Pressable } from "react-native";
import { TOPICS, type Topic } from "../mocks/data";

interface TopicPillsProps {
  selectedTopic: Topic;
  onSelectTopic: (topic: Topic) => void;
}

export function TopicPills({ selectedTopic, onSelectTopic }: TopicPillsProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 16, gap: 10 }}
    >
      {TOPICS.map((topic) => (
        <Pressable
          key={topic}
          onPress={() => onSelectTopic(topic)}
          className={`px-5 py-2.5 rounded-full mr-2.5 ${
            selectedTopic === topic
              ? "bg-primary"
              : "bg-secondary"
          }`}
        >
          <Text
            className={`text-sm font-semibold ${
              selectedTopic === topic
                ? "text-white"
                : "text-muted-foreground"
            }`}
          >
            {topic}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
