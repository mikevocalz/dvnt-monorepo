/**
 * EditToolbar — Instagram-parity edit controls.
 *
 * Aspect chips, rotate 90°, flip horizontal, straighten slider, resize presets.
 * Undo/redo + reset buttons.
 *
 * All controls dispatch to the EditState reducer — zero pixel work.
 */

import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import Slider from "@react-native-community/slider";
import {
  RotateCw,
  FlipHorizontal2,
  Undo2,
  Redo2,
  RotateCcw,
  Maximize,
} from "lucide-react-native";
import type {
  AspectPreset,
  EditAction,
  EditState,
  OutputFormat,
} from "./edit-state";

// ── Aspect Chips ─────────────────────────────────────────────────────

const ASPECT_PRESETS: { label: string; value: AspectPreset }[] = [
  { label: "Original", value: "original" },
  { label: "1:1", value: "1:1" },
  { label: "4:5", value: "4:5" },
  { label: "16:9", value: "16:9" },
  { label: "9:16", value: "9:16" },
  { label: "Free", value: "free" },
];

// ── Resize Presets ───────────────────────────────────────────────────

const RESIZE_PRESETS: { label: string; maxEdge?: number }[] = [
  { label: "Original", maxEdge: undefined },
  { label: "1080", maxEdge: 1080 },
  { label: "1440", maxEdge: 1440 },
  { label: "2048", maxEdge: 2048 },
];

// ── Tool Modes ───────────────────────────────────────────────────────

type ToolMode = "none" | "straighten" | "resize";

interface EditToolbarProps {
  state: EditState;
  dispatch: (action: EditAction) => void;
}

export function EditToolbar({ state, dispatch }: EditToolbarProps) {
  const [toolMode, setToolMode] = useState<ToolMode>("none");

  const toggleTool = (mode: ToolMode) => {
    setToolMode((prev) => (prev === mode ? "none" : mode));
  };

  return (
    <View style={styles.container}>
      {/* Aspect chips row */}
      <View style={styles.chipsRow}>
        {ASPECT_PRESETS.map((preset) => (
          <Pressable
            key={preset.value}
            style={[
              styles.chip,
              state.aspect === preset.value && styles.chipActive,
            ]}
            onPress={() =>
              dispatch({ type: "SET_ASPECT", aspect: preset.value })
            }
            hitSlop={4}
          >
            <Text
              style={[
                styles.chipText,
                state.aspect === preset.value && styles.chipTextActive,
              ]}
            >
              {preset.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Primary tools row */}
      <View style={styles.toolsRow}>
        {/* Undo */}
        <Pressable
          style={styles.toolBtn}
          onPress={() => dispatch({ type: "UNDO" })}
          disabled={state.history.undo.length === 0}
          hitSlop={8}
        >
          <Undo2
            size={22}
            color={state.history.undo.length > 0 ? "#fff" : "#555"}
          />
          <Text
            style={[
              styles.toolLabel,
              state.history.undo.length === 0 && styles.toolLabelDisabled,
            ]}
          >
            Undo
          </Text>
        </Pressable>

        {/* Rotate 90° CW */}
        <Pressable
          style={styles.toolBtn}
          onPress={() => dispatch({ type: "ROTATE_CW" })}
          hitSlop={8}
        >
          <RotateCw size={22} color="#fff" />
          <Text style={styles.toolLabel}>Rotate</Text>
        </Pressable>

        {/* Straighten */}
        <Pressable
          style={[
            styles.toolBtn,
            toolMode === "straighten" && styles.toolBtnActive,
          ]}
          onPress={() => toggleTool("straighten")}
          hitSlop={8}
        >
          <RotateCcw
            size={22}
            color={toolMode === "straighten" ? "#3EA4E5" : "#fff"}
          />
          <Text
            style={[
              styles.toolLabel,
              toolMode === "straighten" && styles.toolLabelActive,
            ]}
          >
            Straighten
          </Text>
        </Pressable>

        {/* Flip Horizontal */}
        <Pressable
          style={styles.toolBtn}
          onPress={() => dispatch({ type: "FLIP_X" })}
          hitSlop={8}
        >
          <FlipHorizontal2
            size={22}
            color={state.flipX ? "#3EA4E5" : "#fff"}
          />
          <Text
            style={[
              styles.toolLabel,
              state.flipX && styles.toolLabelActive,
            ]}
          >
            Flip
          </Text>
        </Pressable>

        {/* Resize */}
        <Pressable
          style={[
            styles.toolBtn,
            toolMode === "resize" && styles.toolBtnActive,
          ]}
          onPress={() => toggleTool("resize")}
          hitSlop={8}
        >
          <Maximize
            size={22}
            color={toolMode === "resize" ? "#3EA4E5" : "#fff"}
          />
          <Text
            style={[
              styles.toolLabel,
              toolMode === "resize" && styles.toolLabelActive,
            ]}
          >
            Resize
          </Text>
        </Pressable>

        {/* Redo */}
        <Pressable
          style={styles.toolBtn}
          onPress={() => dispatch({ type: "REDO" })}
          disabled={state.history.redo.length === 0}
          hitSlop={8}
        >
          <Redo2
            size={22}
            color={state.history.redo.length > 0 ? "#fff" : "#555"}
          />
          <Text
            style={[
              styles.toolLabel,
              state.history.redo.length === 0 && styles.toolLabelDisabled,
            ]}
          >
            Redo
          </Text>
        </Pressable>
      </View>

      {/* Straighten slider (only visible when tool selected) */}
      {toolMode === "straighten" && (
        <View style={styles.sliderContainer}>
          <Text style={styles.sliderLabel}>
            {state.straighten > 0 ? "+" : ""}
            {state.straighten.toFixed(1)}°
          </Text>
          <Slider
            style={styles.slider}
            minimumValue={-45}
            maximumValue={45}
            step={0.5}
            value={state.straighten}
            onValueChange={(val: number) =>
              dispatch({ type: "SET_STRAIGHTEN", degrees: val })
            }
            minimumTrackTintColor="#3EA4E5"
            maximumTrackTintColor="#444"
            thumbTintColor="#fff"
          />
          <Pressable
            onPress={() =>
              dispatch({ type: "SET_STRAIGHTEN", degrees: 0 })
            }
            hitSlop={8}
          >
            <Text style={styles.sliderReset}>Reset</Text>
          </Pressable>
        </View>
      )}

      {/* Resize presets (only visible when tool selected) */}
      {toolMode === "resize" && (
        <View style={styles.resizeContainer}>
          <Text style={styles.resizeTitle}>Max Edge</Text>
          <View style={styles.resizeRow}>
            {RESIZE_PRESETS.map((preset) => {
              const isActive = state.output.maxEdge === preset.maxEdge;
              return (
                <Pressable
                  key={preset.label}
                  style={[styles.chip, isActive && styles.chipActive]}
                  onPress={() =>
                    dispatch({
                      type: "SET_OUTPUT",
                      output: { maxEdge: preset.maxEdge },
                    })
                  }
                  hitSlop={4}
                >
                  <Text
                    style={[
                      styles.chipText,
                      isActive && styles.chipTextActive,
                    ]}
                  >
                    {preset.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Format selector */}
          <Text style={[styles.resizeTitle, { marginTop: 10 }]}>Format</Text>
          <View style={styles.resizeRow}>
            {(["jpeg", "png", "webp"] as OutputFormat[]).map((fmt) => {
              const isActive = state.output.format === fmt;
              return (
                <Pressable
                  key={fmt}
                  style={[styles.chip, isActive && styles.chipActive]}
                  onPress={() =>
                    dispatch({ type: "SET_OUTPUT", output: { format: fmt } })
                  }
                  hitSlop={4}
                >
                  <Text
                    style={[
                      styles.chipText,
                      isActive && styles.chipTextActive,
                    ]}
                  >
                    {fmt.toUpperCase()}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Quality slider */}
          <Text style={[styles.resizeTitle, { marginTop: 10 }]}>
            Quality: {Math.round(state.output.quality * 100)}%
          </Text>
          <Slider
            style={styles.slider}
            minimumValue={0.1}
            maximumValue={1}
            step={0.05}
            value={state.output.quality}
            onValueChange={(val: number) =>
              dispatch({
                type: "SET_OUTPUT",
                output: { quality: val },
              })
            }
            minimumTrackTintColor="#3EA4E5"
            maximumTrackTintColor="#444"
            thumbTintColor="#fff"
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 4,
  },
  chipsRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
    marginBottom: 14,
    flexWrap: "wrap",
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "#333",
  },
  chipActive: {
    backgroundColor: "#1a3a52",
    borderColor: "#3EA4E5",
  },
  chipText: {
    color: "#999",
    fontSize: 12,
    fontWeight: "600",
  },
  chipTextActive: {
    color: "#3EA4E5",
  },
  toolsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
  },
  toolBtn: {
    alignItems: "center",
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: 8,
  },
  toolBtnActive: {
    backgroundColor: "rgba(62,164,229,0.1)",
  },
  toolLabel: {
    color: "#ccc",
    fontSize: 10,
    fontWeight: "500",
  },
  toolLabelActive: {
    color: "#3EA4E5",
  },
  toolLabelDisabled: {
    color: "#555",
  },
  sliderContainer: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sliderLabel: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
    width: 48,
    textAlign: "right",
  },
  slider: {
    flex: 1,
    height: 40,
  },
  sliderReset: {
    color: "#3EA4E5",
    fontSize: 13,
    fontWeight: "600",
    paddingHorizontal: 8,
  },
  resizeContainer: {
    marginTop: 12,
    paddingHorizontal: 4,
  },
  resizeTitle: {
    color: "#999",
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  resizeRow: {
    flexDirection: "row",
    gap: 6,
    flexWrap: "wrap",
  },
});
