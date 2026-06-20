export interface PlacesBias {
  latitude: number;
  longitude: number;
  radiusMeters?: number;
}

export interface PlacesPrediction {
  placeId: string;
  mainText: string;
  secondaryText?: string;
  fullText?: string;
}

export interface PlacesLocationData {
  name: string;
  formattedAddress?: string;
  latitude?: number;
  longitude?: number;
  placeId?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  addressComponents?: unknown[];
  types?: string[];
}
