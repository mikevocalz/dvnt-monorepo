// ============================================================
// Instagram Stories Editor - Main Toolbar
// ============================================================

import React from 'react';
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
  Dimensions,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  SlideInRight,
  SlideOutRight,
} from 'react-native-reanimated';
import { EditorMode } from '../../types';
import { EDITOR_COLORS } from '../../constants';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface ToolbarProps {
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export const MainToolbar: React.FC<ToolbarProps> = ({
  mode,
  onModeChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}) => {
  const tools = [
    { id: 'text' as EditorMode, icon: 'Aa', label: 'Text' },
    { id: 'drawing' as EditorMode, icon: '✏️', label: 'Draw' },
    { id: 'sticker' as EditorMode, icon: '😊', label: 'Stickers' },
    { id: 'filter' as EditorMode, icon: '✨', label: 'Filters' },
    { id: 'adjust' as EditorMode, icon: '🎛️', label: 'Adjust' },
  ];

  return (
    <Animated.View
      style={styles.container}
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(200)}
    >
      {/* Top Bar */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.topButton}
          onPress={onUndo}
          disabled={!canUndo}
        >
          <Text style={[styles.topButtonText, !canUndo && styles.disabled]}>
            ↩
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.topButton}
          onPress={onRedo}
          disabled={!canRedo}
        >
          <Text style={[styles.topButtonText, !canRedo && styles.disabled]}>
            ↪
          </Text>
        </TouchableOpacity>
      </View>

      {/* Side Tool Rail */}
      <Animated.View
        style={styles.sideRail}
        entering={SlideInRight.duration(300)}
        exiting={SlideOutRight.duration(200)}
      >
        {tools.map((tool) => (
          <TouchableOpacity
            key={tool.id}
            style={[
              styles.toolButton,
              mode === tool.id && styles.toolButtonActive,
            ]}
            onPress={() =>
              onModeChange(mode === tool.id ? 'idle' : tool.id)
            }
          >
            <Text style={styles.toolIcon}>{tool.icon}</Text>
            <Text
              style={[
                styles.toolLabel,
                mode === tool.id && styles.toolLabelActive,
              ]}
            >
              {tool.label}
            </Text>
          </TouchableOpacity>
        ))}
      </Animated.View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'space-between',
    pointerEvents: 'box-none',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingTop: 60,
    paddingHorizontal: 16,
    gap: 12,
  },
  topButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: EDITOR_COLORS.overlay,
    justifyContent: 'center',
    alignItems: 'center',
  },
  topButtonText: {
    color: EDITOR_COLORS.text,
    fontSize: 22,
  },
  disabled: {
    opacity: 0.3,
  },
  sideRail: {
    position: 'absolute',
    right: 12,
    top: '25%',
    gap: 8,
  },
  toolButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: EDITOR_COLORS.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  toolButtonActive: {
    backgroundColor: EDITOR_COLORS.primary,
    transform: [{ scale: 1.1 }],
  },
  toolIcon: {
    fontSize: 22,
    color: EDITOR_COLORS.text,
  },
  toolLabel: {
    fontSize: 8,
    color: EDITOR_COLORS.textSecondary,
    marginTop: 2,
    fontWeight: '600',
  },
  toolLabelActive: {
    color: EDITOR_COLORS.text,
  },
});
