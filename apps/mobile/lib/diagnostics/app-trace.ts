import { Platform } from "react-native";
import { createMMKV } from "react-native-mmkv";

export type AppTraceTag =
  | "BOOT"
  | "AUTH"
  | "SIGNUP"
  | "VERIFICATION"
  | "POST"
  | "RECOVERY"
  | "CART"
  | "PUBLIC_GATE"
  | "PERF"
  | "CRASH";

type TraceLevel = "trace" | "warn" | "error";
type TracePrimitive = string | number | boolean | null | undefined;

interface TraceContext {
  [key: string]: TracePrimitive;
}

export interface AppTraceEvent {
  ts: number;
  level: TraceLevel;
  tag: AppTraceTag;
  event: string;
  ctx: Record<string, string | number | boolean | null>;
}

const MAX_EVENTS = 300;
const STORAGE_KEY = "app_trace_events";

let storage: ReturnType<typeof createMMKV> | null = null;

try {
  if (Platform.OS !== "web") {
    storage = createMMKV({ id: "dvnt-app-trace" });
  }
} catch (error) {
  console.error("[AppTrace] Failed to initialize MMKV:", error);
}

let globalContext: TraceContext = {};
let buffer: AppTraceEvent[] = [];

function normalizeValue(
  value: TracePrimitive,
): string | number | boolean | null {
  if (value === undefined) return null;
  if (value === null) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return String(value);
}

function normalizeContext(
  ctx?: TraceContext,
): Record<string, string | number | boolean | null> {
  const normalized: Record<string, string | number | boolean | null> = {};

  if (!ctx) return normalized;

  for (const [key, value] of Object.entries(ctx)) {
    if (value === undefined) continue;
    normalized[key] = normalizeValue(value);
  }

  return normalized;
}

function persist(): void {
  try {
    storage?.set(STORAGE_KEY, JSON.stringify(buffer));
  } catch {
    // Non-blocking diagnostics only.
  }
}

function loadPersisted(): AppTraceEvent[] {
  try {
    const raw = storage?.getString(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toBreadcrumbLevel(level: TraceLevel): "info" | "warning" | "error" {
  if (level === "error") return "error";
  if (level === "warn") return "warning";
  return "info";
}

function formatEntry(entry: AppTraceEvent): string {
  const ctx = Object.entries(entry.ctx)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");

  return `[${entry.tag}] ${entry.event}${ctx ? ` | ${ctx}` : ""}`;
}

function push(entry: AppTraceEvent): void {
  buffer.push(entry);
  if (buffer.length > MAX_EVENTS) {
    buffer = buffer.slice(-MAX_EVENTS);
  }
  persist();

  if (__DEV__) {
    const method =
      entry.level === "error"
        ? console.error
        : entry.level === "warn"
          ? console.warn
          : console.log;
    method(formatEntry(entry));
  }

  try {
    const Sentry = require("@sentry/react-native");
    Sentry.addBreadcrumb({
      category: `app-trace:${entry.tag.toLowerCase()}`,
      message: entry.event,
      data: entry.ctx,
      level: toBreadcrumbLevel(entry.level),
    });
  } catch {
    // Sentry is optional in this app.
  }
}

buffer = loadPersisted();

function track(
  level: TraceLevel,
  tag: AppTraceTag,
  event: string,
  ctx?: TraceContext,
) {
  const entry: AppTraceEvent = {
    ts: Date.now(),
    level,
    tag,
    event,
    ctx: normalizeContext({ ...globalContext, ...ctx }),
  };

  push(entry);
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return "Unknown error";
}

export const AppTrace = {
  setContext(ctx: TraceContext): void {
    globalContext = { ...globalContext, ...ctx };
  },

  clearContext(keys?: string[]): void {
    if (!keys || keys.length === 0) {
      globalContext = {};
      return;
    }

    const nextContext = { ...globalContext };
    for (const key of keys) {
      delete nextContext[key];
    }
    globalContext = nextContext;
  },

  trace(tag: AppTraceTag, event: string, ctx?: TraceContext): void {
    track("trace", tag, event, ctx);
  },

  warn(tag: AppTraceTag, event: string, ctx?: TraceContext): void {
    track("warn", tag, event, ctx);
  },

  error(tag: AppTraceTag, event: string, ctx?: TraceContext): void {
    track("error", tag, event, ctx);
  },

  dump(): AppTraceEvent[] {
    return [...buffer];
  },

  clear(): void {
    buffer = [];
    persist();
  },
};
