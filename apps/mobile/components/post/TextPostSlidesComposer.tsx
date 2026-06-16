import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { Plus, Trash2 } from "lucide-react-native";
import { UserMentionAutocomplete } from "@/components/ui/user-mention-autocomplete";
import {
  TEXT_POST_MAX_LENGTH,
  TEXT_POST_MAX_SLIDES,
} from "@/lib/posts/text-post";
import type { TextPostSlide, TextPostThemeKey } from "@/lib/types";

interface TextPostSlidesComposerProps {
  slides: TextPostSlide[];
  activeIndex: number;
  theme: TextPostThemeKey;
  onSelectSlide: (index: number) => void;
  onSlideChange: (index: number, content: string) => void;
  onAddSlide: () => void;
  onRemoveSlide: (index: number) => void;
  onThemeChange: (theme: TextPostThemeKey) => void;
}

export function TextPostSlidesComposer({
  slides,
  activeIndex,
  theme,
  onSelectSlide,
  onSlideChange,
  onAddSlide,
  onRemoveSlide,
  onThemeChange,
}: TextPostSlidesComposerProps) {
  const activeSlide = slides[activeIndex] ?? slides[0];
  const canAddSlide = slides.length < TEXT_POST_MAX_SLIDES;
  const canRemoveSlide = slides.length > 1;

  const handleRemoveSlide = () => {
    if (!canRemoveSlide) return;
    if (activeSlide?.content.trim()) {
      Alert.alert(
        "Delete Slide?",
        "This slide has text on it. Delete it anyway?",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => onRemoveSlide(activeIndex),
          },
        ],
      );
      return;
    }
    onRemoveSlide(activeIndex);
  };

  return (
    <>
      <View style={{ padding: 16, paddingBottom: 8 }}>
        <View
          style={{
            marginBottom: 12,
          }}
        >
          <View style={{ minWidth: 0 }}>
            <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>
              Slide {activeIndex + 1} of {slides.length}
            </Text>
          </View>

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 10,
              marginTop: 12,
            }}
          >
            <Pressable
              onPress={handleRemoveSlide}
              disabled={!canRemoveSlide}
              style={{
                width: 40,
                height: 40,
                borderRadius: 14,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(255,255,255,0.04)",
                borderWidth: 1,
                borderColor: canRemoveSlide
                  ? "rgba(255,255,255,0.08)"
                  : "rgba(255,255,255,0.03)",
                opacity: canRemoveSlide ? 1 : 0.45,
              }}
            >
              <Trash2 size={16} color="#fff" />
            </Pressable>
            <Pressable
              onPress={onAddSlide}
              disabled={!canAddSlide}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingHorizontal: 14,
                height: 40,
                borderRadius: 14,
                flexShrink: 1,
                backgroundColor: canAddSlide
                  ? "rgba(62,164,229,0.16)"
                  : "rgba(255,255,255,0.04)",
                borderWidth: 1,
                borderColor: canAddSlide
                  ? "rgba(107,197,255,0.42)"
                  : "rgba(255,255,255,0.06)",
                opacity: canAddSlide ? 1 : 0.5,
              }}
            >
              <Plus size={16} color={canAddSlide ? "#6BC5FF" : "#64748B"} />
              <Text
                style={{
                  color: canAddSlide ? "#fff" : "#94A3B8",
                  fontSize: 13,
                  fontWeight: "700",
                }}
                numberOfLines={1}
              >
                New Slide
              </Text>
            </Pressable>
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 10, paddingBottom: 2 }}
        >
          {slides.map((slide, index) => {
            const isActive = index === activeIndex;
            return (
              <Pressable
                key={slide.id}
                onPress={() => onSelectSlide(index)}
                style={{
                  width: 76,
                  paddingHorizontal: 10,
                  paddingVertical: 10,
                  borderRadius: 16,
                  backgroundColor: isActive
                    ? "rgba(62,164,229,0.18)"
                    : "rgba(255,255,255,0.04)",
                  borderWidth: 1,
                  borderColor: isActive
                    ? "rgba(107,197,255,0.42)"
                    : "rgba(255,255,255,0.08)",
                }}
              >
                <Text
                  style={{
                    color: isActive ? "#fff" : "#CBD5E1",
                    fontSize: 12,
                    fontWeight: "700",
                  }}
                >
                  Slide {index + 1}
                </Text>
                <Text
                  numberOfLines={2}
                  style={{
                    marginTop: 8,
                    color: isActive
                      ? "rgba(226,232,240,0.84)"
                      : "rgba(148,163,184,0.72)",
                    fontSize: 11,
                    lineHeight: 15,
                  }}
                >
                  {slide.content.trim() || "Empty"}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
        <UserMentionAutocomplete
          value={activeSlide?.content || ""}
          onChangeText={(value) => onSlideChange(activeIndex, value)}
          placeholder="Speak your mind…"
          multiline
          maxLength={TEXT_POST_MAX_LENGTH}
          style={{
            fontSize: 18,
            minHeight: 140,
            lineHeight: 28,
          }}
        />

        <Text
          style={{
            fontSize: 12,
            color:
              (activeSlide?.content.length || 0) > TEXT_POST_MAX_LENGTH
                ? "#FB7185"
                : "#64748B",
            marginTop: 10,
            textAlign: "right",
          }}
        >
          {activeSlide?.content.length || 0}/{TEXT_POST_MAX_LENGTH}
        </Text>
      </View>
    </>
  );
}
