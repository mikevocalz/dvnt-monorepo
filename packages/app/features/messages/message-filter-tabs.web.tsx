"use client";

import { Inbox, ShieldAlert, Radio } from "lucide-react";

type MessageTab = "primary" | "requests" | "lynk";

/** Equal-width tracks cannot grow past the phone viewport at their min-content size. */
export function MessageFilterTabs({ activeTab, onChange, inboxUnreadCount, spamUnreadCount }: {
  activeTab: MessageTab;
  onChange: (tab: MessageTab) => void;
  inboxUnreadCount: number;
  spamUnreadCount: number;
}) {
  const tabs = [
    { id: "primary", label: "Inbox", Icon: Inbox, count: inboxUnreadCount, active: "border-[#3FDCFF]/30 bg-[#3FDCFF]/14 text-[#3FDCFF]" },
    { id: "requests", label: "Requests", Icon: ShieldAlert, count: spamUnreadCount, active: "border-white/8 bg-white/10 text-white" },
    { id: "lynk", label: "Sneaky Lynk", Icon: Radio, count: 0, active: "border-[#FF5BFC]/30 bg-[#FF5BFC]/14 text-[#FF8BFD]" },
  ] as const;
  return (
    <nav aria-label="Message filters" className="mb-4 grid grid-cols-3 gap-1 rounded-2xl border border-white/15 bg-[#18181b]/85 p-1.5 sm:gap-2 sm:p-2">
      {tabs.map(({ id, label, Icon, count, active }) => (
        <button key={id} type="button" aria-pressed={activeTab === id} onClick={() => onChange(id)}
          className={`flex min-w-0 min-h-12 flex-col items-center justify-center gap-1 rounded-xl border px-1 py-2 text-xs font-bold transition-colors sm:flex-row sm:gap-2 sm:px-3 sm:text-sm ${activeTab === id ? active : "border-transparent bg-transparent text-white/60"}`}>
          <span className="flex shrink-0 items-center justify-center gap-1">
            <Icon size={16} aria-hidden="true" />
            {count > 0 ? <span className="min-w-5 rounded-[10px] bg-white/15 px-1 text-center text-[11px]">{count > 99 ? "99+" : count}</span> : null}
          </span>
          <span className="max-w-full break-words whitespace-normal text-center leading-tight">{label}</span>
        </button>
      ))}
    </nav>
  );
}
