import { useRef, useEffect, useState, useCallback } from "react";
import { View, StyleSheet, Text, TextInput, Pressable } from "react-native";
import {
  GooglePlacesAutocomplete,
  GooglePlaceData,
  GooglePlaceDetail,
} from "react-native-google-places-autocomplete";
import { MapPin, AlertCircle, X } from "lucide-react-native";
import { useColorScheme } from "@/lib/hooks";
import { useDebounce } from "@/lib/hooks/use-debounce";

interface LocationData {
  name: string;
  latitude?: number;
  longitude?: number;
  placeId?: string;
}

interface LocationAutocompleteProps {
  value?: string;
  placeholder?: string;
  onLocationSelect: (location: LocationData) => void;
  onClear?: () => void;
  onTextChange?: (text: string) => void;
}

const GOOGLE_PLACES_API_KEY =
  process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY || "";

// Debug: Log the API key status
console.log(
  "[LocationAutocomplete] API Key:",
  GOOGLE_PLACES_API_KEY ? "Present" : "Missing",
);
console.log(
  "[LocationAutocomplete] API Key Length:",
  GOOGLE_PLACES_API_KEY.length,
);

export function LocationAutocomplete({
  value,
  placeholder = "Search location...",
  onLocationSelect,
  onClear,
  onTextChange,
}: LocationAutocompleteProps) {
  const { colors } = useColorScheme();
  const ref = useRef<any>(null);
  const [inputText, setInputText] = useState(value || "");
  const [hasError, setHasError] = useState(false);

  // Debounce the input text for callbacks (300ms delay)
  const debouncedText = useDebounce(inputText, 300);

  // Check if API key is configured
  useEffect(() => {
    console.log("[LocationAutocomplete] Checking API key configuration...");
    if (
      !GOOGLE_PLACES_API_KEY ||
      GOOGLE_PLACES_API_KEY === "your_google_places_api_key_here"
    ) {
      console.warn(
        "[LocationAutocomplete] Google Places API key not configured or using placeholder. Using manual input mode.",
      );
      setHasError(true);
    } else {
      console.log("[LocationAutocomplete] API key configured successfully");
    }
  }, []);

  // Call onTextChange with debounced value
  useEffect(() => {
    if (debouncedText) {
      if (onTextChange) {
        onTextChange(debouncedText);
      } else {
        onLocationSelect({ name: debouncedText });
      }
    } else if (!debouncedText && onClear) {
      onClear();
    }
  }, [debouncedText]);

  // Sync external value changes
  useEffect(() => {
    if (value !== undefined && value !== inputText) {
      setInputText(value);
      // Update the GooglePlacesAutocomplete internal value
      if (ref.current) {
        ref.current.setAddressText(value);
      }
    }
  }, [value]);

  const handlePress = (
    data: GooglePlaceData,
    details: GooglePlaceDetail | null,
  ) => {
    const locationName =
      data.description ||
      details?.formatted_address ||
      details?.name ||
      inputText;
    const locationData: LocationData = {
      name: locationName,
      placeId: data.place_id,
      latitude: details?.geometry?.location?.lat,
      longitude: details?.geometry?.location?.lng,
    };
    setInputText(locationName);
    onLocationSelect(locationData);
  };

  // Just update local state - debounced effect handles callbacks
  const handleTextChange = useCallback((text: string) => {
    setInputText(text);
  }, []);

  // Show manual input when API key is missing or invalid
  if (hasError) {
    return (
      <View
        style={[
          styles.container,
          {
            backgroundColor: colors.card,
            borderRadius: 16,
            paddingHorizontal: 12,
            flexDirection: "row",
            alignItems: "center",
          },
        ]}
      >
        <MapPin size={18} color={colors.mutedForeground} />
        <TextInput
          style={{
            flex: 1,
            height: 48,
            color: colors.foreground,
            fontSize: 15,
            marginLeft: 8,
          }}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          value={inputText}
          onChangeText={handleTextChange}
          onSubmitEditing={() => {
            if (inputText.trim()) {
              const locationData: LocationData = {
                name: inputText.trim(),
              };
              onLocationSelect(locationData);
            }
          }}
        />
        {inputText.length > 0 && (
          <Pressable onPress={() => setInputText("")} hitSlop={8}>
            <X size={18} color={colors.mutedForeground} />
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <GooglePlacesAutocomplete
        ref={ref}
        placeholder={placeholder}
        fetchDetails={true}
        onPress={handlePress}
        textInputProps={{
          placeholderTextColor: colors.mutedForeground,
          onChangeText: handleTextChange,
        }}
        query={{
          key: GOOGLE_PLACES_API_KEY,
          language: "en",
          types: "establishment|geocode|address",
          components: "country:us", // Restrict to US for better results
          region: "us",
          // Use newer Places API
          fields: "formatted_address,name,geometry,place_id",
        }}
        onFail={(error) => {
          console.error(
            "[LocationAutocomplete] Google Places API error:",
            error,
          );
          setHasError(true);
        }}
        onNotFound={() => {
          console.log("[LocationAutocomplete] No results found");
        }}
        styles={{
          container: {
            flex: 0,
          },
          textInputContainer: {
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: colors.card,
            borderRadius: 16,
            paddingHorizontal: 12,
          },
          textInput: {
            flex: 1,
            height: 48,
            color: colors.foreground,
            fontSize: 15,
            backgroundColor: "transparent",
            marginLeft: 8,
          },
          listView: {
            backgroundColor: colors.card,
            borderRadius: 12,
            marginTop: 8,
            borderWidth: 1,
            borderColor: colors.border,
          },
          row: {
            backgroundColor: colors.card,
            padding: 14,
            flexDirection: "row",
            alignItems: "center",
          },
          separator: {
            height: 1,
            backgroundColor: colors.border,
          },
          description: {
            color: colors.foreground,
            fontSize: 14,
          },
          poweredContainer: {
            display: "none",
          },
        }}
        renderLeftButton={() => (
          <MapPin size={18} color={colors.mutedForeground} />
        )}
        enablePoweredByContainer={false}
        debounce={300}
        minLength={2}
        nearbyPlacesAPI="GooglePlacesSearch"
        GooglePlacesDetailsQuery={{
          fields: "geometry,formatted_address,name",
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    zIndex: 10,
  },
});

export type { LocationData };
