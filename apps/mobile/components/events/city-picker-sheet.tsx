import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  View,
  Text,
  Pressable,
  TextInput,
  ActivityIndicator,
} from "react-native";
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetFlatList,
} from "@gorhom/bottom-sheet";
import { MapPin, Search, Navigation, Clock, Check } from "lucide-react-native";
import { GlassSheetBackground } from "@/components/sheets/glass-sheet-background";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import { useCities, useCitySearch } from "@/lib/hooks/use-cities";
import {
  useEventsLocationStore,
  type City,
} from "@/lib/stores/events-location-store";

interface CityPickerSheetProps {
  visible: boolean;
  onDismiss: () => void;
}

export const CityPickerSheet: React.FC<CityPickerSheetProps> = ({
  visible,
  onDismiss,
}) => {
  const sheetRef = useRef<BottomSheetModal>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [requestingLocation, setRequestingLocation] = useState(false);

  const activeCity = useEventsLocationStore((s) => s.activeCity);
  const setActiveCity = useEventsLocationStore((s) => s.setActiveCity);
  const recentCities = useEventsLocationStore((s) => s.recentCities);
  const setDeviceLocation = useEventsLocationStore((s) => s.setDeviceLocation);
  const setLocationMode = useEventsLocationStore((s) => s.setLocationMode);

  const { data: allCities = [], isLoading: citiesLoading } = useCities();
  const { data: searchResults = [] } = useCitySearch(searchQuery);

  const snapPoints = useMemo(() => ["70%"], []);

  // Present/dismiss the modal based on visible prop
  useEffect(() => {
    if (visible) {
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [visible]);

  const handleSheetChange = useCallback(
    (index: number) => {
      if (index === -1) onDismiss();
    },
    [onDismiss],
  );

  const handleSelectCity = useCallback(
    (city: City) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setActiveCity(city);
      setLocationMode("city");
      onDismiss();
    },
    [setActiveCity, setLocationMode, onDismiss],
  );

  const handleUseDeviceLocation = useCallback(async () => {
    setRequestingLocation(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setRequestingLocation(false);
        return;
      }
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setDeviceLocation(location.coords.latitude, location.coords.longitude);
      setLocationMode("device");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Find nearest city
      let nearestCity: City | null = null;
      let minDist = Infinity;
      for (const city of allCities) {
        const dist = Math.sqrt(
          Math.pow(city.lat - location.coords.latitude, 2) +
            Math.pow(city.lng - location.coords.longitude, 2),
        );
        if (dist < minDist) {
          minDist = dist;
          nearestCity = city;
        }
      }
      if (nearestCity) setActiveCity(nearestCity);
      onDismiss();
    } catch (err) {
      console.error("[CityPicker] Location error:", err);
    } finally {
      setRequestingLocation(false);
    }
  }, [allCities, setDeviceLocation, setLocationMode, setActiveCity, onDismiss]);

  const displayCities = searchQuery.length > 0 ? searchResults : allCities;

  const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.5}
        pressBehavior="close"
      />
    ),
    [],
  );

  const renderCity = useCallback(
    ({ item }: { item: City }) => {
      const isActive = activeCity?.id === item.id;
      return (
        <Pressable
          onPress={() => handleSelectCity(item)}
          className="flex-row items-center px-5 py-3.5 gap-3"
          style={
            isActive ? { backgroundColor: "rgba(62,164,229,0.08)" } : undefined
          }
        >
          <View
            className="w-10 h-10 rounded-xl items-center justify-center"
            style={{
              backgroundColor: isActive
                ? "rgba(62,164,229,0.15)"
                : "rgba(255,255,255,0.06)",
            }}
          >
            <MapPin
              size={18}
              color={isActive ? "#3EA4E5" : "#888"}
              strokeWidth={2}
            />
          </View>
          <View className="flex-1">
            <Text
              className="text-base font-semibold"
              style={{ color: isActive ? "#3EA4E5" : "#fff" }}
            >
              {item.name}
            </Text>
            {item.state && (
              <Text className="text-xs text-neutral-500">{item.state}</Text>
            )}
          </View>
          {isActive && <Check size={18} color="#3EA4E5" strokeWidth={2.5} />}
        </Pressable>
      );
    },
    [activeCity, handleSelectCity],
  );

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      onChange={handleSheetChange}
      backdropComponent={renderBackdrop}
      enablePanDownToClose
      detached={true}
      bottomInset={46}
      style={{ marginHorizontal: 16, zIndex: 9999, elevation: 9999 }}
      backgroundComponent={GlassSheetBackground}
      handleIndicatorStyle={{
        backgroundColor: "#555",
        width: 36,
        height: 4,
      }}
    >
      {/* Header */}
      <View className="px-5 pb-3">
        <Text className="text-xl font-bold text-white mb-3">Choose City</Text>

        {/* Search */}
        <View className="flex-row items-center bg-neutral-800/80 rounded-xl px-4 py-2.5 gap-2 mb-3">
          <Search size={16} color="#888" strokeWidth={2} />
          <TextInput
            className="flex-1 text-white text-[15px]"
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search cities..."
            placeholderTextColor="#666"
            autoCapitalize="words"
          />
        </View>

        {/* Device Location button */}
        <Pressable
          onPress={handleUseDeviceLocation}
          disabled={requestingLocation}
          className="flex-row items-center gap-3 py-3 px-1"
        >
          <View className="w-10 h-10 rounded-xl items-center justify-center bg-blue-500/15">
            {requestingLocation ? (
              <ActivityIndicator size="small" color="#3EA4E5" />
            ) : (
              <Navigation size={18} color="#3EA4E5" strokeWidth={2} />
            )}
          </View>
          <Text className="text-[15px] font-semibold text-blue-400">
            Use My Location
          </Text>
        </Pressable>

        {/* Recent cities */}
        {recentCities.length > 0 && searchQuery.length === 0 && (
          <View className="mt-1 mb-2">
            <View className="flex-row items-center gap-1.5 mb-2">
              <Clock size={12} color="#666" strokeWidth={2} />
              <Text className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                Recent
              </Text>
            </View>
            <View className="flex-row flex-wrap gap-2">
              {recentCities.map((city) => (
                <Pressable
                  key={city.id}
                  onPress={() => handleSelectCity(city)}
                  className="px-3.5 py-2 rounded-full border"
                  style={{
                    borderColor:
                      activeCity?.id === city.id
                        ? "rgba(62,164,229,0.5)"
                        : "rgba(255,255,255,0.1)",
                    backgroundColor:
                      activeCity?.id === city.id
                        ? "rgba(62,164,229,0.1)"
                        : "rgba(255,255,255,0.04)",
                  }}
                >
                  <Text
                    className="text-sm font-medium"
                    style={{
                      color: activeCity?.id === city.id ? "#3EA4E5" : "#ccc",
                    }}
                  >
                    {city.name}, {city.state}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
      </View>

      {/* City List */}
      {citiesLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#3EA4E5" />
        </View>
      ) : (
        <BottomSheetFlatList
          data={displayCities}
          keyExtractor={(item: City) => String(item.id)}
          renderItem={renderCity}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
        />
      )}
    </BottomSheetModal>
  );
};
