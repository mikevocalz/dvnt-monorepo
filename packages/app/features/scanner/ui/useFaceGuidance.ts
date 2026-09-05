import { useState } from "react";

type Lighting = "ok" | "low" | "high";

type Guidance = {
  hint: string;
  lighting: Lighting;
  lightingMessage?: string;
  hasFace: boolean;
};

// Simplified version without face detection - provides static guidance
// Face detection can be re-enabled once package compatibility is resolved
export function useFaceGuidance() {
  const [guidance] = useState<Guidance>({
    hint: "Position your face inside the frame",
    lighting: "ok",
    lightingMessage: "Good lighting",
    hasFace: true,
  });

  // Return undefined frameProcessor - camera will work without face detection
  return { guidance, frameProcessor: undefined };
}
