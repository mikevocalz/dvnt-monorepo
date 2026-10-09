/**
 * The body of `useMediaUpload().uploadSingle`, kept free of expo imports so
 * `node --test` can run it. Every avatar and branding upload goes through
 * here: web edit profile, web onboarding photo, web profile header, native
 * edit profile, native profile tab, host branding.
 */
import type { ServerUploadResult } from "../server-upload.ts";
import { fitImageToCap, type FitImageDeps } from "./fit-image-to-cap.ts";
import { folderToKind, sizeLimitForKind } from "./upload-policy.ts";

export async function uploadSingleImage(
  uri: string,
  folder: string,
  deps: FitImageDeps,
  upload: (uri: string) => Promise<ServerUploadResult>,
): Promise<ServerUploadResult> {
  // uploadSingle only carries still images, so the image kind for the folder
  // decides the cap (avatars → "avatar", 2 MB).
  const limit = sizeLimitForKind(folderToKind(folder, "image/jpeg"));
  const fitted = await fitImageToCap(uri, limit, deps);
  if (!fitted.ok) {
    return { success: false, url: "", path: "", filename: "", error: fitted.error };
  }
  return upload(fitted.uri);
}
