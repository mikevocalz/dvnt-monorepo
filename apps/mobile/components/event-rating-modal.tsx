/**
 * Event Rating Modal Component
 *
 * Popup modal for rating an event with 5 stars and optional comment
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, View, Text, Pressable } from "react-native";
import StarRating from "react-native-star-rating-widget";
import { X } from "lucide-react-native";
import { useColorScheme } from "@/lib/hooks";
import { useUIStore } from "@/lib/stores/ui-store";
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";

interface EventRatingModalProps {
  visible: boolean;
  onClose: () => void;
  eventId: string;
  onSubmit: (rating: number, comment?: string) => Promise<void>;
}

export function EventRatingModal({
  visible,
  onClose,
  eventId,
  onSubmit,
}: EventRatingModalProps) {
  const sheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ["68%", "92%"], []);
  const { colors } = useColorScheme();
  const showToast = useUIStore((s) => s.showToast);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      sheetRef.current?.snapToIndex(0);
    } else {
      Keyboard.dismiss();
      sheetRef.current?.close();
    }
  }, [visible]);

  const handleSheetChange = useCallback(
    (index: number) => {
      if (index === -1) {
        if (!isSubmitting) {
          Keyboard.dismiss();
          setRating(0);
          setComment("");
          onClose();
        }
      }
    },
    [onClose, isSubmitting],
  );

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.7}
        pressBehavior="close"
      />
    ),
    [],
  );

  const handleSubmit = () => {
    if (rating === 0) {
      showToast("error", "Rating Required", "Please select a rating");
      return;
    }

    const submittedRating = rating;
    const submittedComment = comment.trim() || undefined;

    // Close immediately — optimistic update in hook handles the rest
    Keyboard.dismiss();
    setRating(0);
    setComment("");
    onClose();
    showToast("success", "Thank You", "Your rating has been submitted");

    // Fire-and-forget — errors are handled by the hook's onError rollback
    onSubmit(submittedRating, submittedComment).catch((error: any) => {
      const errorMessage =
        error?.error || error?.message || "Failed to submit rating";
      showToast("error", "Error", errorMessage);
    });
  };

  const handleClose = () => {
    if (!isSubmitting) {
      Keyboard.dismiss();
      setRating(0);
      setComment("");
      onClose();
    }
  };

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      enablePanDownToClose
      enableBlurKeyboardOnGesture
      backdropComponent={renderBackdrop}
      onChange={handleSheetChange}
      backgroundStyle={{
        backgroundColor: colors.card,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
      }}
      handleIndicatorStyle={{
        backgroundColor: "rgba(255,255,255,0.3)",
        width: 36,
      }}
      keyboardBehavior="extend"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
    >
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 20,
          paddingTop: 4,
          paddingBottom: 12,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <Text
          style={{
            fontSize: 20,
            fontWeight: "600",
            color: colors.foreground,
          }}
        >
          Rate This Event
        </Text>
        <Pressable onPress={handleClose} hitSlop={12} disabled={isSubmitting}>
          <X size={24} color={colors.mutedForeground} />
        </Pressable>
      </View>

      <BottomSheetScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {/* Rating Section */}
        <View style={{ alignItems: "center", marginBottom: 24 }}>
          <Text
            style={{
              fontSize: 16,
              fontWeight: "500",
              color: colors.foreground,
              marginBottom: 16,
            }}
          >
            How was your experience?
          </Text>
          <StarRating
            rating={rating}
            onChange={(value: number) => setRating(value)}
            starSize={40}
            color="#FFD700"
            emptyColor="#E5E5E5"
            step="full"
            enableSwiping={true}
          />
        </View>

        {/* Comment Section */}
        <View style={{ marginBottom: 24 }}>
          <Text
            style={{
              fontSize: 14,
              fontWeight: "500",
              color: colors.foreground,
              marginBottom: 8,
            }}
          >
            Add a comment (optional)
          </Text>
          <BottomSheetTextInput
            value={comment}
            onChangeText={setComment}
            placeholder="Share your thoughts about this event..."
            placeholderTextColor={colors.mutedForeground}
            onFocus={() => sheetRef.current?.snapToIndex(1)}
            multiline
            numberOfLines={4}
            maxLength={1000}
            returnKeyType="done"
            blurOnSubmit
            onSubmitEditing={() => Keyboard.dismiss()}
            style={{
              backgroundColor: colors.background,
              borderRadius: 12,
              padding: 12,
              color: colors.foreground,
              fontSize: 14,
              minHeight: 100,
              textAlignVertical: "top",
              borderWidth: 1,
              borderColor: colors.border,
            }}
            editable={!isSubmitting}
          />
          <Text
            style={{
              fontSize: 12,
              color: colors.mutedForeground,
              marginTop: 4,
              textAlign: "right",
            }}
          >
            {comment.length}/1000
          </Text>
        </View>

        {/* Submit Button */}
        <Pressable
          onPress={handleSubmit}
          disabled={isSubmitting || rating === 0}
          style={{
            backgroundColor:
              rating === 0 || isSubmitting ? colors.muted : colors.primary,
            paddingVertical: 14,
            borderRadius: 12,
            alignItems: "center",
            opacity: rating === 0 || isSubmitting ? 0.5 : 1,
          }}
        >
          <Text
            style={{
              fontSize: 16,
              fontWeight: "600",
              color:
                rating === 0 || isSubmitting ? colors.mutedForeground : "#fff",
            }}
          >
            {isSubmitting ? "Submitting..." : "Submit Rating"}
          </Text>
        </Pressable>
      </BottomSheetScrollView>
    </BottomSheet>
  );
}
