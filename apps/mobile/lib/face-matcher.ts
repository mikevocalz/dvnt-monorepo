// Face comparison utility for React Native using Regula Face SDK
// Compares face in ID document with selfie for identity verification

// ── Safe import of @regulaforensics/react-native-face-api ─────────────
let FaceSDK: any = null;
let MatchFacesRequest: any = null;
let MatchFacesImage: any = null;
let MatchFacesResponse: any = null;
let ImageType: any = null;
try {
  const faceApi = require("@regulaforensics/react-native-face-api");
  FaceSDK = faceApi.default;
  MatchFacesRequest = faceApi.MatchFacesRequest;
  MatchFacesImage = faceApi.MatchFacesImage;
  MatchFacesResponse = faceApi.MatchFacesResponse;
  ImageType = faceApi.ImageType;
} catch {
  console.warn(
    "[FaceMatcher] @regulaforensics/react-native-face-api not available in this binary",
  );
}
import * as FileSystem from "expo-file-system/legacy";

// Convert file URI to base64
async function fileToBase64(uri: string): Promise<string> {
  try {
    // Normalize the URI
    const normalizedUri = uri.startsWith("file://") ? uri : `file://${uri}`;
    const base64 = await FileSystem.readAsStringAsync(normalizedUri, {
      encoding: "base64",
    });
    return base64;
  } catch (error) {
    console.error("[FaceMatcher] Error converting file to base64:", error);
    throw new Error("Failed to read image file");
  }
}

export interface FaceComparisonResult {
  match: boolean;
  confidence: number;
  distance: number;
}

let sdkInitialized = false;

// Promisify callback-based SDK methods
function promisify<T>(
  fn: (successCb: (result: T) => void, errorCb: (error: any) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    fn(resolve, reject);
  });
}

// Initialize the Face SDK
async function initializeFaceSDK(): Promise<void> {
  console.log(
    "[FaceMatcher] initializeFaceSDK called, current state:",
    sdkInitialized,
  );

  if (sdkInitialized) {
    console.log("[FaceMatcher] SDK already initialized, skipping");
    return;
  }

  try {
    console.log("[FaceMatcher] Checking if SDK is already initialized...");
    const isInit = await promisify<string>((success, error) =>
      FaceSDK.isInitialized(success, error),
    );
    console.log("[FaceMatcher] isInitialized result:", isInit);
    if (isInit === "true") {
      sdkInitialized = true;
      console.log("[FaceMatcher] SDK was already initialized");
      return;
    }
  } catch (checkError) {
    console.log(
      "[FaceMatcher] isInitialized check failed (expected if not init):",
      checkError,
    );
    // Not initialized, continue to initialize
  }

  try {
    console.log("[FaceMatcher] Initializing Regula Face SDK...");
    const initResult = await promisify<string>((success, error) =>
      FaceSDK.initialize(null, success, error),
    );
    console.log("[FaceMatcher] SDK initialize result:", initResult);
    sdkInitialized = true;
    console.log("[FaceMatcher] Face SDK initialized successfully");
  } catch (error: any) {
    console.error("[FaceMatcher] Failed to initialize Face SDK:", error);
    console.error("[FaceMatcher] Error details:", JSON.stringify(error));
    throw new Error(
      `Failed to initialize face verification: ${error?.message || error}`,
    );
  }
}

// Compare two faces using Regula Face SDK
export async function compareFaces(
  idImageUri: string,
  selfieImageUri: string,
): Promise<FaceComparisonResult> {
  if (!FaceSDK) {
    throw new Error("Face verification is not available in this app version.");
  }
  console.log("[FaceMatcher] Starting face comparison...");
  console.log("[FaceMatcher] ID Image:", idImageUri?.substring(0, 50));
  console.log("[FaceMatcher] Selfie Image:", selfieImageUri?.substring(0, 50));

  if (!idImageUri) {
    throw new Error(
      "No face detected in ID document. Please upload a valid ID with a clear photo.",
    );
  }

  if (!selfieImageUri) {
    throw new Error(
      "No face detected in selfie. Please take a clear photo of your face.",
    );
  }

  try {
    // Initialize SDK if needed
    await initializeFaceSDK();

    // Convert file URIs to base64
    console.log("[FaceMatcher] Converting images to base64...");
    const idBase64 = await fileToBase64(idImageUri);
    const selfieBase64 = await fileToBase64(selfieImageUri);
    console.log("[FaceMatcher] Images converted successfully");

    // Create image objects for comparison
    const idImage = new MatchFacesImage();
    idImage.image = idBase64;
    idImage.imageType = ImageType.PRINTED;

    const selfieImage = new MatchFacesImage();
    selfieImage.image = selfieBase64;
    selfieImage.imageType = ImageType.LIVE;

    // Create match request with both images
    const request = new MatchFacesRequest();
    request.images = [idImage, selfieImage];

    console.log("[FaceMatcher] Sending match request to Regula SDK...");

    // Perform face matching with timeout
    const matchPromise = promisify<string>((success, error) =>
      FaceSDK.matchFaces(request as any, null, success, error),
    );
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Face matching timed out. Please try again.")),
        30000,
      ),
    );

    const responseJson = await Promise.race([matchPromise, timeoutPromise]);
    const response = MatchFacesResponse.fromJson(JSON.parse(responseJson));

    if (!response || !response.results || response.results.length === 0) {
      throw new Error(
        "No face match results returned. Please ensure both images contain clear faces.",
      );
    }

    const matchResult = response.results[0];
    const similarity = matchResult.similarity ?? 0;

    // Convert similarity (0-1) to confidence percentage
    const confidence = similarity * 100;

    // Distance is inverse of similarity
    const distance = 1 - similarity;

    // Match threshold: 65% similarity
    // Lowered from 75% to accommodate real-world appearance changes
    // (facial hair, glasses, aging, lighting) between ID photo and selfie
    const MATCH_THRESHOLD = 0.65;
    const match = similarity >= MATCH_THRESHOLD;

    console.log("[FaceMatcher] Face verification result:", {
      similarity: similarity.toFixed(4),
      confidence: confidence.toFixed(1) + "%",
      distance: distance.toFixed(4),
      match,
      threshold: MATCH_THRESHOLD,
      verdict: match ? "SAME PERSON" : "DIFFERENT PEOPLE",
    });

    // Additional check: reject low confidence matches
    if (match && confidence < 50) {
      console.log("[FaceMatcher] Match rejected due to low confidence");
      return {
        match: false,
        confidence: Math.round(confidence * 10) / 10,
        distance: Math.round(distance * 1000) / 1000,
      };
    }

    return {
      match,
      confidence: Math.round(confidence * 10) / 10,
      distance: Math.round(distance * 1000) / 1000,
    };
  } catch (error: any) {
    console.error("[FaceMatcher] Face verification error:", error);

    // Provide helpful error messages
    if (error.message?.includes("No face")) {
      throw error;
    }

    throw new Error(
      error.message ||
        "Face verification failed. Please ensure both images are clear and well-lit.",
    );
  }
}

// Detect if an image contains a human face using Regula SDK
export async function detectFaceFromImage(imageUri: string): Promise<boolean> {
  if (!FaceSDK || !imageUri) return false;

  try {
    await initializeFaceSDK();

    const image = new MatchFacesImage();
    image.image = imageUri;
    image.imageType = ImageType.LIVE;

    const request = new MatchFacesRequest();
    request.images = [image];

    const responseJson = await promisify<string>((success, error) =>
      FaceSDK.matchFaces(request as any, null, success, error),
    );
    const response = MatchFacesResponse.fromJson(JSON.parse(responseJson));

    // If we get detections, a face was detected
    return response?.detections !== undefined && response.detections.length > 0;
  } catch (error) {
    console.error("[FaceMatcher] Face detection error:", error);
    return false;
  }
}
