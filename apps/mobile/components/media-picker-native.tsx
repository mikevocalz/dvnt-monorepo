import { View, Text, Pressable, Dimensions } from "react-native";
import { LegendList } from "@/components/list";
import { Image } from "expo-image";
import { Camera, Image as ImageIcon, Video, X } from "lucide-react-native";
import { useMediaPicker, type MediaAsset } from "@/lib/hooks/use-media-picker";
import { useEffect } from "react";

const SCREEN_WIDTH = Dimensions.get("window").width;
const NUM_COLUMNS = 4;
const ITEM_SIZE = (SCREEN_WIDTH - 8) / NUM_COLUMNS;

interface MediaPickerNativeProps {
  selectedMedia: MediaAsset[];
  onMediaSelected: (media: MediaAsset[]) => void;
  maxSelection?: number;
}

export function MediaPickerNative({
  selectedMedia,
  onMediaSelected,
  maxSelection = 10,
}: MediaPickerNativeProps) {
  const { pickFromLibrary, takePhoto, recordVideo, requestPermissions } =
    useMediaPicker();

  useEffect(() => {
    // Request permissions on mount
    (async () => {
      await requestPermissions();
    })();
  }, []);

  const handlePickLibrary = async () => {
    const media = await pickFromLibrary({
      maxSelection,
      allowsMultipleSelection: true,
    });
    if (media) {
      onMediaSelected([...selectedMedia, ...media]);
    }
  };

  const handleTakePhoto = async () => {
    const media = await takePhoto();
    if (media) {
      onMediaSelected([...selectedMedia, media]);
    }
  };

  const handleRecordVideo = async () => {
    const media = await recordVideo();
    if (media) {
      onMediaSelected([...selectedMedia, media]);
    }
  };

  const handleRemove = (id: string) => {
    onMediaSelected(selectedMedia.filter((item) => item.id !== id));
  };

  const renderMediaItem = ({
    item,
    index,
  }: {
    item: MediaAsset;
    index: number;
  }) => (
    <View style={{ width: ITEM_SIZE, height: ITEM_SIZE, padding: 2 }}>
      <View className="relative h-full w-full overflow-hidden rounded-lg bg-muted">
        <Image
          source={{ uri: item.uri }}
          style={{ width: "100%", height: "100%" }}
          contentFit="cover"
        />
        {item.type === "video" && (
          <View className="absolute bottom-1 left-1">
            <Video size={16} color="white" />
          </View>
        )}
        <Pressable
          onPress={() => handleRemove(item.id)}
          className="absolute right-1 top-1 h-6 w-6 items-center justify-center rounded-full bg-black/70"
        >
          <X size={14} color="white" />
        </Pressable>
        <View className="absolute right-1 bottom-1 h-6 w-6 items-center justify-center rounded-full bg-primary">
          <Text className="text-xs font-bold text-primary-foreground">
            {index + 1}
          </Text>
        </View>
      </View>
    </View>
  );

  return (
    <View className="flex-1">
      {/* Action Buttons */}
      <View className="flex-row gap-3 border-b border-border p-4">
        <Pressable
          onPress={handlePickLibrary}
          className="flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3"
        >
          <ImageIcon size={20} color="white" />
          <Text className="font-semibold text-primary-foreground">Library</Text>
        </Pressable>
        <Pressable
          onPress={handleTakePhoto}
          className="flex-1 flex-row items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-3"
        >
          <Camera size={20} color="#666" />
          <Text className="font-semibold">Photo</Text>
        </Pressable>
        <Pressable
          onPress={handleRecordVideo}
          className="flex-1 flex-row items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-3"
        >
          <Video size={20} color="#666" />
          <Text className="font-semibold">Video</Text>
        </Pressable>
      </View>

      {/* Selected Media Grid */}
      {selectedMedia.length > 0 && (
        <View className="border-b border-border p-2">
          <Text className="mb-2 px-2 text-sm font-semibold text-muted-foreground">
            Selected ({selectedMedia.length}/{maxSelection})
          </Text>
          <LegendList
            data={selectedMedia}
            renderItem={renderMediaItem}
            keyExtractor={(item) => item.id}
            numColumns={NUM_COLUMNS}
            scrollEnabled={false}
            estimatedItemSize={ITEM_SIZE}
          />
        </View>
      )}

      {/* Instructions */}
      {selectedMedia.length === 0 && (
        <View className="flex-1 items-center justify-center p-8">
          <ImageIcon size={64} color="#ccc" />
          <Text className="mt-4 text-center text-muted-foreground">
            Select photos and videos from your library or capture new ones
          </Text>
        </View>
      )}
    </View>
  );
}
