// ============================================================
// Instagram Stories Editor - Filter Selector
// ============================================================

import React from "react";
import {
  View,
  Pressable,
  Text,
  StyleSheet,
  ScrollView,
  Dimensions,
} from "react-native";
import {
  Canvas,
  ColorMatrix,
  Paint,
  Group,
  Fill,
  LinearGradient,
  Image as SkiaImage,
  useImage,
  vec,
} from "@shopify/react-native-skia";
import { X, Check } from "lucide-react-native";
import { LUTFilter, FilterAdjustment } from "../../types";
import {
  EDITOR_COLORS,
  LUT_FILTERS,
  DEFAULT_ADJUSTMENTS,
  EFFECT_FILTERS,
  EffectFilter,
} from "../../constants";
import { useEditorStore } from "../../stores/editor-store";
import { RoundedSlider } from "../ui/RoundedSlider";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const THUMB_SIZE = 72;
const THUMB_RADIUS = 14;

// ---- Filter Selector ----

type MainTab = "filters" | "effects";

interface FilterSelectorProps {
  currentFilter: LUTFilter | null;
  onSelectFilter: (filter: LUTFilter) => void;
  onSelectEffect?: (effect: EffectFilter) => void;
  selectedEffectId?: string | null;
  mediaUri?: string | null;
  onDone: () => void;
}

export const FilterSelector: React.FC<FilterSelectorProps> = ({
  currentFilter,
  onSelectFilter,
  onSelectEffect,
  selectedEffectId,
  mediaUri,
  onDone,
}) => {
  // Load the actual media image for filter previews
  const thumbImage = useImage(mediaUri || undefined);
  const mainTab = useEditorStore((s) => s.filterMainTab);
  const setMainTab = useEditorStore((s) => s.setFilterMainTab);
  const effectCategory = useEditorStore((s) => s.filterEffectCategory);
  const setEffectCategory = useEditorStore((s) => s.setFilterEffectCategory);

  // Get the display name for the currently selected item
  const selectedName =
    mainTab === "filters"
      ? currentFilter?.name || null
      : EFFECT_FILTERS.find((l) => l.id === selectedEffectId)?.name || null;

  const effectCategories = [
    { id: "film", label: "Film" },
    { id: "fujifilm", label: "Fujifilm" },
    { id: "vivid", label: "Vivid" },
    { id: "cinematic", label: "Cinematic" },
    { id: "log", label: "Log" },
  ];

  const effectsForCategory = EFFECT_FILTERS.filter(
    (l) => l.category === effectCategory,
  );

  return (
    <View style={styles.container}>
      {/* ---- Main Tabs: Filters / Effects ---- */}
      <View style={styles.tabBar}>
        <Pressable
          style={[
            styles.mainTab,
            mainTab === "filters" && styles.mainTabActive,
          ]}
          onPress={() => setMainTab("filters")}
        >
          <Text
            style={[
              styles.mainTabText,
              mainTab === "filters" && styles.mainTabTextActive,
            ]}
          >
            Filters
          </Text>
        </Pressable>
        <Pressable
          style={[
            styles.mainTab,
            mainTab === "effects" && styles.mainTabActive,
          ]}
          onPress={() => setMainTab("effects")}
        >
          <Text
            style={[
              styles.mainTabText,
              mainTab === "effects" && styles.mainTabTextActive,
            ]}
          >
            Effects
          </Text>
        </Pressable>
      </View>

      {/* ---- Effect sub-categories (only when Effects tab is active) ---- */}
      {mainTab === "effects" && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.subCatRow}
        >
          {effectCategories.map((cat) => (
            <Pressable
              key={cat.id}
              style={[
                styles.subCatPill,
                effectCategory === cat.id && styles.subCatPillActive,
              ]}
              onPress={() => setEffectCategory(cat.id)}
            >
              <Text
                style={[
                  styles.subCatText,
                  effectCategory === cat.id && styles.subCatTextActive,
                ]}
              >
                {cat.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* ---- Thumbnail row (rounded squares with image preview) ---- */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.thumbRow}
        decelerationRate="fast"
      >
        {mainTab === "filters"
          ? LUT_FILTERS.map((filter) => {
              const isSelected = currentFilter?.id === filter.id;
              const canvasSize = THUMB_SIZE - 4;
              return (
                <Pressable
                  key={filter.id}
                  style={styles.thumbItem}
                  onPress={() => onSelectFilter(filter)}
                >
                  <View
                    style={[
                      styles.thumbRing,
                      isSelected && styles.thumbRingActive,
                    ]}
                  >
                    <Canvas style={styles.thumbCanvas}>
                      <Group
                        layer={
                          filter.id !== "normal" ? (
                            <Paint>
                              <ColorMatrix matrix={filter.matrix} />
                            </Paint>
                          ) : undefined
                        }
                      >
                        {thumbImage ? (
                          <SkiaImage
                            image={thumbImage}
                            x={0}
                            y={0}
                            width={canvasSize}
                            height={canvasSize}
                            fit="cover"
                          />
                        ) : (
                          <>
                            <LinearGradient
                              start={vec(0, 0)}
                              end={vec(canvasSize, canvasSize)}
                              colors={[
                                "#FF6B6B",
                                "#FFA94D",
                                "#FFD43B",
                                "#69DB7C",
                                "#4DABF7",
                                "#9775FA",
                              ]}
                            />
                            <Fill />
                          </>
                        )}
                      </Group>
                    </Canvas>
                  </View>
                  <Text
                    style={[
                      styles.thumbLabel,
                      isSelected && styles.thumbLabelActive,
                    ]}
                    numberOfLines={1}
                  >
                    {filter.name}
                  </Text>
                </Pressable>
              );
            })
          : effectsForCategory.map((effect) => {
              const isSelected = selectedEffectId === effect.id;
              const canvasSize = THUMB_SIZE - 4;
              return (
                <Pressable
                  key={effect.id}
                  style={styles.thumbItem}
                  onPress={() => onSelectEffect?.(effect)}
                >
                  <View
                    style={[
                      styles.thumbRing,
                      isSelected && styles.thumbRingActive,
                    ]}
                  >
                    <Canvas style={styles.thumbCanvas}>
                      <Group
                        layer={
                          <Paint>
                            <ColorMatrix matrix={effect.matrix} />
                          </Paint>
                        }
                      >
                        {thumbImage ? (
                          <SkiaImage
                            image={thumbImage}
                            x={0}
                            y={0}
                            width={canvasSize}
                            height={canvasSize}
                            fit="cover"
                          />
                        ) : (
                          <>
                            <LinearGradient
                              start={vec(0, 0)}
                              end={vec(canvasSize, canvasSize)}
                              colors={[
                                "#FF6B6B",
                                "#FFA94D",
                                "#FFD43B",
                                "#69DB7C",
                                "#4DABF7",
                                "#9775FA",
                              ]}
                            />
                            <Fill />
                          </>
                        )}
                      </Group>
                    </Canvas>
                  </View>
                  <Text
                    style={[
                      styles.thumbLabel,
                      isSelected && styles.thumbLabelActive,
                    ]}
                    numberOfLines={1}
                  >
                    {effect.name}
                  </Text>
                </Pressable>
              );
            })}
      </ScrollView>

      {/* ---- Selected filter name + action buttons ---- */}
      <View style={styles.footer}>
        <Pressable onPress={onDone} style={styles.closeBtn}>
          <Text style={styles.closeBtnText}>X</Text>
        </Pressable>
        <Text style={styles.selectedName} numberOfLines={1}>
          {selectedName || "None"}
        </Text>
        <Pressable onPress={onDone} style={styles.confirmBtn}>
          <Text style={styles.confirmBtnText}>Done</Text>
        </Pressable>
      </View>
    </View>
  );
};

// ---- Adjustment Panel ----

interface AdjustmentPanelProps {
  adjustments: FilterAdjustment;
  onAdjustmentChange: (key: keyof FilterAdjustment, value: number) => void;
  onReset: () => void;
  onDone: () => void;
}

const ADJUSTMENT_CONTROLS: {
  key: keyof FilterAdjustment;
  label: string;
  icon: string;
  min: number;
  max: number;
}[] = [
  { key: "brightness", label: "Brightness", icon: "☀️", min: -100, max: 100 },
  { key: "contrast", label: "Contrast", icon: "◐", min: -100, max: 100 },
  { key: "saturation", label: "Saturation", icon: "🎨", min: -100, max: 100 },
  { key: "temperature", label: "Temperature", icon: "🌡️", min: -100, max: 100 },
  { key: "tint", label: "Tint", icon: "💜", min: -100, max: 100 },
  { key: "highlights", label: "Highlights", icon: "🔆", min: -100, max: 100 },
  { key: "shadows", label: "Shadows", icon: "🌑", min: -100, max: 100 },
  { key: "vignette", label: "Vignette", icon: "⬭", min: 0, max: 100 },
  { key: "sharpen", label: "Sharpen", icon: "🔍", min: 0, max: 100 },
  { key: "fade", label: "Fade", icon: "🌫️", min: 0, max: 100 },
  { key: "grain", label: "Grain", icon: "🔳", min: 0, max: 100 },
];

export const AdjustmentPanel: React.FC<AdjustmentPanelProps> = ({
  adjustments,
  onAdjustmentChange,
  onReset,
  onDone,
}) => {
  const hasChanges = Object.keys(adjustments).some(
    (key) =>
      adjustments[key as keyof FilterAdjustment] !==
      DEFAULT_ADJUSTMENTS[key as keyof FilterAdjustment],
  );

  return (
    <View style={adjustStyles.container}>
      <View style={adjustStyles.header}>
        <Pressable
          onPress={onReset}
          disabled={!hasChanges}
          style={adjustStyles.resetButton}
        >
          <Text
            style={[
              adjustStyles.resetText,
              !hasChanges && adjustStyles.disabled,
            ]}
          >
            Reset
          </Text>
        </Pressable>
        <Text style={adjustStyles.title}>Adjust</Text>
        <Pressable onPress={onDone} style={adjustStyles.doneButton}>
          <Text style={adjustStyles.doneText}>Done</Text>
        </Pressable>
      </View>

      <ScrollView
        style={adjustStyles.scrollView}
        contentContainerStyle={adjustStyles.sliderList}
        showsVerticalScrollIndicator={false}
      >
        {ADJUSTMENT_CONTROLS.map((control) => {
          const value = adjustments[control.key];
          const isModified = value !== DEFAULT_ADJUSTMENTS[control.key];

          return (
            <View key={control.key} style={adjustStyles.sliderRow}>
              <View style={adjustStyles.sliderLabel}>
                <Text style={adjustStyles.sliderIcon}>{control.icon}</Text>
                <Text
                  style={[
                    adjustStyles.sliderName,
                    isModified && adjustStyles.sliderNameModified,
                  ]}
                >
                  {control.label}
                </Text>
              </View>

              <View style={adjustStyles.sliderControl}>
                <RoundedSlider
                  style={adjustStyles.slider}
                  minimumValue={control.min}
                  maximumValue={control.max}
                  value={value}
                  onValueChange={(val: number) =>
                    onAdjustmentChange(control.key, val)
                  }
                  minimumTrackTintColor={
                    isModified
                      ? EDITOR_COLORS.primary
                      : EDITOR_COLORS.surfaceLight
                  }
                  maximumTrackTintColor={EDITOR_COLORS.surfaceLight}
                />
              </View>

              <Text
                style={[
                  adjustStyles.sliderValue,
                  isModified && adjustStyles.sliderValueModified,
                ]}
              >
                {value > 0 ? `+${value}` : value}
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
};

// ---- Filter Selector Styles ----

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 4,
  },
  // ---- Tab bar (Filters / Effects) ----
  tabBar: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 24,
    paddingBottom: 12,
  },
  mainTab: {
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  mainTabActive: {
    borderBottomColor: "#fff",
  },
  mainTabText: {
    color: EDITOR_COLORS.textSecondary,
    fontSize: 15,
    fontWeight: "600",
  },
  mainTabTextActive: {
    color: "#fff",
  },
  // ---- Effect sub-category pills ----
  subCatRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    gap: 6,
    marginBottom: 10,
  },
  subCatPill: {
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: EDITOR_COLORS.surface,
  },
  subCatPillActive: {
    backgroundColor: EDITOR_COLORS.primary,
  },
  subCatText: {
    color: EDITOR_COLORS.textSecondary,
    fontSize: 12,
    fontWeight: "600",
  },
  subCatTextActive: {
    color: "#fff",
  },
  // ---- Rounded-square thumbnail row ----
  thumbRow: {
    paddingHorizontal: 16,
    gap: 14,
    paddingVertical: 8,
    alignItems: "flex-start",
  },
  thumbItem: {
    alignItems: "center",
    width: THUMB_SIZE + 8,
    gap: 6,
  },
  thumbRing: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_RADIUS,
    borderWidth: 2,
    borderColor: "transparent",
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },
  thumbRingActive: {
    borderColor: "#fff",
    borderWidth: 2.5,
  },
  thumbCanvas: {
    width: THUMB_SIZE - 4,
    height: THUMB_SIZE - 4,
    borderRadius: THUMB_RADIUS - 2,
  },
  thumbLabel: {
    color: EDITOR_COLORS.textSecondary,
    fontSize: 10,
    fontWeight: "600",
    textAlign: "center",
  },
  thumbLabelActive: {
    color: "#fff",
  },
  // ---- LUT overlay initials ----
  lutOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: "center",
    alignItems: "center",
  },
  lutInitials: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 1,
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  // ---- Footer (close / name / done) ----
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: EDITOR_COLORS.surface,
    justifyContent: "center",
    alignItems: "center",
  },
  closeBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  selectedName: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
    flex: 1,
    textAlign: "center",
  },
  confirmBtn: {
    backgroundColor: EDITOR_COLORS.primary,
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 16,
  },
  confirmBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
});

// ---- Adjustment Panel Styles ----

const adjustStyles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 4,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  title: {
    color: EDITOR_COLORS.text,
    fontSize: 18,
    fontWeight: "700",
  },
  resetButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  resetText: {
    color: EDITOR_COLORS.primary,
    fontSize: 14,
    fontWeight: "600",
  },
  disabled: {
    opacity: 0.3,
  },
  doneButton: {
    backgroundColor: EDITOR_COLORS.primary,
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 16,
  },
  doneText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  scrollView: {
    flex: 1,
  },
  sliderList: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    gap: 4,
  },
  sliderRow: {
    flexDirection: "row",
    alignItems: "center",
    height: 48,
  },
  sliderLabel: {
    flexDirection: "row",
    alignItems: "center",
    width: 120,
    gap: 8,
  },
  sliderIcon: {
    fontSize: 16,
  },
  sliderName: {
    color: EDITOR_COLORS.textSecondary,
    fontSize: 13,
    fontWeight: "500",
  },
  sliderNameModified: {
    color: EDITOR_COLORS.text,
  },
  sliderControl: {
    flex: 1,
    marginHorizontal: 4,
  },
  slider: {
    width: "100%",
    height: 40,
  },
  sliderValue: {
    width: 36,
    textAlign: "right",
    color: EDITOR_COLORS.textSecondary,
    fontSize: 13,
    fontWeight: "600",
  },
  sliderValueModified: {
    color: EDITOR_COLORS.primary,
  },
});
