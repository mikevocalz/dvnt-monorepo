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
  /** Straight-line meters from the request's origin, when one was sent. */
  distanceMeters?: number;
}

/** Point Google measures `distanceMeters` from. Never moves ranking. */
export interface PlacesOrigin {
  latitude: number;
  longitude: number;
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
