/** Keep completed uploads for retry, but never carry work across an editor/account boundary. */
export function createEventSaveSession() {
  let generation = 0;
  let scope: string | null = null;
  const hosted = new Map<string, string>();
  const invalidate = () => {
    generation += 1;
    scope = null;
    hosted.clear();
  };
  return {
    invalidate,
    begin(key: string, isCurrent: () => boolean) {
      if (scope !== key) {
        invalidate();
        scope = key;
      }
      const started = generation;
      const current = () => generation === started && isCurrent();
      const assertCurrent = () => {
        if (!current()) throw new Error("Your sign-in or event changed. Reopen the event before saving.");
      };
      return {
        current,
        assertCurrent,
        async upload(url: string | null | undefined, upload: (url: string) => Promise<string>) {
          assertCurrent();
          if (!url) return undefined;
          if (!/^(blob:|data:|file:)/.test(url)) return url;
          const cached = hosted.get(url);
          if (cached) return cached;
          const result = await upload(url);
          assertCurrent();
          hosted.set(url, result);
          return result;
        },
      };
    },
  };
}
