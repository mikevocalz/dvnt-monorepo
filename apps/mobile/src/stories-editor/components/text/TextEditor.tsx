// ============================================================
// Instagram Stories Editor - Text Editor Component
// ============================================================
// Redesigned: responsive layout, robust font size system,
// vertical size slider, all inline styles for reliability.
// Font sizes stored in CANVAS units (1080×1920 coordinate space).
// ============================================================

import React, { useRef, useEffect, useCallback, useMemo } from "react";
import {
  View,
  TextInput,
  Pressable,
  Text,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
  useKeyboardHandler,
  KeyboardController,
} from "react-native-keyboard-controller";
import Animated, {
  FadeIn,
  FadeOut,
  useSharedValue,
  useAnimatedStyle,
  runOnJS,
  interpolate,
  Extrapolation,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  Check,
  Type,
} from "lucide-react-native";
import { TextElement, TextStylePreset, TextEditorTab } from "../../types";
import { useEditorStore } from "../../stores/editor-store";
import {
  DRAWING_COLORS,
  TEXT_FONTS,
  TEXT_STYLE_PRESETS,
  CANVAS_WIDTH,
  DEFAULT_TEXT_FONT_SIZE,
} from "../../constants";
import { Debouncer } from "@tanstack/react-pacer";
import {
  getSystemFontWeight,
  shouldUseSystemFontFallback,
} from "../../utils/text-support";

// ---- Font size range (canvas units) ----
const FS_MIN = 60; // ~22px on screen — always legible
const FS_MAX = 280; // ~102px on screen — huge headline
const FS_DEFAULT = DEFAULT_TEXT_FONT_SIZE; // 120 — ~44px on screen

interface TextEditorProps {
  element?: TextElement | null;
  onAdd: (options: Partial<TextElement>) => string;
  onUpdate: (id: string, updates: Partial<TextElement>) => void;
  onRemove: (id: string) => void;
  onDone: () => void;
  onCancel: () => void;
}

export const TextEditor: React.FC<TextEditorProps> = ({
  element,
  onAdd,
  onUpdate,
  onRemove,
  onDone,
  onCancel,
}) => {
  const inputRef = useRef<TextInput>(null);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const canvasToViewScale = screenWidth / CANVAS_WIDTH;

  // ---- Zustand state ----
  const text = useEditorStore((s) => s.textEditContent);
  const setText = useEditorStore((s) => s.setTextEditContent);
  const selectedFont = useEditorStore((s) => s.textEditFont);
  const setSelectedFont = useEditorStore((s) => s.setTextEditFont);
  const selectedColor = useEditorStore((s) => s.textEditColor);
  const setSelectedColor = useEditorStore((s) => s.setTextEditColor);
  const selectedStyle = useEditorStore((s) => s.textEditStyle);
  const setSelectedStyle = useEditorStore((s) => s.setTextEditStyle);
  const textAlign = useEditorStore((s) => s.textEditAlign);
  const setTextAlign = useEditorStore((s) => s.setTextEditAlign);
  const fontSize = useEditorStore((s) => s.textEditFontSize);
  const setFontSize = useEditorStore((s) => s.setTextEditFontSize);
  const activeTab = useEditorStore((s) => s.textEditorTab);
  const setActiveTab = useEditorStore((s) => s.setTextEditorTab);
  const elementId = useEditorStore((s) => s.textEditElementId);
  const setElementId = useEditorStore((s) => s.setTextEditElementId);
  const initTextEdit = useEditorStore((s) => s.initTextEdit);

  // ---- Initialize ----
  useEffect(() => {
    initTextEdit(element);
    // Ensure font size is within our enforced range
    const currentFs = element?.fontSize || FS_DEFAULT;
    const clamped = Math.max(FS_MIN, Math.min(FS_MAX, currentFs));
    if (clamped !== currentFs) setFontSize(clamped);
  }, []);

  // Focus input after mount
  const focusDebouncer = useRef(
    new Debouncer(() => inputRef.current?.focus(), { wait: 80 }),
  );
  useEffect(() => {
    focusDebouncer.current.maybeExecute();
  }, []);

  // ---- Build updates ----
  const letterSpacing = useEditorStore((s) => s.textEditLetterSpacing);
  const setLetterSpacing = useEditorStore((s) => s.setTextEditLetterSpacing);
  const lineHeightMul = useEditorStore((s) => s.textEditLineHeight);
  const setLineHeightMul = useEditorStore((s) => s.setTextEditLineHeight);

  const buildUpdates = useCallback((): Partial<TextElement> => {
    const {
      textEditContent,
      textEditFont,
      textEditColor,
      textEditStyle,
      textEditAlign,
      textEditFontSize,
      textEditLetterSpacing,
      textEditLineHeight,
    } = useEditorStore.getState();
    const clampedFs = Math.max(FS_MIN, Math.min(FS_MAX, textEditFontSize));
    const stylePreset = TEXT_STYLE_PRESETS.find((s) => s.id === textEditStyle);
    return {
      content: textEditContent,
      fontFamily: textEditFont,
      color: textEditColor,
      style: textEditStyle,
      textAlign: textEditAlign,
      fontSize: clampedFs,
      letterSpacing: textEditLetterSpacing,
      lineHeight: textEditLineHeight,
      backgroundColor: stylePreset?.defaultBackgroundColor,
      strokeColor: stylePreset?.defaultStrokeColor,
      strokeWidth: stylePreset?.defaultStrokeWidth,
      shadowColor: stylePreset?.defaultShadowColor,
      shadowBlur: stylePreset?.defaultShadowBlur,
    };
  }, []);

  // Live sync to canvas element
  useEffect(() => {
    if (!text.trim()) return;
    const updates = buildUpdates();
    const currentElementId = useEditorStore.getState().textEditElementId;

    if (currentElementId) {
      onUpdate(currentElementId, updates);
    } else {
      const id = onAdd(updates);
      setElementId(id);
    }
  }, [
    text,
    selectedFont,
    selectedColor,
    selectedStyle,
    textAlign,
    fontSize,
    letterSpacing,
    lineHeightMul,
  ]);

  // ---- Done handler ----
  const handleDone = useCallback(() => {
    const currentText = useEditorStore.getState().textEditContent;
    const currentElementId = useEditorStore.getState().textEditElementId;

    if (!currentText.trim()) {
      if (currentElementId) onRemove(currentElementId);
      onCancel();
      return;
    }

    const updates = buildUpdates();
    if (currentElementId) {
      onUpdate(currentElementId, updates);
    } else {
      onAdd(updates);
    }
    onDone();
  }, [buildUpdates, onAdd, onUpdate, onRemove, onDone, onCancel]);

  // ---- Keyboard tracking ----
  const keyboardHeight = useSharedValue(0);
  useKeyboardHandler({
    onMove: (e) => {
      "worklet";
      keyboardHeight.value = e.height;
    },
    onEnd: (e) => {
      "worklet";
      keyboardHeight.value = e.height;
    },
  });

  const bottomPanelAnimatedStyle = useAnimatedStyle(() => ({
    paddingBottom: Math.max(keyboardHeight.value, insets.bottom + 16),
  }));

  // ---- Vertical font size slider ----
  const SLIDER_HEIGHT = Math.min(screenHeight * 0.28, 220);
  const sliderProgress = useSharedValue(
    (Math.max(FS_MIN, Math.min(FS_MAX, fontSize)) - FS_MIN) / (FS_MAX - FS_MIN),
  );

  // Keep slider in sync with store fontSize
  useEffect(() => {
    sliderProgress.value =
      (Math.max(FS_MIN, Math.min(FS_MAX, fontSize)) - FS_MIN) /
      (FS_MAX - FS_MIN);
  }, [fontSize]);

  const updateFontSizeFromSlider = useCallback(
    (progress: number) => {
      const clamped = Math.max(0, Math.min(1, progress));
      const newFs = Math.round(FS_MIN + clamped * (FS_MAX - FS_MIN));
      setFontSize(newFs);
    },
    [setFontSize],
  );

  const sliderFrameCount = useSharedValue(0);
  const sliderPan = Gesture.Pan()
    .onStart(() => {
      "worklet";
      sliderFrameCount.value = 0;
    })
    .onUpdate((e) => {
      "worklet";
      // Invert Y: dragging UP = bigger
      const progress = 1 - Math.max(0, Math.min(1, e.y / SLIDER_HEIGHT));
      sliderProgress.value = progress;
      // Throttle JS bridge: only sync store every 3rd frame
      sliderFrameCount.value += 1;
      if (sliderFrameCount.value % 3 === 0) {
        runOnJS(updateFontSizeFromSlider)(progress);
      }
    })
    .onEnd(() => {
      "worklet";
      // Final sync to ensure store matches visual
      runOnJS(updateFontSizeFromSlider)(sliderProgress.value);
    })
    .hitSlop({ left: 20, right: 20, top: 10, bottom: 10 });

  const sliderThumbStyle = useAnimatedStyle(() => ({
    bottom: interpolate(
      sliderProgress.value,
      [0, 1],
      [0, SLIDER_HEIGHT - 28],
      Extrapolation.CLAMP,
    ),
  }));

  const sliderFillStyle = useAnimatedStyle(() => ({
    height: interpolate(
      sliderProgress.value,
      [0, 1],
      [0, SLIDER_HEIGHT],
      Extrapolation.CLAMP,
    ),
  }));

  // ---- Preview style (matches canvas rendering) ----
  const getPreviewStyle = useCallback(() => {
    const clampedFs = Math.max(FS_MIN, fontSize);
    const viewFontSize = Math.max(
      18,
      Math.round(clampedFs * canvasToViewScale),
    );
    const usesSystemFont = shouldUseSystemFontFallback(text);
    const baseStyle: any = {
      color: selectedColor,
      fontFamily: usesSystemFont ? undefined : selectedFont,
      fontWeight: usesSystemFont
        ? getSystemFontWeight(selectedFont)
        : undefined,
      fontSize: viewFontSize,
      textAlign,
      lineHeight: viewFontSize * lineHeightMul,
      letterSpacing: letterSpacing,
    };

    switch (selectedStyle) {
      case "modern":
        baseStyle.backgroundColor = "rgba(0,0,0,0.7)";
        baseStyle.paddingHorizontal = 12;
        baseStyle.paddingVertical = 6;
        baseStyle.borderRadius = 4;
        baseStyle.overflow = "hidden";
        break;
      case "neon":
        baseStyle.textShadowColor = selectedColor;
        baseStyle.textShadowRadius = 15;
        baseStyle.textShadowOffset = { width: 0, height: 0 };
        break;
      case "typewriter":
        baseStyle.backgroundColor = "#FFFFFF";
        baseStyle.color = "#000000";
        baseStyle.paddingHorizontal = 12;
        baseStyle.paddingVertical = 6;
        break;
      case "strong":
        baseStyle.backgroundColor = "#FF3B30";
        baseStyle.paddingHorizontal = 16;
        baseStyle.paddingVertical = 8;
        baseStyle.fontWeight = "900";
        break;
      case "outline":
        baseStyle.textShadowColor = "#FFFFFF";
        baseStyle.textShadowRadius = 3;
        break;
      case "shadow":
        baseStyle.textShadowColor = "#000000";
        baseStyle.textShadowRadius = 10;
        baseStyle.textShadowOffset = { width: 2, height: 2 };
        break;
    }
    return baseStyle;
  }, [
    fontSize,
    selectedColor,
    selectedFont,
    text,
    textAlign,
    selectedStyle,
    canvasToViewScale,
    letterSpacing,
    lineHeightMul,
  ]);

  // ---- Responsive sizes ----
  const hp = screenWidth * 0.04; // horizontal padding
  const colorDotSize = Math.max(28, Math.min(34, screenWidth * 0.078));
  const tabHeight = 40;
  const railHeight = 88;
  const swatchTileSize = 52;
  const swatchTileRadius = 14;

  // ---- Tab definitions ----
  const TABS: { id: TextEditorTab; label: string }[] = [
    { id: "style", label: "Style" },
    { id: "font", label: "Font" },
    { id: "color", label: "Color" },
    { id: "typography", label: "Type" },
  ];

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(200)}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0,0,0,0.18)",
      }}
    >
      {/* ---- Top Bar ---- */}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          paddingTop: insets.top + 8,
          paddingHorizontal: hp,
        }}
      >
        <Pressable
          onPress={onCancel}
          hitSlop={12}
          style={{
            paddingVertical: 8,
            paddingHorizontal: 12,
          }}
        >
          <Text style={{ color: "#fff", fontSize: 16, fontWeight: "500" }}>
            Cancel
          </Text>
        </Pressable>

        {/* Alignment quick-toggle */}
        <View style={{ flexDirection: "row", gap: 4 }}>
          {(["left", "center", "right"] as const).map((align) => {
            const isActive = textAlign === align;
            const Icon =
              align === "left"
                ? AlignLeft
                : align === "center"
                  ? AlignCenter
                  : AlignRight;
            return (
              <Pressable
                key={align}
                onPress={() => setTextAlign(align)}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  backgroundColor: isActive
                    ? "rgba(255,255,255,0.2)"
                    : "transparent",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon
                  size={20}
                  color={isActive ? "#fff" : "rgba(255,255,255,0.5)"}
                  strokeWidth={2}
                />
              </Pressable>
            );
          })}
        </View>

        <Pressable
          onPress={handleDone}
          hitSlop={8}
          style={{
            backgroundColor: "#3EA4E5",
            paddingVertical: 10,
            paddingHorizontal: 24,
            borderRadius: 20,
          }}
        >
          <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>
            Done
          </Text>
        </Pressable>
      </View>

      {/* ---- Center: Text Input + Vertical Font Size Slider ---- */}
      <View style={{ flex: 1 }}>
        {/* Background layer — tap empty space to dismiss keyboard */}
        <Pressable
          onPress={() => KeyboardController.dismiss()}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        />
        {/* Content layer — children receive touches, container doesn't */}
        <View
          pointerEvents="box-none"
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
          }}
        >
          {/* Vertical font size slider (left edge) */}
          <View
            style={{
              width: 44,
              height: SLIDER_HEIGHT,
              marginLeft: 8,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <GestureDetector gesture={sliderPan}>
              <Animated.View
                style={{
                  width: 44,
                  height: SLIDER_HEIGHT,
                  alignItems: "center",
                  justifyContent: "flex-end",
                }}
              >
                {/* Slider track */}
                <View
                  style={{
                    position: "absolute",
                    width: 4,
                    height: SLIDER_HEIGHT,
                    borderRadius: 2,
                    backgroundColor: "rgba(255,255,255,0.15)",
                    left: 20,
                  }}
                />
                {/* Slider fill */}
                <Animated.View
                  style={[
                    {
                      position: "absolute",
                      width: 4,
                      borderRadius: 2,
                      backgroundColor: "#3EA4E5",
                      bottom: 0,
                      left: 20,
                    },
                    sliderFillStyle,
                  ]}
                />
                {/* Slider thumb */}
                <Animated.View
                  style={[
                    {
                      position: "absolute",
                      width: 28,
                      height: 28,
                      borderRadius: 14,
                      backgroundColor: "#fff",
                      left: 8,
                      alignItems: "center",
                      justifyContent: "center",
                      shadowColor: "#000",
                      shadowOffset: { width: 0, height: 2 },
                      shadowOpacity: 0.3,
                      shadowRadius: 4,
                      elevation: 4,
                    },
                    sliderThumbStyle,
                  ]}
                >
                  <Type size={14} color="#333" strokeWidth={2.5} />
                </Animated.View>
              </Animated.View>
            </GestureDetector>

            {/* Font size label below slider */}
            <Text
              style={{
                color: "rgba(255,255,255,0.5)",
                fontSize: 11,
                fontWeight: "600",
                marginTop: 8,
                textAlign: "center",
              }}
            >
              {Math.round(fontSize * canvasToViewScale)}pt
            </Text>
          </View>

          {/* Text input area */}
          <View
            style={{
              flex: 1,
              justifyContent: "center",
              alignItems: "center",
              paddingHorizontal: hp,
              paddingRight: hp + 20,
            }}
          >
            <TextInput
              ref={inputRef}
              style={[
                {
                  width: "100%",
                  minHeight: 50,
                  maxHeight: screenHeight * 0.3,
                },
                getPreviewStyle(),
              ]}
              value={text}
              onChangeText={setText}
              placeholder="Type something..."
              placeholderTextColor="rgba(255,255,255,0.35)"
              multiline
              autoFocus
              selectionColor="#3EA4E5"
            />
          </View>
        </View>
      </View>

      {/* ---- Bottom Panel ---- */}
      <Animated.View
        style={[
          {
            backgroundColor: "rgba(0,0,0,0.92)",
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            borderCurve: "continuous" as any,
            paddingTop: 10,
            minHeight: 152,
          },
          bottomPanelAnimatedStyle,
        ]}
      >
        {/* Tab bar */}
        <View
          style={{
            flexDirection: "row",
            marginHorizontal: hp,
            marginBottom: 10,
            backgroundColor: "rgba(255,255,255,0.06)",
            borderRadius: 12,
            padding: 3,
          }}
        >
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <Pressable
                key={tab.id}
                onPress={() => setActiveTab(tab.id)}
                style={{
                  flex: 1,
                  height: tabHeight,
                  borderRadius: 10,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: isActive
                    ? "rgba(255,255,255,0.12)"
                    : "transparent",
                }}
              >
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: "600",
                    color: isActive ? "#fff" : "rgba(255,255,255,0.45)",
                  }}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Tab content */}
        {activeTab === "typography" ? (
          <View
            style={{
              paddingHorizontal: hp,
              paddingBottom: 4,
            }}
          >
            <View
              style={{
                flexDirection: "column",
                gap: 14,
                width: "100%",
              }}
            >
              {/* Line Height */}
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
              >
                <Text
                  style={{
                    color: "rgba(255,255,255,0.5)",
                    fontSize: 12,
                    fontWeight: "600",
                    width: 72,
                  }}
                >
                  Line Height
                </Text>
                <Pressable
                  onPress={() =>
                    setLineHeightMul(Math.max(0.8, lineHeightMul - 0.05))
                  }
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    backgroundColor: "rgba(255,255,255,0.08)",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text
                    style={{ color: "#fff", fontSize: 18, fontWeight: "700" }}
                  >
                    −
                  </Text>
                </Pressable>
                <Text
                  style={{
                    color: "#fff",
                    fontSize: 14,
                    fontWeight: "600",
                    minWidth: 44,
                    textAlign: "center",
                  }}
                >
                  {lineHeightMul.toFixed(2)}
                </Text>
                <Pressable
                  onPress={() =>
                    setLineHeightMul(Math.min(2.5, lineHeightMul + 0.05))
                  }
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    backgroundColor: "rgba(255,255,255,0.08)",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text
                    style={{ color: "#fff", fontSize: 18, fontWeight: "700" }}
                  >
                    +
                  </Text>
                </Pressable>
              </View>
              {/* Letter Spacing */}
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
              >
                <Text
                  style={{
                    color: "rgba(255,255,255,0.5)",
                    fontSize: 12,
                    fontWeight: "600",
                    width: 72,
                  }}
                >
                  Spacing
                </Text>
                <Pressable
                  onPress={() =>
                    setLetterSpacing(Math.max(-5, letterSpacing - 0.5))
                  }
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    backgroundColor: "rgba(255,255,255,0.08)",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text
                    style={{ color: "#fff", fontSize: 18, fontWeight: "700" }}
                  >
                    −
                  </Text>
                </Pressable>
                <Text
                  style={{
                    color: "#fff",
                    fontSize: 14,
                    fontWeight: "600",
                    minWidth: 44,
                    textAlign: "center",
                  }}
                >
                  {letterSpacing.toFixed(1)}
                </Text>
                <Pressable
                  onPress={() =>
                    setLetterSpacing(Math.min(20, letterSpacing + 0.5))
                  }
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    backgroundColor: "rgba(255,255,255,0.08)",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text
                    style={{ color: "#fff", fontSize: 18, fontWeight: "700" }}
                  >
                    +
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ maxHeight: railHeight }}
            contentContainerStyle={{
              paddingLeft: hp,
              paddingRight: hp + 6,
              gap: 10,
              minHeight: railHeight,
              alignItems: "center",
              paddingBottom: 4,
            }}
            keyboardShouldPersistTaps="always"
          >
          {/* ---- Style tab ---- */}
          {activeTab === "style" &&
            TEXT_STYLE_PRESETS.map((preset) => {
              const isActive = selectedStyle === preset.id;
              return (
                <Pressable
                  key={preset.id}
                  onPress={() => setSelectedStyle(preset.id)}
                  style={{
                    alignItems: "center",
                    gap: 6,
                    minWidth: 60,
                    transform: [{ scale: isActive ? 1.08 : 1 }],
                  }}
                >
                  <View
                    style={{
                      width: swatchTileSize,
                      height: swatchTileSize,
                      borderRadius: swatchTileRadius,
                      backgroundColor: isActive
                        ? "rgba(62,164,229,0.2)"
                        : "rgba(255,255,255,0.08)",
                      borderWidth: isActive ? 2 : 0,
                      borderColor: "#3EA4E5",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text
                      style={[
                        {
                          color: "#fff",
                          fontSize: 18,
                          fontWeight: "700",
                        },
                        preset.hasBackground && {
                          backgroundColor:
                            preset.defaultBackgroundColor || "#333",
                          paddingHorizontal: 6,
                          paddingVertical: 2,
                          borderRadius: 3,
                          overflow: "hidden",
                        },
                        preset.hasShadow && {
                          textShadowColor: preset.defaultShadowColor || "#000",
                          textShadowRadius: 4,
                        },
                        preset.id === "typewriter" && {
                          color: "#000",
                          backgroundColor: "#FFF",
                        },
                      ]}
                    >
                      Aa
                    </Text>
                  </View>
                  <Text
                    style={{
                      color: isActive ? "#3EA4E5" : "rgba(255,255,255,0.4)",
                      fontSize: 10,
                      fontWeight: "600",
                    }}
                  >
                    {preset.name}
                  </Text>
                </Pressable>
              );
            })}

          {/* ---- Font tab ---- */}
          {activeTab === "font" &&
            TEXT_FONTS.map((font) => {
              const isActive = selectedFont === font.fontFamily;
              return (
                <Pressable
                  key={font.id}
                  onPress={() => setSelectedFont(font.fontFamily)}
                  style={{
                    alignItems: "center",
                    gap: 6,
                    minWidth: 64,
                    transform: [{ scale: isActive ? 1.08 : 1 }],
                  }}
                >
                  <View
                    style={{
                      width: swatchTileSize,
                      height: swatchTileSize,
                      borderRadius: swatchTileRadius,
                      backgroundColor: isActive
                        ? "rgba(62,164,229,0.2)"
                        : "rgba(255,255,255,0.08)",
                      borderWidth: isActive ? 2 : 0,
                      borderColor: "#3EA4E5",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text
                      style={{
                        color: "#fff",
                        fontSize: 24,
                        fontWeight: "700",
                        fontFamily: font.fontFamily,
                      }}
                    >
                      Aa
                    </Text>
                  </View>
                  <Text
                    style={{
                      color: isActive ? "#3EA4E5" : "rgba(255,255,255,0.4)",
                      fontSize: 10,
                      fontWeight: "600",
                    }}
                  >
                    {font.name}
                  </Text>
                </Pressable>
              );
            })}

          {/* ---- Color tab ---- */}
          {activeTab === "color" &&
            DRAWING_COLORS.map((c) => {
              const isActive = selectedColor === c;
              return (
                <Pressable
                  key={c}
                  onPress={() => setSelectedColor(c)}
                  style={{
                    width: colorDotSize,
                    height: colorDotSize,
                    borderRadius: Math.max(10, colorDotSize * 0.34),
                    backgroundColor: c,
                    borderWidth: isActive ? 3 : 2,
                    borderColor: isActive ? "#fff" : "rgba(255,255,255,0.15)",
                    alignItems: "center",
                    justifyContent: "center",
                    transform: [{ scale: isActive ? 1.15 : 1 }],
                  }}
                >
                  {isActive && <Check size={16} color="#fff" strokeWidth={3} />}
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </Animated.View>
    </Animated.View>
  );
};
