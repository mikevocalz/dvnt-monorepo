import { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  Linking,
  Platform,
  PermissionsAndroid,
  ScrollView,
  InteractionManager,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { VisionCamera } from "react-native-vision-camera";
import {
  Button,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui";
import { useSignupStore } from "@/lib/stores/signup-store";
import { useVerificationStore } from "@/lib/stores/useVerificationStore";
import { useAuthStore } from "@/lib/stores/auth-store";
import {
  CheckCircle2,
  CreditCard,
  Camera,
  ShieldAlert,
  ArrowLeft,
  ArrowRight,
} from "lucide-react-native";
import { IdScanTab, FaceScanTab } from "@/components/verification/tabs";
import { useUIStore } from "@/lib/stores/ui-store";
import { compareFaces } from "@/lib/face-matcher";
import { compareDOBs } from "@/lib/dob-extractor";
import { signUp } from "@/lib/auth-client";
import { auth } from "@/lib/api/auth";
import { syncAuthUser } from "@/lib/api/privileged";
import { toast } from "sonner-native";
import {
  validateDateOfBirth,
  UNDERAGE_ERROR_MESSAGE,
  AGE_VERIFICATION_FAILED_MESSAGE,
} from "@/lib/utils/age-verification";
import { AppTrace, getErrorMessage } from "@/lib/diagnostics/app-trace";
import { getLynkDisplayName } from "@/lib/branding/lynk-branding";

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `${label} timed out after ${ms / 1000}s. Check your connection and try again.`,
            ),
          ),
        ms,
      ),
    ),
  ]);
}

export function SignUpStep2() {
  const {
    idVerification,
    formData,
    setIDImage,
    setFaceImage,
    setVerified,
    setExtractedDOB,
    setActiveStep,
    isSubmitting,
    setIsSubmitting,
    resetSignup,
  } = useSignupStore();
  const {
    idComplete,
    faceComplete,
    idImageUri,
    faceImageUri,
    parsedId,
    reset: resetVerification,
  } = useVerificationStore();
  const { setUser } = useAuthStore();
  const showToast = useUIStore((s) => s.showToast);
  const { verificationTab } = useLocalSearchParams<{
    verificationTab?: string;
  }>();
  const [activeTab, setActiveTab] = useState<"id" | "selfie">(
    verificationTab === "selfie" ? "selfie" : "id",
  );
  const [isVerifying, setIsVerifying] = useState(false);
  const [permissionsGranted, setPermissionsGranted] = useState(false);
  const [matchConfidence, setMatchConfidence] = useState<number | null>(null);
  const [dobMismatch, setDobMismatch] = useState<string | null>(null);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [manualReviewSubmitted, setManualReviewSubmitted] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (verificationTab === "selfie") {
      setActiveTab("selfie");
      return;
    }

    if (verificationTab === "id") {
      setActiveTab("id");
    }
  }, [verificationTab]);

  // Record terms acceptance - calls API directly
  const recordTermsAcceptance = async (userId: string, email: string) => {
    try {
      const _rawApiUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
      const API_URL =
        typeof _rawApiUrl === "string" && _rawApiUrl.startsWith("https://")
          ? _rawApiUrl
          : "https://npfjanxturvmjyevoyfo.supabase.co";

      await fetch(`${API_URL}/rest/v1/terms_acceptance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "omit",
        body: JSON.stringify({
          userId,
          email,
          acceptedAt: new Date().toISOString(),
          termsVersion: "1.0",
          acceptedPolicies: [
            "terms-of-service",
            "privacy-policy",
            "community-standards",
            "verification-requirements",
          ],
        }),
      });
    } catch (error) {
      console.error("[Signup] Failed to record terms acceptance:", error);
    }
  };

  // Create account after verification succeeds
  const createAccount = async () => {
    setIsSubmitting(true);
    const startedAt = Date.now();
    AppTrace.trace("SIGNUP", "account_create_started", {
      verified: idVerification.isVerified,
      reviewPending: manualReviewSubmitted,
    });

    console.log("[SignUp] Creating account with Better Auth...");
    console.log("[SignUp] Email:", formData.email);
    console.log("[SignUp] Username:", formData.username);

    try {
      // Sign up with Better Auth
      const { data, error } = await withTimeout(
        signUp.email({
          email: formData.email,
          password: formData.password,
          name: `${formData.firstName} ${formData.lastName}`,
          username: formData.username,
          firstName: formData.firstName,
          lastName: formData.lastName,
        } as any),
        25000,
        "Account creation",
      );

      if (error) {
        console.error("[SignUp] Better Auth error:", error);
        AppTrace.error("SIGNUP", "account_create_auth_failed", {
          elapsedMs: Date.now() - startedAt,
          error: error.message || "Better Auth signup failed",
        });
        toast.error("Registration Failed", {
          description: error.message || "Could not create account",
        });
        return;
      }

      if (!data?.user) {
        console.error("[SignUp] No user returned from Better Auth");
        AppTrace.error("SIGNUP", "account_create_missing_user", {
          elapsedMs: Date.now() - startedAt,
        });
        toast.error("Registration Failed", {
          description: "Could not create account",
        });
        return;
      }

      console.log("[SignUp] Better Auth user created:", data.user.id);

      // Sync user to app's users table (creates row if new signup)
      // Retry once on failure — edge function cold starts can cause the first call to timeout
      let profile;
      try {
        profile = await withTimeout(syncAuthUser(), 15000, "Profile sync");
        console.log("[SignUp] User synced, ID:", profile.id);
      } catch (syncError) {
        console.warn(
          "[SignUp] syncAuthUser attempt 1 failed, retrying:",
          syncError,
        );
        try {
          profile = await withTimeout(
            syncAuthUser(),
            15000,
            "Profile sync retry",
          );
          console.log("[SignUp] User synced on retry, ID:", profile.id);
        } catch (retryError) {
          console.warn(
            "[SignUp] syncAuthUser retry failed, trying getProfile:",
            retryError,
          );
          profile = await auth.getProfile(data.user.id, data.user.email);
        }
      }

      if (profile) {
        setUser({
          id: profile.id,
          email: profile.email,
          username: profile.username,
          name:
            profile.name ||
            (profile as any).firstName ||
            `${formData.firstName} ${formData.lastName}`,
          avatar: profile.avatar || "",
          bio: profile.bio || "",
          website: (profile as any).website || "",
          location: profile.location || "",
          hashtags: (profile as any).hashtags || [],
          isVerified: profile.isVerified,
          postsCount: profile.postsCount,
          followersCount: profile.followersCount,
          followingCount: profile.followingCount,
        });
      } else {
        // Fallback to Better Auth data if both sync and profile fetch fail
        console.warn(
          "[SignUp] Could not sync or load profile, using Better Auth data",
        );
        setUser({
          id: data.user.id,
          email: data.user.email,
          username: (data.user as any).username || formData.username,
          name: data.user.name || `${formData.firstName} ${formData.lastName}`,
          avatar: data.user.image || "",
          bio: "",
          website: "",
          location: "",
          hashtags: [],
          isVerified: Boolean(idVerification.isVerified),
          postsCount: 0,
          followersCount: 0,
          followingCount: 0,
        });
      }

      // Welcome email is sent server-side by Better Auth's user.create hook
      // (auth edge fn) for every signup method — no client call needed. The old
      // POST /send-welcome here caused a duplicate welcome and was removed.

      // Record terms acceptance
      recordTermsAcceptance(profile?.id || data.user.id, formData.email).catch(
        () => {},
      );

      toast.success("Welcome to DVNT!", {
        description: "Your account is ready.",
      });
      AppTrace.trace("SIGNUP", "account_create_success", {
        elapsedMs: Date.now() - startedAt,
        syncedProfile: Boolean(profile),
      });

      resetSignup();
      resetVerification();
      router.replace("/(protected)/(tabs)" as any);
    } catch (error: any) {
      console.error("[Signup] Error:", error);
      AppTrace.error("SIGNUP", "account_create_failed", {
        elapsedMs: Date.now() - startedAt,
        error: getErrorMessage(error),
      });

      let errorMsg = "Please try again";
      if (error?.message) {
        errorMsg = error.message;
      }

      if (
        errorMsg.includes("already exists") ||
        errorMsg.includes("duplicate")
      ) {
        errorMsg = "This email or username is already registered";
      }

      toast.error("Failed to create account", {
        description: errorMsg,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    checkAndRequestPermissions();
  }, []);

  // Auto-scroll to "Complete Signup" button when verification succeeds
  useEffect(() => {
    if (idVerification.isVerified) {
      const task = InteractionManager.runAfterInteractions(() => {
        scrollRef.current?.scrollToEnd({ animated: true });
      });
      return () => task.cancel();
    }
  }, [idVerification.isVerified]);

  // Sync verification store images to auth store
  useEffect(() => {
    if (idImageUri && idImageUri !== idVerification.idImage) {
      setIDImage(idImageUri);
      setFaceImage("");
      setVerified(false);
      setMatchConfidence(null);
      setDobMismatch(null);
      setManualReviewSubmitted(false);

      // Extract and compare DOB from parsed ID
      if (parsedId?.dob) {
        const isOver18 = checkAge(parsedId.dob);
        setExtractedDOB(parsedId.dob, isOver18);

        if (formData?.dateOfBirth) {
          const dobComparison = compareDOBs(parsedId.dob, formData.dateOfBirth);
          console.log("[SignUpStep2] DOB comparison:", dobComparison);

          if (!dobComparison.match) {
            setDobMismatch(dobComparison.message);
            showToast("error", "Date of Birth Mismatch", dobComparison.message);
          }
        }

        if (isOver18 === false) {
          showToast(
            "error",
            "Age Restriction",
            "You must be 18 years or older to sign up.",
          );
        }
      }

      setActiveTab("selfie");
    }
  }, [idImageUri, parsedId]);

  useEffect(() => {
    if (faceImageUri && faceImageUri !== idVerification.faceImage) {
      setFaceImage(faceImageUri);
      setVerified(false);
      setMatchConfidence(null);
      setManualReviewSubmitted(false);
    }
  }, [faceImageUri]);

  /**
   * CRITICAL: Age check using centralized validation
   * Returns true if 18+, false if under 18, null if invalid
   */
  function checkAge(dobString: string): boolean | null {
    const result = validateDateOfBirth(dobString);
    if (!result.isValid) return null;
    return result.isOver18;
  }

  const checkAndRequestPermissions = async () => {
    try {
      console.log("[SignUpStep2] Starting permission check...");
      AppTrace.trace("VERIFICATION", "permissions_check_started", {
        platform: Platform.OS,
      });

      // Request camera via VisionCamera
      let cameraStatus = VisionCamera.cameraPermissionStatus;
      console.log("[SignUpStep2] Initial camera status:", cameraStatus);

      if (cameraStatus !== "authorized") {
        const granted = await VisionCamera.requestCameraPermission();
        cameraStatus = granted
          ? "authorized"
          : VisionCamera.cameraPermissionStatus;
        console.log(
          "[SignUpStep2] Camera permission after request:",
          cameraStatus,
        );
      }

      // Mic is optional for ID verification - only camera is truly required
      let micGranted = true; // Default to true, mic not strictly needed
      if (Platform.OS === "android") {
        try {
          const micPermission = await PermissionsAndroid.check(
            PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          );
          console.log("[SignUpStep2] Android mic check:", micPermission);

          if (!micPermission) {
            const result = await PermissionsAndroid.request(
              PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
              {
                title: "Microphone Permission",
                message:
                  "This app needs access to your microphone for verification.",
                buttonNeutral: "Ask Me Later",
                buttonNegative: "Cancel",
                buttonPositive: "OK",
              },
            );
            console.log("[SignUpStep2] Android mic request result:", result);
            // Don't block on mic permission
          }
        } catch (micError) {
          console.log(
            "[SignUpStep2] Android mic error (non-blocking):",
            micError,
          );
        }
      } else {
        // iOS - try to get mic but don't block on it
        try {
          let micStatus = VisionCamera.microphonePermissionStatus;
          console.log("[SignUpStep2] iOS mic status:", micStatus);
          if (micStatus !== "authorized") {
            const granted = await VisionCamera.requestMicrophonePermission();
            micStatus = granted
              ? "authorized"
              : VisionCamera.microphonePermissionStatus;
            console.log("[SignUpStep2] iOS mic after request:", micStatus);
          }
        } catch (micError) {
          console.log("[SignUpStep2] iOS mic error (non-blocking):", micError);
        }
      }

      // Only camera is strictly required
      console.log("[SignUpStep2] Final camera status:", cameraStatus);
      if (cameraStatus === "authorized") {
        console.log("[SignUpStep2] Camera granted - enabling verification");
        setPermissionsGranted(true);
        AppTrace.trace("VERIFICATION", "permissions_ready", {
          platform: Platform.OS,
        });
      } else {
        console.log("[SignUpStep2] Camera NOT granted");
        AppTrace.warn("VERIFICATION", "camera_permission_missing", {
          platform: Platform.OS,
          cameraStatus,
        });
        showToast(
          "error",
          "Camera Required",
          "Please grant camera access in Settings to verify your identity.",
        );
      }
    } catch (error) {
      console.error("[SignUpStep2] Permission request error:", error);
      AppTrace.error("VERIFICATION", "permissions_check_failed", {
        platform: Platform.OS,
        error: getErrorMessage(error),
      });
      showToast("error", "Permission Error", String(error));
    }
  };

  const requestPermissions = async () => {
    try {
      AppTrace.trace("VERIFICATION", "permissions_request_started", {
        platform: Platform.OS,
      });
      const cameraPermission = await VisionCamera.requestCameraPermission();

      let microphonePermission: boolean | undefined;
      try {
        microphonePermission = await VisionCamera.requestMicrophonePermission();
      } catch (micError) {
        console.log(
          "[SignUpStep2] Optional microphone permission failed:",
          micError,
        );
      }

      console.log("Requested permissions:", {
        camera: cameraPermission,
        mic: microphonePermission,
      });

      if (cameraPermission) {
        setPermissionsGranted(true);
        AppTrace.trace("VERIFICATION", "permissions_request_granted", {
          platform: Platform.OS,
        });
      } else {
        AppTrace.warn("VERIFICATION", "permissions_request_denied", {
          platform: Platform.OS,
          cameraPermission,
        });
        showToast(
          "error",
          "Camera Required",
          "Please grant camera access in Settings to continue verification.",
        );
      }
    } catch (error) {
      console.error("Permission request error:", error);
      AppTrace.error("VERIFICATION", "permissions_request_failed", {
        platform: Platform.OS,
        error: getErrorMessage(error),
      });
      showToast("error", "Failed to request permissions");
    }
  };

  const bothCaptured = idComplete && faceComplete;
  const canProceed =
    idVerification.isVerified &&
    idVerification.isOver18 !== false &&
    !dobMismatch;

  const handleVerify = async () => {
    console.log("[SignUpStep2] handleVerify called");

    if (!idVerification.idImage || !idVerification.faceImage) {
      console.log("[SignUpStep2] Missing images");
      AppTrace.warn("VERIFICATION", "verify_blocked_missing_images", {
        hasIdImage: Boolean(idVerification.idImage),
        hasFaceImage: Boolean(idVerification.faceImage),
      });
      showToast(
        "error",
        "Missing Images",
        "Please complete both ID scan and face scan before verifying.",
      );
      return;
    }

    if (idVerification.isOver18 === false) {
      console.log("[SignUpStep2] Under 18");
      AppTrace.warn("VERIFICATION", "verify_blocked_underage", {
        extractedUnder18: true,
      });
      showToast(
        "error",
        "Age Restriction",
        "You must be 18 years or older to sign up.",
      );
      return;
    }

    if (dobMismatch) {
      AppTrace.warn("VERIFICATION", "verify_blocked_dob_mismatch", {
        hasDobMismatch: true,
      });
      showToast(
        "error",
        "Date of Birth Mismatch",
        "The date of birth on your ID doesn't match what you entered. Please upload the correct ID or go back and correct your date of birth.",
      );
      return;
    }

    setIsVerifying(true);
    setMatchConfidence(null);
    const attempt = failedAttempts + 1;
    AppTrace.trace("VERIFICATION", "verify_started", {
      attempt,
      platform: Platform.OS,
    });
    console.log("[SignUpStep2] Starting verification process...");
    console.log("[SignUpStep2] Platform:", Platform.OS);

    try {
      const result = await compareFaces(
        idVerification.idImage,
        idVerification.faceImage,
      );
      console.log("[SignUpStep2] Verification result:", result);

      setMatchConfidence(result.confidence);

      if (result.match) {
        setVerified(true);
        setFailedAttempts(0);
        AppTrace.trace("VERIFICATION", "verify_success", {
          attempt,
          confidence: Number(result.confidence.toFixed(1)),
        });
        console.log("[SignUpStep2] Verification successful");

        // P0-3: Immediately purge local ID/face state so the toast below
        // is truthful — the captures never persist beyond this point.
        // Uses the real sonner-native toast path (not the useUIStore
        // wrapper) so the message renders via the Toaster mounted in
        // app/_layout.tsx instead of any legacy in-app alert UI.
        resetVerification();
        setIDImage("");
        setFaceImage("");
        toast.success("Your ID information was deleted. Thank you.");
      } else {
        const attempts = failedAttempts + 1;
        setFailedAttempts(attempts);
        AppTrace.warn("VERIFICATION", "verify_failed_match", {
          attempt: attempts,
          confidence: Number(result.confidence.toFixed(1)),
        });
        console.log(`[SignUpStep2] Verification failed (attempt ${attempts})`);

        if (attempts >= 2) {
          showToast(
            "error",
            "Verification Failed",
            'Face doesn\'t match your ID. If your appearance has changed (facial hair, glasses, etc.), tap "Submit for Review" below to continue.',
          );
        } else {
          showToast(
            "error",
            "Verification Failed",
            "Face doesn't match. Please retake your selfie with better lighting and ensure your face is clearly visible.",
          );
        }
      }
    } catch (error: any) {
      console.error("[SignUpStep2] Verification error:", error);
      console.error("[SignUpStep2] Error message:", error?.message);
      console.error("[SignUpStep2] Error stack:", error?.stack);

      // Count SDK errors as failed attempts so "Submit for Manual Review" unlocks
      const attempts = failedAttempts + 1;
      setFailedAttempts(attempts);
      AppTrace.error("VERIFICATION", "verify_failed_error", {
        attempt: attempts,
        error: getErrorMessage(error),
      });
      console.log(`[SignUpStep2] SDK error (attempt ${attempts})`);

      // After repeated failures, surface the manual-review path but do not
      // mark the user verified locally.
      if (attempts >= 2) {
        showToast(
          "error",
          "Verification Needs Review",
          "We couldn't confirm a match. You can submit for manual review below, but verified access stays locked until approval.",
        );
      }

      const errorMessage = error.message || "Verification failed";
      let toastDescription = "";

      if (
        errorMessage.includes("No face detected in ID") ||
        errorMessage.includes("No human face detected in ID")
      ) {
        toastDescription =
          "No face was detected in your ID document. Please upload a valid government-issued ID with a clear, visible photo.";
      } else if (
        errorMessage.includes("No face detected in selfie") ||
        errorMessage.includes("No human face detected in selfie")
      ) {
        toastDescription =
          "No face was detected in your selfie. Please retake ensuring your face is clearly visible and well-lit.";
      } else {
        toastDescription =
          errorMessage +
          " Try again, or you'll be able to submit for manual review.";
      }

      showToast("error", "Verification Error", toastDescription);
    }

    setIsVerifying(false);
  };

  if (!permissionsGranted) {
    return (
      <ScrollView
        className="flex-1 h-screen"
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          alignItems: "center",
          gap: 24,
          paddingBottom: 40,
        }}
      >
        <View className="bg-destructive/10 rounded-lg p-6 mx-4">
          <View className="flex-row items-center gap-3 mb-3">
            <ShieldAlert size={24} className="text-destructive" />
            <Text className="text-lg font-semibold text-foreground">
              Permissions Required
            </Text>
          </View>
          <Text className="text-sm text-muted mb-4">
            Camera access is required to scan your ID and take a selfie.
            Microphone access is optional.
          </Text>
          <Button onPress={requestPermissions}>Grant Permissions</Button>
          <Button
            variant="secondary"
            onPress={() => Linking.openSettings()}
            className="mt-2"
          >
            Open Settings
          </Button>
        </View>
        <Button variant="secondary" onPress={() => setActiveStep(1)}>
          Go Back
        </Button>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      ref={scrollRef}
      className="flex-1"
      contentContainerStyle={{
        gap: 12,
        paddingBottom: 40,
        paddingHorizontal: 16,
      }}
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
    >
      <View className="items-center gap-2">
        <Text className="text-xl font-semibold text-foreground">
          Identity Verification
        </Text>
        <Text className="text-sm text-zinc-500 text-center">
          Verification keeps DVNT for real adults, reduces fake profiles, and
          unlocks the private parts of the app.
        </Text>
      </View>

      <View className="rounded-3xl border border-white/10 bg-white/5 p-4 gap-4">
        <View className="gap-1">
          <Text className="text-[11px] font-extrabold tracking-[1px] text-[#34A2DF]">
            WHY DVNT ASKS FOR THIS
          </Text>
          <Text className="text-base font-semibold text-foreground">
            Your ID and selfie are for trust, not for your public profile.
          </Text>
        </View>

        <View className="gap-2">
          <View className="rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
            <Text className="text-sm font-semibold text-foreground">
              Used only for age and identity
            </Text>
            <Text className="mt-1 text-sm leading-5 text-zinc-400">
              DVNT uses your ID to confirm you are 18+ and that a real person is
              joining the community.
            </Text>
          </View>

          <View className="rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
            <Text className="text-sm font-semibold text-foreground">
              Not shown publicly. Not kept as profile content.
            </Text>
            <Text className="mt-1 text-sm leading-5 text-zinc-400">
              Your public profile uses your chosen name and photos. Verification
              captures are not shown on your profile and are deleted after the
              verification process completes.
            </Text>
          </View>

          <View className="rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
            <Text className="text-sm font-semibold text-foreground">
              Verification unlocks the private layer
            </Text>
            <Text className="mt-1 text-sm leading-5 text-zinc-400">
              Verified users can send DMs, comment, access spicy content, host
              events, and join intentional spaces like {getLynkDisplayName()}.
            </Text>
          </View>
        </View>
      </View>

      <View className="rounded-3xl border border-[#34A2DF]/20 bg-[#34A2DF]/10 p-4 gap-3">
        <Text className="text-sm font-semibold text-foreground">
          What happens next
        </Text>
        <View className="gap-2">
          <Text className="text-sm leading-5 text-zinc-300">
            1. Scan a valid government-issued ID.
          </Text>
          <Text className="text-sm leading-5 text-zinc-300">
            2. Take a selfie so DVNT can confirm the ID belongs to you.
          </Text>
          <Text className="text-sm leading-5 text-zinc-300">
            3. If the match is unclear, you can request review. Verified access
            stays locked until approval.
          </Text>
        </View>
      </View>

      {idVerification.isOver18 === false && (
        <View className="bg-destructive/10 rounded-lg p-4 flex-row items-start gap-3">
          <ShieldAlert size={16} className="text-destructive mt-0.5" />
          <View className="flex-1">
            <Text className="font-medium text-destructive">
              Age Restriction
            </Text>
            <Text className="text-sm text-muted">
              You must be 18 years or older to create an account. The date of
              birth extracted from your ID indicates you are under 18.
            </Text>
          </View>
        </View>
      )}

      {dobMismatch && (
        <View className="bg-destructive/10 rounded-lg p-4 flex-row items-start gap-3">
          <ShieldAlert size={16} className="text-destructive mt-0.5" />
          <View className="flex-1">
            <Text className="font-medium text-destructive">
              Date of Birth Mismatch
            </Text>
            <Text className="text-sm text-muted">
              {dobMismatch} Please upload the correct ID or go back and correct
              your date of birth.
            </Text>
          </View>
        </View>
      )}

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "id" | "selfie")}
        className="flex-1"
      >
        <TabsList className="flex-row w-full mb-4">
          <TabsTrigger
            value="id"
            className="flex-1 flex-row items-center justify-center gap-2"
          >
            <CreditCard size={16} className="text-foreground" />
            <Text className="text-foreground">ID Document</Text>
            {idComplete && <CheckCircle2 size={12} className="text-primary" />}
          </TabsTrigger>
          <TabsTrigger
            value="selfie"
            className="flex-1 flex-row items-center justify-center gap-2"
          >
            <Camera size={16} className="text-foreground" />
            <Text className="text-foreground">Face Scan</Text>
            {faceComplete && (
              <CheckCircle2 size={12} className="text-primary" />
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="id" className="flex-1 mt-4">
          <IdScanTab />
        </TabsContent>

        <TabsContent value="selfie" className="flex-1 mt-4">
          <FaceScanTab />
        </TabsContent>
      </Tabs>

      {idVerification.idImage &&
        idVerification.faceImage &&
        !idVerification.isVerified &&
        idVerification.isOver18 !== false && (
          <Button
            variant="outline"
            onPress={handleVerify}
            disabled={isVerifying}
            className="w-full flex-row items-center justify-center border-primary"
          >
            {isVerifying ? (
              <Text className="text-foreground">⏳ Verifying...</Text>
            ) : (
              <>
                <CheckCircle2 size={16} className="text-primary mr-2" />
                <Text className="text-foreground font-semibold">
                  Verify Identity
                </Text>
              </>
            )}
          </Button>
        )}

      {failedAttempts >= 2 &&
        !idVerification.isVerified &&
        idVerification.idImage &&
        idVerification.faceImage && (
          <View className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4">
            <Text className="text-sm text-foreground mb-2">
              If your appearance has changed since your ID photo (facial hair,
              glasses, weight change, etc.), you can submit your documents for
              manual review.
            </Text>
            <Button
              variant="outline"
              onPress={() => {
                setManualReviewSubmitted(true);
                AppTrace.warn("VERIFICATION", "manual_review_requested", {
                  attempts: failedAttempts,
                });
                showToast(
                  "info",
                  "Submitted for Review",
                  "Review requested. Verified features stay locked until a reviewer approves it.",
                );
              }}
              disabled={manualReviewSubmitted}
              className="w-full flex-row items-center justify-center border-yellow-500/50"
            >
              <ShieldAlert size={16} className="text-yellow-500 mr-2" />
              <Text className="text-foreground font-semibold">
                {manualReviewSubmitted
                  ? "Manual Review Requested"
                  : "Submit for Manual Review"}
              </Text>
            </Button>
          </View>
        )}

      {manualReviewSubmitted && !idVerification.isVerified && (
        <View className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4">
          <Text className="font-medium text-foreground">Review Pending</Text>
          <Text className="mt-1 text-sm text-muted">
            Your captures need a manual check. Do not promise verified access
            until that review is approved.
          </Text>
        </View>
      )}

      {idVerification.isVerified && (
        <View className="bg-primary rounded-lg p-4 flex-row items-center gap-3">
          <CheckCircle2 size={20} className="text-white" />
          <View className="flex-1">
            <Text className="font-medium text-white">
              Verification Successful
            </Text>
            <Text className="text-sm text-white/80">
              Your identity has been verified successfully
              {matchConfidence != null && matchConfidence > 0
                ? ` with ${matchConfidence.toFixed(1)}% confidence.`
                : "."}
            </Text>
          </View>
        </View>
      )}

      <View className="flex-row gap-3 pt-4">
        <Button
          variant="outline"
          onPress={() => setActiveStep(1)}
          className="flex-1 flex-row items-center justify-center"
        >
          <ArrowLeft size={16} className="text-foreground mr-2" />
          <Text className="ml-3 text-foreground">Back</Text>
        </Button>
        <Button
          onPress={createAccount}
          disabled={!canProceed || isSubmitting}
          className="flex-1 flex-row items-center justify-center"
        >
          <Text className="mr-3 text-primary-foreground">
            {isSubmitting ? "Creating..." : "Complete Signup"}
          </Text>
          {!isSubmitting && (
            <ArrowRight size={16} className="text-primary-foreground ml-2" />
          )}
        </Button>
      </View>
    </ScrollView>
  );
}
