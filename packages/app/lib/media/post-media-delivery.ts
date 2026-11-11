/** Off until the corresponding signed-delivery server/CDN cutover is approved. */
export function protectedPostMediaEnabled(): boolean {
  return process.env.EXPO_PUBLIC_FF_PROTECTED_POST_MEDIA === 'true' ||
    process.env.NEXT_PUBLIC_FF_PROTECTED_POST_MEDIA === 'true';
}
