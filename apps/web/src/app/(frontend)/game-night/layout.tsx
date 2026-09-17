'use client';
import { WebAppShell } from '@dvnt/app/components/web-app-shell';
export default function GameNightLayout({ children }: { children: React.ReactNode }) {
  // Authed surface, unlike /events. `game_night_list_rooms` reads through the
  // bridged JWT, so a logged-out visitor gets no rooms and the screen tells
  // them the connection failed — which is a lie about an auth problem. The
  // shell also supplies the clearance for the fixed header; without a layout
  // this route inherited the marketing chrome and the "Game Night" badge
  // rendered underneath the nav bar.
  return <WebAppShell>{children}</WebAppShell>;
}
