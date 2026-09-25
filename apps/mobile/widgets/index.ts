/**
 * Widget registration entry (iOS). Importing this module:
 *   1. runs the createWidget / createLiveActivity registrations (side effects),
 *   2. wires the native backend into the shared, native-free sync layer.
 *
 * Imported once from the app root (apps/mobile/app/_layout.tsx) so the widget
 * bundle is discovered and the app can call syncWidgets() / *EventLiveActivity().
 */
import {
  registerLiveActivityBackend,
  registerWidgetBackend,
} from "@dvnt/app/lib/widgets";

// Side-effect imports: ensure each widget/Live Activity is registered + bundled.
import "./tickets-widget";
import "./blog-widget";
import "./social-widget";
import "./live-activity";

import { liveActivityBackend, widgetBackend } from "./backend";

let registered = false;

/**
 * Wire the native widget + Live Activity backends into the shared sync layer.
 * Importing this module already ran the createWidget/createLiveActivity
 * registrations (side effects above); call this once from the app root to make
 * syncWidgets() / *EventLiveActivity() actually drive the widgets.
 */
export function registerDvntWidgets(): void {
  if (registered) return;
  registered = true;
  registerWidgetBackend(widgetBackend);
  registerLiveActivityBackend(liveActivityBackend);
}

export { EventLiveActivity } from "./live-activity";
export { BlogWidget } from "./blog-widget";
export { SocialWidget } from "./social-widget";
export { TicketsWidget } from "./tickets-widget";
