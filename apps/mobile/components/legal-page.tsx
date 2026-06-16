import { useMemo, useLayoutEffect } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { Main } from "@expo/html-elements";
import { useRouter, useNavigation } from "expo-router";
import { SettingsCloseButton } from "@/components/settings-back-button";
import { ChevronDown } from "lucide-react-native";
import { useColorScheme } from "@/lib/hooks";
import { type LegalPageSlug, type FAQItem } from "@/lib/stores/legal-store";
import { useFAQStore } from "@/lib/stores/faq-store";
import { LEGAL_CONTENT } from "@/lib/constants/legal-content";

interface LegalPageProps {
  slug: LegalPageSlug;
  title: string;
}

function parseMarkdownContent(content: string) {
  const sections: Array<{
    type: "heading" | "subheading" | "paragraph" | "list";
    content: string;
    items?: string[];
  }> = [];

  const lines = content.split("\n");
  let currentParagraph = "";
  let currentList: string[] = [];

  const flushParagraph = () => {
    if (currentParagraph.trim()) {
      sections.push({ type: "paragraph", content: currentParagraph.trim() });
      currentParagraph = "";
    }
  };

  const flushList = () => {
    if (currentList.length > 0) {
      sections.push({ type: "list", content: "", items: currentList });
      currentList = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("## ")) {
      flushParagraph();
      flushList();
      sections.push({ type: "heading", content: trimmed.slice(3) });
    } else if (trimmed.startsWith("### ")) {
      flushParagraph();
      flushList();
      sections.push({ type: "subheading", content: trimmed.slice(4) });
    } else if (
      trimmed.startsWith("• ") ||
      trimmed.startsWith("* ") ||
      trimmed.startsWith("- ")
    ) {
      flushParagraph();
      currentList.push(trimmed.slice(2));
    } else if (trimmed === "") {
      flushParagraph();
      flushList();
    } else {
      if (currentList.length > 0) {
        flushList();
      }
      currentParagraph += (currentParagraph ? " " : "") + trimmed;
    }
  }

  flushParagraph();
  flushList();

  return sections;
}

function FAQSection({ faqs }: { faqs: FAQItem[] }) {
  const { colors } = useColorScheme();
  const { expandedIndex, toggleExpanded } = useFAQStore();

  const categories = [...new Set(faqs.map((f) => f.category || "General"))];

  return (
    <View>
      {categories.map((category) => (
        <View key={category} className="mb-6">
          <Text className="mb-3 text-lg font-semibold text-primary">
            {category}
          </Text>
          {faqs
            .filter((f) => (f.category || "General") === category)
            .map((faq, index) => {
              const globalIndex = faqs.indexOf(faq);
              return (
                <View
                  key={index}
                  className="mb-3 overflow-hidden rounded-xl border border-border bg-card"
                >
                  <Pressable
                    onPress={() => toggleExpanded(globalIndex)}
                    className="flex-row items-center justify-between p-4 active:bg-secondary"
                  >
                    <Text className="flex-1 pr-2 font-medium text-foreground">
                      {faq.question}
                    </Text>
                    <ChevronDown
                      size={18}
                      color={colors.mutedForeground}
                      style={{
                        transform: [
                          {
                            rotate:
                              expandedIndex === globalIndex ? "180deg" : "0deg",
                          },
                        ],
                      }}
                    />
                  </Pressable>
                  {expandedIndex === globalIndex && (
                    <View className="border-t border-border bg-secondary/30 p-4">
                      <Text className="leading-6 text-foreground/90">
                        {faq.answer}
                      </Text>
                    </View>
                  )}
                </View>
              );
            })}
        </View>
      ))}
    </View>
  );
}

export function LegalPage({ slug, title }: LegalPageProps) {
  const router = useRouter();
  const navigation = useNavigation();
  const { colors } = useColorScheme();

  // Load content directly from bundled static content - always available, no async needed
  const page = useMemo(() => {
    const content = LEGAL_CONTENT[slug as keyof typeof LEGAL_CONTENT];
    return content || null;
  }, [slug]);

  const sections = useMemo(() => {
    return page?.content ? parseMarkdownContent(page.content) : [];
  }, [page?.content]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: page?.title || title,
      headerBackButtonDisplayMode: "minimal",
      headerLeft: () => null,
      headerRight: () => <SettingsCloseButton />,
      headerTintColor: colors.foreground,
      headerStyle: { backgroundColor: colors.background },
      headerTitleStyle: {
        color: colors.foreground,
        fontWeight: "600" as const,
        fontSize: 17,
      },
      headerShadowVisible: false,
    });
  }, [navigation, colors, page?.title, title]);

  return (
    <View className="flex-1 bg-background">
      <Main className="flex-1">
        {!page ? (
          <View className="flex-1 items-center justify-center px-6">
            <Text className="text-center text-muted-foreground">
              Content not available for this page.
            </Text>
          </View>
        ) : (
          <ScrollView
            className="flex-1 px-4 py-6"
            showsVerticalScrollIndicator={false}
          >
            {page?.lastUpdated && (
              <Text className="mb-2 text-xs text-muted-foreground">
                Last updated: {page.lastUpdated}
              </Text>
            )}

            {page?.subtitle && (
              <Text className="mb-4 text-base text-primary">
                {page.subtitle}
              </Text>
            )}

            {sections.length === 0 && (
              <View className="mb-4 rounded-xl border border-border bg-card p-4">
                <Text className="text-center text-muted-foreground">
                  No content available.
                </Text>
              </View>
            )}

            {sections.map((section, index) => {
              switch (section.type) {
                case "heading":
                  return (
                    <Text
                      key={index}
                      className="mb-2 mt-6 text-lg font-semibold text-foreground"
                    >
                      {section.content}
                    </Text>
                  );
                case "subheading":
                  return (
                    <Text
                      key={index}
                      className="mb-2 mt-4 font-semibold text-foreground"
                    >
                      {section.content}
                    </Text>
                  );
                case "list":
                  return (
                    <View key={index} className="mb-4 ml-2">
                      {section.items?.map((item, i) => (
                        <View key={i} className="mb-1 flex-row">
                          <Text className="mr-2 text-primary">•</Text>
                          <Text className="flex-1 leading-6 text-foreground/90">
                            {item}
                          </Text>
                        </View>
                      ))}
                    </View>
                  );
                case "paragraph":
                default:
                  const isBold =
                    section.content.startsWith("**") &&
                    section.content.endsWith("**");
                  const cleanContent = isBold
                    ? section.content.slice(2, -2)
                    : section.content;
                  return (
                    <Text
                      key={index}
                      className={`mb-4 leading-6 text-foreground/90 ${isBold ? "font-semibold" : ""}`}
                    >
                      {cleanContent}
                    </Text>
                  );
              }
            })}

            {/* FAQs only exist on the FAQ page */}
            {"faqs" in page &&
              Array.isArray((page as any).faqs) &&
              (page as any).faqs.length > 0 && (
                <View className="mt-6">
                  <FAQSection faqs={(page as any).faqs} />
                </View>
              )}

            <View className="mt-8 rounded-xl border border-primary/20 bg-primary/5 p-4">
              <Text className="mb-2 font-semibold text-foreground">
                Need Help?
              </Text>
              <Text className="text-sm text-muted-foreground">
                Contact our support team at DeviantEventsDC@gmail.com
              </Text>
            </View>

            <View className="h-8" />
          </ScrollView>
        )}
      </Main>
    </View>
  );
}
