import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * `cn` — the ORIGINAL DVNT class joiner, preserved verbatim from the app's
 * `lib/cn.ts`. It is a plain space-join of truthy class strings and does NOT
 * resolve Tailwind conflicts. This behavior is load-bearing: swapping it for a
 * tailwind-merge implementation would change rendered classes at runtime. When
 * you specifically want conflict resolution, use `cnMerge`.
 */
export function cn(
  ...classes: Array<string | undefined | null | false>
): string {
  return classes.filter(Boolean).join(" ");
}

/**
 * `cnMerge` — clsx + tailwind-merge (from the app's `lib/utils/cn.ts`).
 * Resolves conflicting Tailwind utilities (last one wins).
 */
export function cnMerge(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export type { ClassValue };
