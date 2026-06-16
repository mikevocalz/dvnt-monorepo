// ============================================================
// Instagram Stories Editor - Drawing Toolbar
// ============================================================

import React from "react";
import { View, Pressable, Text, ScrollView } from "react-native";
import Animated, { SlideInDown, SlideOutDown } from "react-native-reanimated";
import { RoundedSlider } from "../ui/RoundedSlider";
import {
  Pen,
  PenTool,
  Sparkles,
  Highlighter,
  Eraser,
  MoveRight,
  Palette,
  Check,
  Undo2,
  Trash2,
} from "lucide-react-native";
import { DrawingTool } from "../../types";
import { useEditorStore } from "../../stores/editor-store";
import { DRAWING_COLORS, DRAWING_TOOL_CONFIG } from "../../constants";

interface DrawingToolbarProps {
  selectedTool: DrawingTool;
  selectedColor: string;
  strokeWidth: number;
  onToolChange: (tool: DrawingTool) => void;
  onColorChange: (color: string) => void;
  onStrokeWidthChange: (width: number) => void;
  onUndo: () => void;
  onClear: () => void;
  onDone: () => void;
}

const TOOLS: { id: DrawingTool; Icon: typeof Pen; label: string }[] = [
  { id: "pen", Icon: Pen, label: "Pen" },
  { id: "marker", Icon: PenTool, label: "Marker" },
  { id: "neon", Icon: Sparkles, label: "Neon" },
  { id: "highlighter", Icon: Highlighter, label: "Highlight" },
  { id: "eraser", Icon: Eraser, label: "Eraser" },
  { id: "arrow", Icon: MoveRight, label: "Arrow" },
];

export const DrawingToolbar: React.FC<DrawingToolbarProps> = ({
  selectedTool,
  selectedColor,
  strokeWidth,
  onToolChange,
  onColorChange,
  onStrokeWidthChange,
  onUndo,
  onClear,
  onDone,
}) => {
  const showColorPicker = useEditorStore((s) => s.showDrawingColorPicker);
  const toggleColorPicker = useEditorStore((s) => s.toggleDrawingColorPicker);

  const toolConfig = DRAWING_TOOL_CONFIG[selectedTool];

  return (
    <Animated.View
      className="absolute bottom-0 left-0 right-0 bg-black/90 rounded-t-3xl pb-10 pt-4"
      entering={SlideInDown.duration(300)}
      exiting={SlideOutDown.duration(200)}
    >
      {/* Top Action Bar */}
      <View className="flex-row justify-between items-center px-5 mb-4">
        <Pressable
          onPress={onClear}
          className="flex-row items-center gap-1.5 py-2 px-4"
        >
          <Trash2 size={16} color="#fff" strokeWidth={1.8} />
          <Text className="text-white text-[15px] font-medium">Clear</Text>
        </Pressable>
        <Pressable
          onPress={onUndo}
          className="flex-row items-center gap-1.5 py-2 px-4"
        >
          <Undo2 size={16} color="#fff" strokeWidth={1.8} />
          <Text className="text-white text-[15px] font-medium">Undo</Text>
        </Pressable>
        <Pressable
          onPress={onDone}
          className="bg-blue-500 py-2 px-5 rounded-full"
        >
          <Text className="text-white text-[15px] font-bold">Done</Text>
        </Pressable>
      </View>

      {/* Stroke Width Slider */}
      <View className="flex-row items-center px-5 mb-4 gap-3">
        <View
          style={{
            width: Math.min(strokeWidth, 40),
            height: Math.min(strokeWidth, 40),
            borderRadius: strokeWidth / 2,
            backgroundColor: selectedTool === "eraser" ? "#666" : selectedColor,
            minWidth: 4,
            minHeight: 4,
          }}
        />
        <RoundedSlider
          style={{ flex: 1, height: 40 }}
          minimumValue={toolConfig.minWidth}
          maximumValue={toolConfig.maxWidth}
          value={strokeWidth}
          onValueChange={onStrokeWidthChange}
          minimumTrackTintColor="#0095F6"
          maximumTrackTintColor="#2a2a2a"
        />
      </View>

      {/* Tool Selector */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 16,
          gap: 8,
          marginBottom: 16,
        }}
      >
        {TOOLS.map((tool) => {
          const isActive = selectedTool === tool.id;
          return (
            <Pressable
              key={tool.id}
              className={`items-center justify-center py-2 px-3.5 rounded-2xl min-w-[60px] ${
                isActive ? "bg-blue-500" : "bg-neutral-800"
              }`}
              onPress={() => onToolChange(tool.id)}
            >
              <tool.Icon
                size={18}
                color="#fff"
                strokeWidth={isActive ? 2.5 : 1.8}
              />
              <Text
                className={`text-[10px] font-semibold mt-0.5 ${
                  isActive ? "text-white" : "text-neutral-400"
                }`}
              >
                {tool.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Color Palette */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 16,
          gap: 8,
          paddingBottom: 8,
        }}
      >
        <Pressable
          className="w-9 h-9 rounded-full bg-neutral-700 items-center justify-center"
          onPress={toggleColorPicker}
        >
          <Palette size={18} color="#fff" strokeWidth={1.8} />
        </Pressable>

        {DRAWING_COLORS.map((color) => {
          const isActive = selectedColor === color;
          return (
            <Pressable
              key={color}
              className={`w-9 h-9 rounded-full items-center justify-center border-2 ${
                isActive ? "border-white" : "border-transparent"
              }`}
              style={[
                { backgroundColor: color },
                isActive && { transform: [{ scale: 1.15 }] },
              ]}
              onPress={() => onColorChange(color)}
            >
              {isActive && (
                <Check
                  size={14}
                  color={isLightColor(color) ? "#000" : "#fff"}
                  strokeWidth={3}
                />
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    </Animated.View>
  );
};

const isLightColor = (hex: string): boolean => {
  if (!hex || hex.length < 7) return false;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 128;
};
