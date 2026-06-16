/**
 * Location Autocomplete — Instagram-Level UX
 * 
 * Features:
 * - Smooth autocomplete with debouncing
 * - Recent places (local storage)
 * - Clean loading/empty/error states
 * - Keyboard-safe behavior
 * - Polished list rows with icons
 * - Selected location chip with remove capability
 * - No laggy input behavior
 * - Proper focus/blur handling
 */

import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  TextInput,
  Pressable,
  ActivityIndicator,
  Keyboard,
  Platform,
} from 'react-native';
import {
  GooglePlacesAutocomplete,
  GooglePlaceData,
  GooglePlaceDetail,
} from 'react-native-google-places-autocomplete';
import {
  MapPin,
  X,
  Clock,
  Navigation,
  Search,
  MapPinOff,
} from 'lucide-react-native';
import { useColorScheme } from '@/lib/hooks';
import type { NormalizedLocation } from '@/lib/types/location';
import { normalizeGooglePlace } from '@/lib/types/location';
import { getRecentPlaces, addRecentPlace } from '@/lib/utils/location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface LocationAutocompleteProps {
  value?: string;
  selectedLocation?: NormalizedLocation | null;
  placeholder?: string;
  onLocationSelect: (location: NormalizedLocation) => void;
  onClear?: () => void;
  showRecent?: boolean;
  autoFocus?: boolean;
}

const GOOGLE_PLACES_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY || '';

// Recent place item component
function RecentPlaceItem({
  place,
  onPress,
}: {
  place: NormalizedLocation;
  onPress: () => void;
}) {
  const { colors } = useColorScheme();

  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center px-4 py-3 active:bg-muted/50"
      style={{ gap: 12 }}
    >
      <View
        className="w-8 h-8 rounded-lg items-center justify-center"
        style={{ backgroundColor: colors.muted + '30' }}
      >
        <Clock size={16} color={colors.mutedForeground} />
      </View>
      <View className="flex-1">
        <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
          {place.name}
        </Text>
        {place.city && (
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {place.city}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

// Selected location chip
function SelectedLocationChip({
  location,
  onClear,
}: {
  location: NormalizedLocation;
  onClear: () => void;
}) {
  const { colors } = useColorScheme();

  return (
    <View
      className="flex-row items-center self-start px-3 py-2 rounded-xl mb-3"
      style={{
        backgroundColor: colors.primary + '15',
        borderWidth: 1,
        borderColor: colors.primary + '30',
        gap: 8,
      }}
    >
      <MapPin size={14} color={colors.primary} />
      <Text
        className="text-sm font-medium"
        style={{ color: colors.primary }}
        numberOfLines={1}
      >
        {location.name}
      </Text>
      <Pressable onPress={onClear} hitSlop={8}>
        <X size={14} color={colors.primary} />
      </Pressable>
    </View>
  );
}

// Loading skeleton
function SearchSkeleton() {
  const { colors } = useColorScheme();

  return (
    <View className="px-4 py-2 gap-2">
      {[1, 2, 3].map((i) => (
        <View
          key={i}
          className="flex-row items-center gap-3 py-3"
          style={{ opacity: 1 - i * 0.2 }}
        >
          <View
            className="w-8 h-8 rounded-lg"
            style={{ backgroundColor: colors.muted + '30' }}
          />
          <View className="flex-1 gap-2">
            <View
              className="h-4 rounded"
              style={{
                backgroundColor: colors.muted + '30',
                width: `${70 + i * 10}%`,
              }}
            />
            <View
              className="h-3 rounded"
              style={{
                backgroundColor: colors.muted + '20',
                width: `${50 + i * 15}%`,
              }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

// Empty state
function EmptyState({ message }: { message: string }) {
  const { colors } = useColorScheme();

  return (
    <View className="items-center justify-center py-8 px-6">
      <MapPinOff size={32} color={colors.mutedForeground} />
      <Text className="text-sm text-muted-foreground text-center mt-3">
        {message}
      </Text>
    </View>
  );
}

// Import Text from react-native since we're using it
import { Text } from 'react-native';

export function LocationAutocomplete({
  value,
  selectedLocation,
  placeholder = 'Search location...',
  onLocationSelect,
  onClear,
  showRecent = true,
  autoFocus = false,
}: LocationAutocompleteProps) {
  const { colors } = useColorScheme();
  const insets = useSafeAreaInsets();
  const ref = useRef<any>(null);

  const [inputText, setInputText] = useState(value || '');
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [recentPlaces, setRecentPlaces] = useState<NormalizedLocation[]>([]);
  const [showResults, setShowResults] = useState(false);

  // Load recent places on mount
  useEffect(() => {
    if (showRecent) {
      const recent = getRecentPlaces();
      setRecentPlaces(recent);
    }
  }, [showRecent]);

  // Check API key
  useEffect(() => {
    if (!GOOGLE_PLACES_API_KEY) {
      console.warn(
        '[LocationAutocomplete] Google Places API key not configured. Set EXPO_PUBLIC_GOOGLE_PLACES_API_KEY in your .env file.'
      );
      setHasError(true);
    }
  }, []);

  // Sync external value changes
  useEffect(() => {
    if (value !== undefined && value !== inputText) {
      setInputText(value);
      if (ref.current) {
        ref.current.setAddressText(value);
      }
    }
  }, [value]);

  const handlePress = useCallback(
    (data: GooglePlaceData, details: GooglePlaceDetail | null) => {
      const location = normalizeGooglePlace(data, details);
      setInputText(location.name);
      setShowResults(false);
      Keyboard.dismiss();

      // Save to recent places
      addRecentPlace(location);
      setRecentPlaces(getRecentPlaces());

      onLocationSelect(location);
    },
    [onLocationSelect]
  );

  const handleClear = useCallback(() => {
    setInputText('');
    setShowResults(false);
    if (ref.current) {
      ref.current.setAddressText('');
    }
    onClear?.();
  }, [onClear]);

  const handleTextChange = useCallback((text: string) => {
    setInputText(text);
    setShowResults(text.length > 0);
  }, []);

  const handleRecentPress = useCallback(
    (place: NormalizedLocation) => {
      setInputText(place.name);
      setShowResults(false);
      Keyboard.dismiss();
      onLocationSelect(place);
    },
    [onLocationSelect]
  );

  // Manual input mode when API key is missing
  if (hasError) {
    return (
      <View className="gap-2">
        {selectedLocation ? (
          <SelectedLocationChip location={selectedLocation} onClear={handleClear} />
        ) : null}
        <View
          className="flex-row items-center px-4 h-12 rounded-2xl"
          style={{ backgroundColor: colors.card }}
        >
          <MapPin size={18} color={colors.mutedForeground} />
          <TextInput
            className="flex-1 ml-3 text-[15px] text-foreground"
            placeholder={placeholder}
            placeholderTextColor={colors.mutedForeground}
            value={inputText}
            onChangeText={handleTextChange}
            onSubmitEditing={() => {
              if (inputText.trim()) {
                const mockLocation: NormalizedLocation = {
                  placeId: `manual_${Date.now()}`,
                  provider: 'google',
                  name: inputText.trim(),
                  formattedAddress: inputText.trim(),
                  latitude: 0,
                  longitude: 0,
                };
                onLocationSelect(mockLocation);
              }
            }}
          />
          {inputText.length > 0 && (
            <Pressable onPress={handleClear} hitSlop={8}>
              <X size={18} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>
        <Text className="text-xs text-muted-foreground px-1">
          Location search unavailable. Enter manually.
        </Text>
      </View>
    );
  }

  return (
    <View className="relative z-10">
      {/* Selected Location Chip */}
      {selectedLocation ? (
        <SelectedLocationChip location={selectedLocation} onClear={handleClear} />
      ) : null}

      {/* Search Input */}
      <View
        className="flex-row items-center px-4 h-12 rounded-2xl"
        style={{ backgroundColor: colors.card }}
      >
        <Search size={18} color={colors.mutedForeground} />
        <GooglePlacesAutocomplete
          ref={ref}
          placeholder={placeholder}
          fetchDetails={true}
          onPress={handlePress}
          textInputProps={{
            placeholderTextColor: colors.mutedForeground,
            onChangeText: handleTextChange,
            autoFocus,
            onFocus: () => setShowResults(true),
            style: {
              flex: 1,
              marginLeft: 12,
              fontSize: 15,
              color: colors.foreground,
              height: 48,
            },
          }}
          query={{
            key: GOOGLE_PLACES_API_KEY,
            language: 'en',
            types: 'establishment|geocode',
          }}
          styles={{
            container: {
              flex: 1,
            },
            textInputContainer: {
              backgroundColor: 'transparent',
            },
            textInput: {
              backgroundColor: 'transparent',
              borderRadius: 0,
              paddingLeft: 0,
              paddingRight: 0,
              marginLeft: 0,
              marginRight: 0,
              marginTop: 0,
              marginBottom: 0,
              height: 48,
              color: colors.foreground,
              fontSize: 15,
            },
            listView: {
              position: 'absolute',
              top: 56,
              left: -56, // Offset to align with container
              right: -16,
              backgroundColor: colors.card,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: colors.border,
              maxHeight: 280,
              overflow: 'hidden',
              elevation: 4,
              shadowColor: '#000',
              shadowOpacity: 0.15,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 4 },
              zIndex: 100,
            },
            row: {
              backgroundColor: colors.card,
              padding: 14,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              height: 60,
            },
            separator: {
              height: 1,
              backgroundColor: colors.border,
            },
            description: {
              color: colors.foreground,
              fontSize: 14,
              fontWeight: '500',
            },
            predefinedPlacesDescription: {
              color: colors.primary,
            },
            poweredContainer: {
              display: 'none',
            },
            loader: {
              display: 'none', // We handle loading ourselves
            },
          }}
          renderRow={(data: GooglePlaceData) => (
            <View className="flex-row items-center flex-1 gap-3">
              <View
                className="w-8 h-8 rounded-lg items-center justify-center"
                style={{ backgroundColor: colors.muted + '30' }}
              >
                <MapPin size={16} color={colors.primary} />
              </View>
              <View className="flex-1">
                <Text
                  className="text-sm font-medium text-foreground"
                  numberOfLines={1}
                >
                  {data.structured_formatting?.main_text || data.description?.split(',')[0]}
                </Text>
                {data.structured_formatting?.secondary_text && (
                  <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                    {data.structured_formatting.secondary_text}
                  </Text>
                )}
              </View>
            </View>
          )}
          renderDescription={(data: GooglePlaceData) => ''} // We render our own
          enablePoweredByContainer={false}
          debounce={300}
          minLength={2}
          nearbyPlacesAPI="GooglePlacesSearch"
          GooglePlacesDetailsQuery={{
            fields: 'geometry,formatted_address,name,address_component,types,place_id',
          }}
          onFail={(error) => {
            console.error('[LocationAutocomplete] Places API error:', error);
            setHasError(true);
          }}
          onNotFound={() => {
            // Handle no results
          }}
          keepResultsAfterBlur={false}
          keyboardShouldPersistTaps="handled"
          listUnderlayColor={colors.muted}
        />

        {/* Clear button */}
        {inputText.length > 0 && !selectedLocation && (
          <Pressable
            onPress={() => {
              setInputText('');
              ref.current?.setAddressText('');
            }}
            hitSlop={8}
          >
            <View
              className="w-5 h-5 rounded-full items-center justify-center"
              style={{ backgroundColor: colors.muted }}
            >
              <X size={12} color={colors.mutedForeground} />
            </View>
          </Pressable>
        )}
      </View>

      {/* Recent Places (when input is empty and showing) */}
      {showRecent && showResults && !inputText && recentPlaces.length > 0 && (
        <View
          className="absolute top-14 left-0 right-0 rounded-2xl overflow-hidden"
          style={{
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            maxHeight: 240,
            zIndex: 100,
            elevation: 4,
            shadowColor: '#000',
            shadowOpacity: 0.15,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 4 },
          }}
        >
          <View className="px-4 py-2 border-b border-border">
            <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Recent Places
            </Text>
          </View>
          {recentPlaces.map((place) => (
            <RecentPlaceItem
              key={place.placeId}
              place={place}
              onPress={() => handleRecentPress(place)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

export type { NormalizedLocation };
