import {
  View,
  Text,
  TextInput,
  Pressable,
  Platform,
  ActivityIndicator,
  Switch,
  Alert,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useRouter, useLocalSearchParams } from "expo-router";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ArrowLeft,
  MapPin,
  Calendar,
  DollarSign,
  Users,
  Globe,
  Check,
  AlertCircle,
  Camera,
  Clock,
} from "lucide-react-native";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { useState, useCallback, useEffect } from "react";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { Motion } from "@legendapp/motion";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { DB } from "@dvnt/app/lib/supabase/db-map";
import { useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import DateTimePicker from "@react-native-community/datetimepicker";

function EditEventScreenContent() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const eventId = params.id;
  const insets = useSafeAreaInsets();
  const { colors } = useColorScheme();
  const showToast = useUIStore((state) => state.showToast);
  const queryClient = useQueryClient();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [price, setPrice] = useState("");
  const [maxAttendees, setMaxAttendees] = useState("");
  const [isOnline, setIsOnline] = useState(false);
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const [isUploadingCover, setIsUploadingCover] = useState(false);

  // Fetch event data
  useEffect(() => {
    const fetchEvent = async () => {
      if (!eventId) return;

      try {
        setIsFetching(true);
        const { data, error } = await supabase
          .from(DB.events.table)
          .select("*")
          .eq(DB.events.id, eventId)
          .single();

        if (error) throw error;

        if (data) {
          setTitle(data[DB.events.title] || "");
          setDescription(data[DB.events.description] || "");
          setLocation(data[DB.events.location] || "");
          setStartDate(new Date(data[DB.events.startDate]));
          setEndDate(new Date(data[DB.events.endDate]));
          setPrice(data[DB.events.price]?.toString() || "");
          setMaxAttendees(data[DB.events.maxAttendees]?.toString() || "");
          setIsOnline(data[DB.events.isOnline] || false);
          setCoverImageUrl(data[DB.events.coverImageUrl] || "");
        }
      } catch (error) {
        console.error("Error fetching event:", error);
        showToast("error", "Failed to load event");
      } finally {
        setIsFetching(false);
      }
    };

    fetchEvent();
  }, [eventId, showToast]);

  const pickCoverImage = useCallback(async () => {
    try {
      const { status } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        showToast(
          "warning",
          "Permission needed",
          "Please grant photo library access",
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: "images",
        allowsEditing: true,
        aspect: [16, 9],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        setIsUploadingCover(true);
        // TODO: Upload to Supabase Storage
        setCoverImageUrl(result.assets[0].uri);
        setIsUploadingCover(false);
        showToast("success", "Cover image updated! Save to confirm");
      }
    } catch (error) {
      console.error("Error picking image:", error);
      showToast("error", "Failed to pick image");
      setIsUploadingCover(false);
    }
  }, [showToast]);

  const handleSave = useCallback(async () => {
    if (!eventId) {
      showToast("error", "Event ID not found");
      return;
    }

    if (!title.trim()) {
      showToast("error", "Event title is required");
      return;
    }

    if (!description.trim()) {
      showToast("error", "Event description is required");
      return;
    }

    if (endDate < startDate) {
      showToast("error", "End date must be after start date");
      return;
    }

    try {
      setIsLoading(true);

      const { error } = await supabase
        .from(DB.events.table)
        .update({
          [DB.events.title]: title.trim(),
          [DB.events.description]: description.trim(),
          [DB.events.location]: location.trim(),
          [DB.events.startDate]: startDate.toISOString(),
          [DB.events.endDate]: endDate.toISOString(),
          [DB.events.price]: price ? parseFloat(price) : 0,
          [DB.events.maxAttendees]: maxAttendees
            ? parseInt(maxAttendees)
            : null,
          [DB.events.isOnline]: isOnline,
          [DB.events.coverImageUrl]: coverImageUrl || null,
        })
        .eq(DB.events.id, eventId);

      if (error) throw error;

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ["event", eventId] });
      queryClient.invalidateQueries({ queryKey: ["events"] });

      showToast("success", "Event updated successfully");
      router.back();
    } catch (error: any) {
      console.error("Error updating event:", error);
      showToast("error", error.message || "Failed to update event");
    } finally {
      setIsLoading(false);
    }
  }, [
    eventId,
    title,
    description,
    location,
    startDate,
    endDate,
    price,
    maxAttendees,
    isOnline,
    coverImageUrl,
    showToast,
    router,
    queryClient,
  ]);

  const formatDateTime = (date: Date) => {
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  if (isFetching) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Header */}
      <View
        style={{
          paddingTop: insets.top,
          backgroundColor: colors.background,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <View className="flex-row items-center justify-between px-4 py-3">
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <ArrowLeft size={24} color={colors.foreground} />
          </Pressable>
          <Text
            className="text-lg font-semibold"
            style={{ color: colors.foreground }}
          >
            Edit Event
          </Text>
          <Pressable
            onPress={handleSave}
            disabled={isLoading || !title.trim() || !description.trim()}
            className="px-4 py-2 rounded-full"
            style={{
              backgroundColor:
                !title.trim() || !description.trim()
                  ? colors.muted
                  : colors.primary,
              opacity: isLoading ? 0.6 : 1,
            }}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Check size={20} color="#fff" />
            )}
          </Pressable>
        </View>
      </View>

      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 20 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        bottomOffset={40}
      >
        {/* Cover Image */}
        <View className="mb-6">
          <Text
            className="text-sm font-medium mb-2"
            style={{ color: colors.mutedForeground }}
          >
            Cover Image
          </Text>
          <Pressable onPress={pickCoverImage} disabled={isUploadingCover}>
            <Motion.View
              whileTap={{ scale: 0.98 }}
              transition={{ type: "spring", damping: 15, stiffness: 400 }}
              className="rounded-xl overflow-hidden"
              style={{
                height: 180,
                backgroundColor: colors.muted,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              {coverImageUrl ? (
                <Image
                  source={{ uri: coverImageUrl }}
                  className="w-full h-full"
                  contentFit="cover"
                  transition={200}
                />
              ) : (
                <View className="flex-1 items-center justify-center">
                  <Camera size={32} color={colors.mutedForeground} />
                  <Text
                    className="mt-2 text-sm"
                    style={{ color: colors.mutedForeground }}
                  >
                    Add cover image
                  </Text>
                </View>
              )}
              {isUploadingCover && (
                <View className="absolute inset-0 items-center justify-center bg-black/50">
                  <ActivityIndicator size="large" color="#fff" />
                </View>
              )}
            </Motion.View>
          </Pressable>
        </View>

        {/* Title */}
        <View className="mb-5">
          <Text
            className="text-sm font-medium mb-2"
            style={{ color: colors.mutedForeground }}
          >
            Event Title *
          </Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Enter event title"
            placeholderTextColor={colors.mutedForeground}
            className="px-4 py-3 rounded-xl border"
            style={{
              backgroundColor: colors.card,
              borderColor: colors.border,
              color: colors.foreground,
            }}
          />
        </View>

        {/* Description */}
        <View className="mb-5">
          <Text
            className="text-sm font-medium mb-2"
            style={{ color: colors.mutedForeground }}
          >
            Description *
          </Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Describe your event..."
            placeholderTextColor={colors.mutedForeground}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            className="px-4 py-3 rounded-xl border"
            style={{
              backgroundColor: colors.card,
              borderColor: colors.border,
              color: colors.foreground,
              minHeight: 100,
            }}
          />
        </View>

        {/* Start Date */}
        <View className="mb-5">
          <Text
            className="text-sm font-medium mb-2"
            style={{ color: colors.mutedForeground }}
          >
            Start Date & Time
          </Text>
          <Pressable
            onPress={() => setShowStartDatePicker(true)}
            className="flex-row items-center px-4 py-3 rounded-xl border"
            style={{
              backgroundColor: colors.card,
              borderColor: colors.border,
            }}
          >
            <Calendar size={18} color={colors.mutedForeground} />
            <Text className="ml-2" style={{ color: colors.foreground }}>
              {formatDateTime(startDate)}
            </Text>
          </Pressable>
        </View>

        {/* End Date */}
        <View className="mb-5">
          <Text
            className="text-sm font-medium mb-2"
            style={{ color: colors.mutedForeground }}
          >
            End Date & Time
          </Text>
          <Pressable
            onPress={() => setShowEndDatePicker(true)}
            className="flex-row items-center px-4 py-3 rounded-xl border"
            style={{
              backgroundColor: colors.card,
              borderColor: colors.border,
            }}
          >
            <Clock size={18} color={colors.mutedForeground} />
            <Text className="ml-2" style={{ color: colors.foreground }}>
              {formatDateTime(endDate)}
            </Text>
          </Pressable>
        </View>

        {/* Location */}
        <View className="mb-5">
          <Text
            className="text-sm font-medium mb-2"
            style={{ color: colors.mutedForeground }}
          >
            Location
          </Text>
          <View
            className="flex-row items-center px-4 py-3 rounded-xl border"
            style={{
              backgroundColor: colors.card,
              borderColor: colors.border,
            }}
          >
            <MapPin size={18} color={colors.mutedForeground} />
            <TextInput
              value={location}
              onChangeText={setLocation}
              placeholder={isOnline ? "Add meeting link" : "Add venue address"}
              placeholderTextColor={colors.mutedForeground}
              className="flex-1 ml-2"
              style={{ color: colors.foreground }}
              editable={!isOnline}
            />
          </View>
        </View>

        {/* Online Event Toggle */}
        <View
          className="flex-row items-center justify-between p-4 rounded-xl mb-5"
          style={{
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <View className="flex-row items-center gap-2 flex-1">
            <Globe size={20} color={colors.foreground} />
            <View className="flex-1">
              <Text
                className="text-sm font-medium"
                style={{ color: colors.foreground }}
              >
                Online Event
              </Text>
              <Text
                className="text-xs"
                style={{ color: colors.mutedForeground }}
              >
                Event will be hosted virtually
              </Text>
            </View>
          </View>
          <Switch
            value={isOnline}
            onValueChange={setIsOnline}
            trackColor={{ false: colors.muted, true: colors.primary }}
            thumbColor="#fff"
          />
        </View>

        {/* Price */}
        <View className="mb-5">
          <Text
            className="text-sm font-medium mb-2"
            style={{ color: colors.mutedForeground }}
          >
            Price (Optional)
          </Text>
          <View
            className="flex-row items-center px-4 py-3 rounded-xl border"
            style={{
              backgroundColor: colors.card,
              borderColor: colors.border,
            }}
          >
            <DollarSign size={18} color={colors.mutedForeground} />
            <TextInput
              value={price}
              onChangeText={setPrice}
              placeholder="0.00"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="decimal-pad"
              className="flex-1 ml-2"
              style={{ color: colors.foreground }}
            />
          </View>
          <Text
            className="text-xs mt-1"
            style={{ color: colors.mutedForeground }}
          >
            Leave empty for free events
          </Text>
        </View>

        {/* Max Attendees */}
        <View className="mb-5">
          <Text
            className="text-sm font-medium mb-2"
            style={{ color: colors.mutedForeground }}
          >
            Max Attendees (Optional)
          </Text>
          <View
            className="flex-row items-center px-4 py-3 rounded-xl border"
            style={{
              backgroundColor: colors.card,
              borderColor: colors.border,
            }}
          >
            <Users size={18} color={colors.mutedForeground} />
            <TextInput
              value={maxAttendees}
              onChangeText={setMaxAttendees}
              placeholder="Unlimited"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="number-pad"
              className="flex-1 ml-2"
              style={{ color: colors.foreground }}
            />
          </View>
        </View>

        {/* Info */}
        <Motion.View
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "timing", duration: 300 }}
          className="p-4 rounded-xl flex-row gap-3"
          style={{ backgroundColor: colors.muted }}
        >
          <AlertCircle size={20} color={colors.mutedForeground} />
          <View className="flex-1">
            <Text className="text-xs" style={{ color: colors.mutedForeground }}>
              All attendees will be notified of any changes to the event
              details.
            </Text>
          </View>
        </Motion.View>

        <View style={{ height: insets.bottom + 40 }} />
      </KeyboardAwareScrollView>

      {/* Date Pickers */}
      {showStartDatePicker && (
        <DateTimePicker
          value={startDate}
          mode="datetime"
          display="spinner"
          onChange={(event, date) => {
            setShowStartDatePicker(Platform.OS === "ios");
            if (date) setStartDate(date);
          }}
        />
      )}
      {showEndDatePicker && (
        <DateTimePicker
          value={endDate}
          mode="datetime"
          display="spinner"
          onChange={(event, date) => {
            setShowEndDatePicker(Platform.OS === "ios");
            if (date) setEndDate(date);
          }}
        />
      )}
    </View>
  );
}

export default function EditEventScreen() {
  const router = useRouter();
  return (
    <ErrorBoundary screenName="EditEvent" onGoBack={() => router.back()}>
      <EditEventScreenContent />
    </ErrorBoundary>
  );
}
