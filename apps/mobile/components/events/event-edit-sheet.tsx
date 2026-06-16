import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import {
  View,
  Text,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Platform,
  StyleSheet,
} from "react-native";
import BottomSheet, {
  BottomSheetView,
  BottomSheetBackdrop,
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import {
  X,
  Check,
  Calendar,
  Clock,
  MapPin,
  Image as ImageIcon,
  Plus,
  Video,
} from "lucide-react-native";
import { Image } from "expo-image";
import { DateTimePicker } from "@dvnt/ui/expo";
import { eventsApi, formatEventDate } from "@/lib/api/events";
import {
  propagateEntity,
  queryContainsEntity,
  snapshotMatchingQueries,
  rollback,
} from "@/lib/cache/propagate";
import { getCurrentUserAuthId } from "@/lib/api/auth-helper";
import { useUIStore } from "@/lib/stores/ui-store";
import { useMediaPicker } from "@/lib/hooks";
import { useMediaUpload } from "@/lib/hooks/use-media-upload";
import { useQueryClient } from "@tanstack/react-query";
import { eventKeys, useUpdateEvent } from "@/lib/hooks/use-events";
import {
  isRemoteMediaUri,
  persistLocalMediaSelection,
} from "@/lib/media/persist-local-selection";

interface EventEditSheetProps {
  visible: boolean;
  onClose: () => void;
  eventId: string;
  initialData: {
    title: string;
    description: string;
    location: string;
    fullDate: string;
    endDate?: string;
    image: string;
    images?: string[];
    dressCode?: string;
    doorPolicy?: string;
    entryWindow?: string;
    lineup?: string;
    perks?: string;
    youtubeVideoUrl?: string;
    price?: number;
    maxAttendees?: number;
  } | null;
}

export function EventEditSheet({
  visible,
  onClose,
  eventId,
  initialData,
}: EventEditSheetProps) {
  const bottomSheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ["92%"], []);
  const queryClient = useQueryClient();
  const updateEventMutation = useUpdateEvent();
  const showToast = useUIStore((s) => s.showToast);
  const { pickFromLibrary } = useMediaPicker();
  const { uploadMultiple, isUploading } = useMediaUpload({ folder: "events" });

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [eventDate, setEventDate] = useState(new Date());
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [eventImages, setEventImages] = useState<string[]>([]);
  const [dressCode, setDressCode] = useState("");
  const [doorPolicy, setDoorPolicy] = useState("");
  const [entryWindow, setEntryWindow] = useState("");
  const [lineup, setLineup] = useState("");
  const [perks, setPerks] = useState("");
  const [youtubeVideoUrl, setYoutubeVideoUrl] = useState("");
  const [price, setPrice] = useState("");
  const [maxAttendees, setMaxAttendees] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);
  const [showEndTimePicker, setShowEndTimePicker] = useState(false);

  // Populate form from initialData
  useEffect(() => {
    if (!initialData) return;
    setTitle(initialData.title || "");
    setDescription(initialData.description || "");
    setLocation(initialData.location || "");
    setDressCode(initialData.dressCode || "");
    setDoorPolicy(initialData.doorPolicy || "");
    setEntryWindow(initialData.entryWindow || "");
    setLineup(typeof initialData.lineup === "string" ? initialData.lineup : "");
    setPerks(typeof initialData.perks === "string" ? initialData.perks : "");
    setYoutubeVideoUrl(initialData.youtubeVideoUrl || "");
    setPrice(initialData.price ? String(initialData.price) : "0");
    setMaxAttendees(
      initialData.maxAttendees ? String(initialData.maxAttendees) : "",
    );

    if (initialData.fullDate) {
      try {
        setEventDate(new Date(initialData.fullDate));
      } catch {}
    }
    if (initialData.endDate) {
      try {
        setEndDate(new Date(initialData.endDate));
      } catch {}
    }

    const imgs: string[] = [];
    if (initialData.image) imgs.push(initialData.image);
    if (initialData.images && Array.isArray(initialData.images)) {
      initialData.images.forEach((img: any) => {
        const url = typeof img === "string" ? img : img?.url;
        if (url && !imgs.includes(url)) imgs.push(url);
      });
    }
    setEventImages(imgs);
  }, [initialData]);

  useEffect(() => {
    if (visible) {
      bottomSheetRef.current?.snapToIndex(0);
    } else {
      bottomSheetRef.current?.close();
    }
  }, [visible]);

  const handleSheetChange = useCallback(
    (index: number) => {
      if (index === -1) onClose();
    },
    [onClose],
  );

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.6}
        pressBehavior="close"
      />
    ),
    [],
  );

  const persistEventDraftAssets = useCallback(
    async (
      assets: Array<{
        uri: string;
        fileName?: string;
        mimeType?: string;
      }>,
    ) =>
      Promise.all(
        assets.map((asset) =>
          persistLocalMediaSelection(asset.uri, {
            scope: "event-drafts/images",
            fileName: asset.fileName,
            mimeType: asset.mimeType,
          }),
        ),
      ),
    [],
  );

  const handlePickImages = useCallback(async () => {
    const remaining = 5 - eventImages.length;
    if (remaining <= 0) return;
    const result = await pickFromLibrary({
      maxSelection: remaining,
      allowsMultipleSelection: remaining > 1,
    });
    if (result && result.length > 0) {
      try {
        const persistedUris = await persistEventDraftAssets(result);
        setEventImages((prev) => [...prev, ...persistedUris].slice(0, 5));
      } catch (error) {
        console.error("[EventEditSheet] Failed to persist images:", error);
        showToast(
          "error",
          "Media Error",
          "Failed to add the selected images. Please try again.",
        );
      }
    }
  }, [eventImages.length, persistEventDraftAssets, pickFromLibrary, showToast]);

  const removeImage = useCallback((index: number) => {
    setEventImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleDateChange = useCallback(
    (_event: unknown, selectedDate?: Date) => {
      setShowDatePicker(false);
      if (selectedDate) {
        const newDate = new Date(eventDate);
        newDate.setFullYear(selectedDate.getFullYear());
        newDate.setMonth(selectedDate.getMonth());
        newDate.setDate(selectedDate.getDate());
        setEventDate(newDate);
      }
    },
    [eventDate],
  );

  const handleTimeChange = useCallback(
    (_event: unknown, selectedTime?: Date) => {
      setShowTimePicker(false);
      if (selectedTime) {
        const newDate = new Date(eventDate);
        newDate.setHours(selectedTime.getHours());
        newDate.setMinutes(selectedTime.getMinutes());
        setEventDate(newDate);
      }
    },
    [eventDate],
  );

  const handleEndDateChange = useCallback(
    (_event: unknown, selectedDate?: Date) => {
      setShowEndDatePicker(false);
      if (selectedDate) {
        const d = endDate ? new Date(endDate) : new Date(eventDate);
        d.setFullYear(selectedDate.getFullYear());
        d.setMonth(selectedDate.getMonth());
        d.setDate(selectedDate.getDate());
        setEndDate(d);
      }
    },
    [endDate, eventDate],
  );

  const handleEndTimeChange = useCallback(
    (_event: unknown, selectedTime?: Date) => {
      setShowEndTimePicker(false);
      if (selectedTime) {
        const d = endDate ? new Date(endDate) : new Date(eventDate);
        d.setHours(selectedTime.getHours());
        d.setMinutes(selectedTime.getMinutes());
        setEndDate(d);
      }
    },
    [endDate, eventDate],
  );

  const formatDate = (date: Date) =>
    date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  const formatTime = (date: Date) =>
    date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

  const handleSave = useCallback(async () => {
    if (!eventId || isSaving) return;
    if (!title.trim()) {
      showToast("error", "Error", "Title is required");
      return;
    }

    setIsSaving(true);
    try {
      // Upload new local images first (we need the CDN URLs for the optimistic patch)
      const normalizedImages = await Promise.all(
        eventImages.map((uri) =>
          isRemoteMediaUri(uri)
            ? Promise.resolve(uri)
            : persistLocalMediaSelection(uri, { scope: "event-drafts/images" }),
        ),
      );
      setEventImages(normalizedImages);

      const localImages = normalizedImages.filter((uri) => !isRemoteMediaUri(uri));
      const remoteImages = normalizedImages.filter((uri) => isRemoteMediaUri(uri));

      let uploadedImages: string[] = [];
      if (localImages.length > 0) {
        const mediaFiles = localImages.map((uri) => ({
          uri,
          type: "image" as const,
        }));
        const uploadResults = await uploadMultiple(mediaFiles);
        uploadedImages = uploadResults
          .filter((r) => r.success && r.url)
          .map((r) => r.url!);
      }

      const allImages = [...remoteImages, ...uploadedImages];

      const updateData: Record<string, unknown> = {
        title: title.trim(),
        description: description.trim(),
        location: location.trim(),
        startDate: eventDate.toISOString(),
        price: Number(price) || 0,
      };

      if (endDate) updateData.endDate = endDate.toISOString();
      if (allImages.length > 0) {
        updateData.coverImage = allImages[0];
        updateData.images = allImages.slice(1).map((url) => ({ url }));
      }
      if (maxAttendees) updateData.maxAttendees = Number(maxAttendees) || 0;
      updateData.dressCode = dressCode.trim() || null;
      updateData.doorPolicy = doorPolicy.trim() || null;
      updateData.lineup = lineup.trim() || null;
      updateData.perks = perks.trim() || null;
      updateData.youtubeVideoUrl = youtubeVideoUrl.trim() || null;

      // ── Optimistic update: patch every cache that contains this event ──
      // Derive the same display-format fields the API normally computes
      // (date = day number, month = "FEB", time = "8:00 PM"). Without
      // these, event cards keep showing the OLD day/month/time until a
      // refetch lands and the edit feels like it didn't take.
      const dateParts = formatEventDate(updateData.startDate as string);
      const optimisticPatch: Record<string, unknown> = {
        title: updateData.title,
        description: updateData.description,
        location: updateData.location,
        ...dateParts,
        endDate: updateData.endDate ?? null,
        price: updateData.price,
        maxAttendees: updateData.maxAttendees ?? null,
        dressCode: updateData.dressCode ?? null,
        doorPolicy: updateData.doorPolicy ?? null,
        lineup: updateData.lineup ?? null,
        perks: updateData.perks ?? null,
        youtubeVideoUrl: updateData.youtubeVideoUrl ?? null,
      };
      if (allImages.length > 0) {
        optimisticPatch.image = allImages[0];
        optimisticPatch.images = allImages.slice(1).map((url) => ({ url }));
      }

      // Snapshot for rollback, then propagate across every query that
      // references this event — event detail, event-list queries (feed,
      // upcoming, past, byCategory, search, forYou, profile-hosted),
      // ticket caches that nest event metadata, etc. Predicate-based
      // means new screens that show an event card pick up the patch
      // automatically without us listing their query keys here.
      const eventPredicate = queryContainsEntity("event", eventId);
      const snapshot = snapshotMatchingQueries(queryClient, eventPredicate);
      propagateEntity(queryClient, "event", eventId, optimisticPatch);

      showToast("success", "Event updated", "");
      onClose();

      // ── Background: persist to server through the mutation hook so
      // its own buildEventCachePatch propagation also lands (covers
      // any cache reference shape the local optimisticPatch missed
      // and replaces with authoritative server data on success).
      updateEventMutation.mutate(
        { eventId, updates: updateData },
        {
          onError: (err: any) => {
            console.error("[EventEditSheet] Background save error:", err);
            rollback(queryClient, snapshot);
            queryClient.invalidateQueries({ queryKey: eventKeys.all });
            showToast(
              "error",
              "Save failed",
              err?.message || "Changes could not be saved. Please try again.",
            );
          },
        },
      );
    } catch (error: any) {
      console.error("[EventEditSheet] Save error:", error);
      showToast(
        "error",
        "Event save failed",
        error?.message || "Check your connection and try again.",
      );
    } finally {
      setIsSaving(false);
    }
  }, [
    eventId,
    title,
    description,
    location,
    eventDate,
    endDate,
    eventImages,
    price,
    maxAttendees,
    dressCode,
    doorPolicy,
    lineup,
    perks,
    youtubeVideoUrl,
    isSaving,
    uploadMultiple,
    queryClient,
    showToast,
    onClose,
  ]);

  if (!visible) return null;

  return (
    <BottomSheet
      ref={bottomSheetRef}
      index={0}
      snapPoints={snapPoints}
      enablePanDownToClose
      enableOverDrag={false}
      onChange={handleSheetChange}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.background}
      handleIndicatorStyle={styles.handle}
      style={{ zIndex: 9999, elevation: 9999 }}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
    >
      <BottomSheetView style={styles.headerRow}>
        <Pressable onPress={onClose} hitSlop={12}>
          <X size={22} color="#71717a" />
        </Pressable>
        <Text style={styles.headerTitle}>Edit Event</Text>
        <Pressable
          onPress={handleSave}
          disabled={isSaving || isUploading}
          hitSlop={12}
          style={{ opacity: isSaving || isUploading ? 0.5 : 1 }}
        >
          {isSaving || isUploading ? (
            <ActivityIndicator size="small" color="#3FDCFF" />
          ) : (
            <Check size={22} color="#3FDCFF" />
          )}
        </Pressable>
      </BottomSheetView>

      <BottomSheetScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Cover & Gallery Images */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Images</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.imageRow}>
              {eventImages.map((uri, index) => (
                <View key={`img-${index}`} style={styles.imageThumb}>
                  <Image
                    source={{ uri }}
                    style={styles.imageThumbImg}
                    contentFit="cover"
                  />
                  <Pressable
                    onPress={() => removeImage(index)}
                    style={styles.imageRemove}
                  >
                    <X size={12} color="#fff" />
                  </Pressable>
                  {index === 0 && (
                    <View style={styles.coverBadge}>
                      <Text style={styles.coverBadgeText}>Cover</Text>
                    </View>
                  )}
                </View>
              ))}
              {eventImages.length < 5 && (
                <Pressable
                  onPress={handlePickImages}
                  style={styles.addImageBtn}
                >
                  <Plus size={22} color="#71717a" />
                </Pressable>
              )}
            </View>
          </ScrollView>
        </View>

        {/* Title */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Title *</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Event title"
            placeholderTextColor="#52525b"
            maxLength={100}
            style={styles.input}
          />
        </View>

        {/* Description */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Description</Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Describe your event..."
            placeholderTextColor="#52525b"
            multiline
            maxLength={2000}
            style={[styles.input, styles.inputMultiline]}
          />
        </View>

        {/* Location */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Location</Text>
          <View style={styles.inputWithIcon}>
            <MapPin size={18} color="#71717a" />
            <TextInput
              value={location}
              onChangeText={setLocation}
              placeholder="Event location"
              placeholderTextColor="#52525b"
              style={styles.inputInner}
            />
          </View>
        </View>

        {/* Start Date & Time */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Start Date & Time</Text>
          <View style={styles.dateRow}>
            <Pressable
              onPress={() => setShowDatePicker(true)}
              style={styles.dateBtn}
            >
              <Calendar size={18} color="#3FDCFF" />
              <Text style={styles.dateBtnText}>{formatDate(eventDate)}</Text>
            </Pressable>
            <Pressable
              onPress={() => setShowTimePicker(true)}
              style={styles.dateBtn}
            >
              <Clock size={18} color="#3FDCFF" />
              <Text style={styles.dateBtnText}>{formatTime(eventDate)}</Text>
            </Pressable>
          </View>
        </View>

        {/* End Date & Time */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>End Date & Time</Text>
          <View style={styles.dateRow}>
            <Pressable
              onPress={() => setShowEndDatePicker(true)}
              style={styles.dateBtn}
            >
              <Calendar size={18} color="#8A40CF" />
              <Text style={styles.dateBtnText}>
                {endDate ? formatDate(endDate) : "Set end date"}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setShowEndTimePicker(true)}
              style={styles.dateBtn}
            >
              <Clock size={18} color="#8A40CF" />
              <Text style={styles.dateBtnText}>
                {endDate ? formatTime(endDate) : "Set end time"}
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Price & Max Attendees */}
        <View style={styles.inlineRow}>
          <View style={[styles.fieldGroup, { flex: 1 }]}>
            <Text style={styles.label}>Price ($)</Text>
            <TextInput
              value={price}
              onChangeText={setPrice}
              placeholder="0"
              placeholderTextColor="#52525b"
              keyboardType="numeric"
              style={styles.input}
            />
          </View>
          <View style={[styles.fieldGroup, { flex: 1 }]}>
            <Text style={styles.label}>Max Attendees</Text>
            <TextInput
              value={maxAttendees}
              onChangeText={setMaxAttendees}
              placeholder="200"
              placeholderTextColor="#52525b"
              keyboardType="numeric"
              style={styles.input}
            />
          </View>
        </View>

        {/* Dress Code */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Dress Code</Text>
          <TextInput
            value={dressCode}
            onChangeText={setDressCode}
            placeholder="e.g. Business casual, All white..."
            placeholderTextColor="#52525b"
            style={styles.input}
          />
        </View>

        {/* Door Policy */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Door Policy</Text>
          <TextInput
            value={doorPolicy}
            onChangeText={setDoorPolicy}
            placeholder="e.g. 21+, Guest list only..."
            placeholderTextColor="#52525b"
            style={styles.input}
          />
        </View>

        {/* Entry Window */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Entry Window</Text>
          <TextInput
            value={entryWindow}
            onChangeText={setEntryWindow}
            placeholder="e.g. Doors open 8PM, last entry 11PM"
            placeholderTextColor="#52525b"
            style={styles.input}
          />
        </View>

        {/* Lineup */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Lineup</Text>
          <TextInput
            value={lineup}
            onChangeText={setLineup}
            placeholder="DJ names, performers, etc."
            placeholderTextColor="#52525b"
            multiline
            style={[styles.input, styles.inputMultiline]}
          />
        </View>

        {/* Perks */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>What's Included</Text>
          <TextInput
            value={perks}
            onChangeText={setPerks}
            placeholder="Open bar, food, valet parking..."
            placeholderTextColor="#52525b"
            multiline
            style={[styles.input, styles.inputMultiline]}
          />
        </View>

        {/* YouTube Video URL */}
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>YouTube Video</Text>
          <View style={styles.inputWithIcon}>
            <Video size={18} color="#71717a" />
            <TextInput
              value={youtubeVideoUrl}
              onChangeText={setYoutubeVideoUrl}
              placeholder="https://youtube.com/watch?v=..."
              placeholderTextColor="#52525b"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={styles.inputInner}
            />
            {youtubeVideoUrl.trim() !== "" && (
              <Pressable onPress={() => setYoutubeVideoUrl("")} hitSlop={8}>
                <X size={16} color="#71717a" />
              </Pressable>
            )}
          </View>
        </View>

        <View style={{ height: 60 }} />
      </BottomSheetScrollView>

      {/* Date/Time Pickers */}
      {showDatePicker && (
        <DateTimePicker
          value={eventDate}
          mode="date"
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={handleDateChange}
        />
      )}
      {showTimePicker && (
        <DateTimePicker
          value={eventDate}
          mode="time"
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={handleTimeChange}
        />
      )}
      {showEndDatePicker && (
        <DateTimePicker
          value={endDate || eventDate}
          mode="date"
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={handleEndDateChange}
        />
      )}
      {showEndTimePicker && (
        <DateTimePicker
          value={endDate || eventDate}
          mode="time"
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={handleEndTimeChange}
        />
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  background: {
    backgroundColor: "#111",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  handle: {
    backgroundColor: "#555",
    width: 40,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#fff",
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
  },
  fieldGroup: {
    marginBottom: 20,
  },
  label: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 12,
    padding: 14,
    color: "#fff",
    fontSize: 15,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  inputMultiline: {
    minHeight: 90,
    textAlignVertical: "top",
  },
  inputWithIcon: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    gap: 10,
  },
  inputInner: {
    flex: 1,
    paddingVertical: 14,
    color: "#fff",
    fontSize: 15,
  },
  dateRow: {
    flexDirection: "row",
    gap: 10,
  },
  dateBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  dateBtnText: {
    color: "#fff",
    fontSize: 14,
  },
  inlineRow: {
    flexDirection: "row",
    gap: 12,
  },
  imageRow: {
    flexDirection: "row",
    gap: 10,
    paddingVertical: 4,
  },
  imageThumb: {
    width: 80,
    height: 80,
    borderRadius: 12,
    overflow: "hidden",
    position: "relative",
  },
  imageThumbImg: {
    width: 80,
    height: 80,
  },
  imageRemove: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center",
    justifyContent: "center",
  },
  coverBadge: {
    position: "absolute",
    bottom: 4,
    left: 4,
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  coverBadgeText: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "700",
  },
  addImageBtn: {
    width: 80,
    height: 80,
    borderRadius: 12,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
});
