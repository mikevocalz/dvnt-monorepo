/**
 * ControlsBar Component
 * Floating controls for video room (camera, mic, end call, etc.)
 */

import React from "react";
import { View, Pressable } from "react-native";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  SwitchCamera,
  Users,
  MoreVertical,
} from "lucide-react-native";
import { c } from "./styles";

interface ControlsBarProps {
  isCameraOn: boolean;
  isMicOn: boolean;
  onToggleCamera: () => void;
  onToggleMic: () => void;
  onSwitchCamera: () => void;
  onEndCall: () => void;
  onShowParticipants: () => void;
  onShowMore?: () => void;
  isHost?: boolean;
}

export function ControlsBar({
  isCameraOn,
  isMicOn,
  onToggleCamera,
  onToggleMic,
  onSwitchCamera,
  onEndCall,
  onShowParticipants,
  onShowMore,
  isHost = false,
}: ControlsBarProps) {
  return (
    <View className={c.controlsBarFloating}>
      {/* Mic Toggle */}
      <Pressable
        className={isMicOn ? c.btnIcon : c.btnIconActive}
        onPress={onToggleMic}
        accessibilityLabel={isMicOn ? "Mute microphone" : "Unmute microphone"}
      >
        {isMicOn ? (
          <Mic size={22} color="#fff" />
        ) : (
          <MicOff size={22} color="#fff" />
        )}
      </Pressable>

      {/* Camera Toggle */}
      <Pressable
        className={isCameraOn ? c.btnIcon : c.btnIconActive}
        onPress={onToggleCamera}
        accessibilityLabel={isCameraOn ? "Turn off camera" : "Turn on camera"}
      >
        {isCameraOn ? (
          <Video size={22} color="#fff" />
        ) : (
          <VideoOff size={22} color="#fff" />
        )}
      </Pressable>

      {/* Switch Camera */}
      {isCameraOn && (
        <Pressable
          className={c.btnIcon}
          onPress={onSwitchCamera}
          accessibilityLabel="Switch camera"
        >
          <SwitchCamera size={22} color="#fff" />
        </Pressable>
      )}

      {/* Participants */}
      <Pressable
        className={c.btnIcon}
        onPress={onShowParticipants}
        accessibilityLabel="Show participants"
      >
        <Users size={22} color="#fff" />
      </Pressable>

      {/* More Options (for host/mod) */}
      {onShowMore && (
        <Pressable
          className={c.btnIcon}
          onPress={onShowMore}
          accessibilityLabel="More options"
        >
          <MoreVertical size={22} color="#fff" />
        </Pressable>
      )}

      {/* End Call */}
      <Pressable
        className={c.btnIconDestructive}
        onPress={onEndCall}
        accessibilityLabel={isHost ? "End room" : "Leave room"}
      >
        <PhoneOff size={22} color="#fff" />
      </Pressable>
    </View>
  );
}

export function ControlsBarCompact({
  isCameraOn,
  isMicOn,
  onToggleCamera,
  onToggleMic,
}: Pick<ControlsBarProps, "isCameraOn" | "isMicOn" | "onToggleCamera" | "onToggleMic">) {
  return (
    <View className="flex-row items-center gap-3">
      <Pressable
        className={`w-10 h-10 rounded-full items-center justify-center ${isMicOn ? "bg-muted" : "bg-destructive"}`}
        onPress={onToggleMic}
      >
        {isMicOn ? (
          <Mic size={18} color="#fff" />
        ) : (
          <MicOff size={18} color="#fff" />
        )}
      </Pressable>

      <Pressable
        className={`w-10 h-10 rounded-full items-center justify-center ${isCameraOn ? "bg-muted" : "bg-destructive"}`}
        onPress={onToggleCamera}
      >
        {isCameraOn ? (
          <Video size={18} color="#fff" />
        ) : (
          <VideoOff size={18} color="#fff" />
        )}
      </Pressable>
    </View>
  );
}
