
import { View, Text, Pressable, StyleSheet } from "react-native"
import { Image } from "expo-image"
import { router } from "expo-router"
import { ChevronLeft, ChevronRight } from "lucide-react-native"
import { LinearGradient } from "expo-linear-gradient"
import { Motion } from "@legendapp/motion"
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store"
import { useOnboardingStore } from "@dvnt/app/lib/stores/onboarding-store"
import { useSafeAreaInsets } from "react-native-safe-area-context"

const BRAND_GRADIENT = ["rgba(52, 162, 223, 0.7)", "rgba(138, 64, 207, 0.4)", "rgba(255, 91, 252, 0.7)"] as const
const BRAND_ACCENT = "#FF5BFC"

const SLIDES = [
  require("@dvnt/app/assets/images/onboarding/FEED.jpg"),
  require("@dvnt/app/assets/images/onboarding/VIDEO.png"),
  require("@dvnt/app/assets/images/onboarding/EVENTS.png"),
  require("@dvnt/app/assets/images/onboarding/PROFILE.png"),
]

export default function OnboardingScreen() {
  const setHasSeenOnboarding = useAuthStore((state) => state.setHasSeenOnboarding)
  const { currentIndex, nextPage, prevPage, reset } = useOnboardingStore()
  const insets = useSafeAreaInsets()

  const isFirst = currentIndex === 0
  const isLast = currentIndex === SLIDES.length - 1

  const handleSkip = async () => {
    reset()
    await setHasSeenOnboarding(true)
    router.replace("/(auth)/login")
  }

  const handlePrev = () => {
    prevPage()
  }

  const handleNext = async () => {
    if (isLast) {
      reset()
      await setHasSeenOnboarding(true)
      router.replace("/(auth)/login")
    } else {
      nextPage()
    }
  }

  return (
    <View style={styles.container}>
      <Motion.View
        key={currentIndex}
        initial={{ opacity: 0, scale: 1.05 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", damping: 20, stiffness: 300 }}
        style={StyleSheet.absoluteFill}
      >
        <Image
          source={SLIDES[currentIndex]}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
        />
      </Motion.View>

      <View style={[styles.overlay, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}>
        <Motion.View
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", damping: 20, stiffness: 300 }}
        >
          <Pressable onPress={handleSkip} style={styles.skipButton}>
            <Text style={styles.skipText}>Skip</Text>
          </Pressable>
        </Motion.View>

        <Motion.View
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", damping: 20, stiffness: 300 }}
          style={styles.bottomControls}
        >
          <Pressable 
            onPress={handlePrev} 
            disabled={isFirst}
            style={[styles.arrowButton, isFirst && styles.arrowButtonDisabled]}
          >
            {isFirst ? (
              <ChevronLeft size={28} color="rgba(255,255,255,0.3)" />
            ) : (
              <LinearGradient
                colors={BRAND_GRADIENT}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.arrowGradient}
              >
                <ChevronLeft size={28} color="#fff" />
              </LinearGradient>
            )}
          </Pressable>

          <View style={styles.dots}>
            {SLIDES.map((_, index) => (
              <Motion.View
                key={index}
                animate={{
                  scale: index === currentIndex ? 1.25 : 1,
                  backgroundColor: index === currentIndex ? BRAND_ACCENT : "rgba(255,255,255,0.4)",
                }}
                transition={{ type: "spring", damping: 20, stiffness: 300 }}
                style={styles.dot}
              />
            ))}
          </View>

          <Pressable onPress={handleNext} style={styles.arrowButton}>
            <LinearGradient
              colors={BRAND_GRADIENT}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.arrowGradient}
            >
              <ChevronRight size={28} color="#fff" />
            </LinearGradient>
          </Pressable>
        </Motion.View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: "space-between",
  },
  skipButton: {
    alignSelf: "flex-end",
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: "rgba(0,0,0,0.4)",
    borderRadius: 20,
    marginRight: 16,
  },
  skipText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600" as const,
  },
  bottomControls: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingHorizontal: 24,
  },
  dots: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.4)",
  },
  arrowButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    overflow: "hidden" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  arrowGradient: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  arrowButtonDisabled: {
    backgroundColor: "rgba(255,255,255,0.08)",
  },
})
