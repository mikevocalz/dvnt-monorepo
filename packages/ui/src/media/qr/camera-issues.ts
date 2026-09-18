/**
 * Camera failures → what door staff should DO about them.
 *
 * The old web scanner swallowed every getUserMedia failure: a denied
 * permission rendered a black box and nothing else. Each failure here maps to
 * a title, a fix in plain words, and whether "Try again" can possibly help.
 * Pure: no DOM access, so every branch is unit-tested.
 */
export type CameraIssueKind =
  | "insecure_context"
  | "in_app_browser"
  | "unsupported"
  | "denied"
  | "no_camera"
  | "busy"
  | "engine"
  | "stalled"
  | "unknown";

export interface CameraIssue {
  kind: CameraIssueKind;
  title: string;
  message: string;
  /** False when retrying cannot work until the user changes something. */
  canRetry: boolean;
}

/** Webviews that commonly ship without camera access for web pages. */
const IN_APP_UA =
  /\b(FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|TikTok|BytedanceWebview|Snapchat|Twitter|LinkedInApp|GSA\/)\b/i;

export function isInAppBrowser(userAgent: string): boolean {
  return IN_APP_UA.test(userAgent || "");
}

/** Problems knowable BEFORE asking for the camera. null = go ahead. */
export function detectPreflightIssue(env: {
  isSecureContext: boolean;
  hasGetUserMedia: boolean;
  userAgent: string;
}): CameraIssue | null {
  if (!env.isSecureContext) {
    return {
      kind: "insecure_context",
      title: "Camera needs a secure page",
      message: "Open DVNT at https://dvntapp.live — browsers only allow the camera on https.",
      canRetry: false,
    };
  }
  if (!env.hasGetUserMedia) {
    return isInAppBrowser(env.userAgent)
      ? {
          kind: "in_app_browser",
          title: "Open this in Safari or Chrome",
          message:
            "You're inside another app's browser, which can't use the camera. Tap ••• or the share icon and choose \"Open in Safari\" (or Chrome), then open the scanner again.",
          canRetry: false,
        }
      : {
          kind: "unsupported",
          title: "This browser can't use the camera",
          message: "Open DVNT in Safari (iPhone) or Chrome (Android). You can still type a ticket code below.",
          canRetry: false,
        };
  }
  return null;
}

/**
 * The camera opened and then stopped producing frames.
 *
 * Nothing in expo-camera's web path reports this. Its decode loop is handed no
 * `onError` (ExpoCamera.web.js:25-31), the catch inside it is a no-op, and the
 * `finally` reschedules unconditionally — so a stream that dies after a
 * successful start looks exactly like a stream nobody has held a code up to.
 * On iOS the usual cause is Low Power Mode, which suspends autoplay of inline
 * video including a MediaStream, and which a wake-locked screen at full
 * brightness makes more likely as the night goes on.
 *
 * Named separately from `busy` because the fix is different: nothing else is
 * holding the camera, the frames just stopped.
 */
export const STALLED_ISSUE: CameraIssue = {
  kind: "stalled",
  title: "The camera stopped",
  message:
    "Frames stopped arriving. On iPhone this is usually Low Power Mode — turn it off in Settings › Battery, then try again. Typed codes still work below.",
  canRetry: true,
};

/** getUserMedia / decoder errors, by DOMException name first, message second. */
export function classifyCameraError(err: unknown): CameraIssue {
  const e = (err ?? {}) as { name?: string; message?: string; code?: string };
  const name = String(e.name ?? "");
  const text = `${name} ${String(e.message ?? err ?? "")}`.toLowerCase();

  if (name === "NotAllowedError" || name === "SecurityError" || /permission|denied|not allowed/.test(text)) {
    return {
      kind: "denied",
      title: "Camera access is off",
      message:
        "iPhone: tap \"aA\" (or the puzzle icon) in the address bar → Website Settings → Camera → Allow, then reload. Android: tap the lock icon → Permissions → Camera → Allow.",
      canRetry: true,
    };
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError" || /no camera|not found|requested device/.test(text)) {
    return {
      kind: "no_camera",
      title: "No camera found",
      message: "This device didn't report a usable camera. Type the ticket code below, or scan from a phone.",
      canRetry: true,
    };
  }
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError" || /in use|could not start|not readable/.test(text)) {
    return {
      kind: "busy",
      title: "The camera is busy",
      message: "Another app or tab is using the camera. Close it (FaceTime, Camera, another DVNT tab), then try again.",
      canRetry: true,
    };
  }
  if (/wasm|zxing|barcode|detector|instantiate|compile/.test(text)) {
    return {
      kind: "engine",
      title: "Scanner engine didn't load",
      message: "The QR reader couldn't download. Check the connection and try again — typed codes still work below.",
      canRetry: true,
    };
  }
  return {
    kind: "unknown",
    title: "Camera didn't start",
    message: "Try again. If it keeps happening, reload the page — typed codes still work below.",
    canRetry: true,
  };
}
