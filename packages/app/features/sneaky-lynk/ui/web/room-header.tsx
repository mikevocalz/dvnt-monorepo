"use client";

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Hand, MoreHorizontal, Share2, Users, Volume2, VolumeX } from "lucide-react";

type RoomHeaderProps = {
  title: string;
  connecting: boolean;
  isHost: boolean;
  participantCount: number;
  raisedHandCount: number;
  timer?: ReactNode;
  event?: { title: string; id: string } | null;
  onBack: () => void;
  onShare: () => void;
  onParticipants: () => void;
  onHandQueue: () => void;
  onMuteAll: () => void;
  onUnmuteAll: () => void;
  onEvent: () => void;
};

const buttonStyle = "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/8 hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#3FDCFF]";

/** Keep the header in one row at every width. Only the title may shrink.
 * Phones expose Share and Participants directly; host-only moderation moves
 * into a labelled overflow instead of shrinking 44px targets or adding a row. */
export function RoomHeader(props: RoomHeaderProps) {
  const { title, connecting, isHost, participantCount, raisedHandCount, timer, event } = props;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [placement, setPlacement] = useState({ top: 0, left: 0, maxHeight: 240 });

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = buttonRef.current?.getBoundingClientRect();
      const main = rootRef.current?.closest("main");
      const room = main?.getBoundingClientRect();
      const dock = main?.querySelector("[data-room-controls]")?.getBoundingClientRect();
      if (!anchor || !room) return;
      const topBound = room.top + 8;
      const bottomBound = (dock?.top ?? room.bottom) - 8;
      const height = Math.min(raisedHandCount > 0 ? 148 : 100, bottomBound - topBound);
      // Fixed positioning escapes the scrolling stage's clip, but stays inside
      // the protected room DOM/stacking context (never in a body/top-layer portal).
      setPlacement({ top: Math.max(topBound, Math.min(anchor.bottom + 8, bottomBound - height)),
        left: Math.max(room.left + 12, anchor.right - 224), maxHeight: Math.max(44, height) });
    };
    place();
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        buttonRef.current?.focus({ preventScroll: true });
      }
    };
    const wide = window.matchMedia("(min-width: 640px)");
    const onWide = () => { if (wide.matches) setOpen(false); };
    const onScroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    const scrollTarget = rootRef.current?.closest("[data-room-content]");
    scrollTarget?.addEventListener("scroll", onScroll);
    wide.addEventListener("change", onWide);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
      scrollTarget?.removeEventListener("scroll", onScroll);
      wide.removeEventListener("change", onWide);
    };
  }, [open, raisedHandCount]);

  const select = (action: () => void) => {
    setOpen(false);
    buttonRef.current?.focus({ preventScroll: true });
    action();
  };

  return (
    <header data-room-header className="relative z-40 grid shrink-0 grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-1.5 pb-2 sm:gap-2 [@media(max-height:500px)_and_(min-width:600px)]:pb-1"
      style={{ paddingTop: "calc(var(--lynk-safe-top, env(safe-area-inset-top)) + 8px)", paddingLeft: "max(12px, env(safe-area-inset-left))", paddingRight: "max(12px, env(safe-area-inset-right))" }}>
      <button type="button" onClick={props.onBack} aria-label="Back" className={buttonStyle}><ArrowLeft size={20} /></button>
      <div data-room-header-title className="flex min-w-0 flex-col items-start gap-0.5">
        <span className="flex w-full min-w-0 items-center gap-1.5">
          <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: connecting ? "#facc15" : "#3FDCFF" }} />
          <span title={title} className="min-w-0 truncate text-[15px] font-semibold">{title}</span>
          {isHost ? <span className="hidden shrink-0 rounded-md bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-extrabold text-blue-200 sm:inline">HOST</span> : null}
        </span>
        <span className="flex w-full min-w-0 items-center gap-1 text-xs text-white/50">
          {isHost ? <span className="shrink-0 text-[9px] font-extrabold text-blue-200 sm:hidden">HOST</span> : null}
          {timer}
          {event ? <button type="button" data-lynk-event={event.id} onClick={props.onEvent} title={`Go to ${event.title}`}
            className="min-w-0 max-w-[32vw] truncate rounded-md bg-[#8A40CF]/25 px-1 py-0.5 text-[10px] font-semibold text-[#D9B8FF] hover:bg-[#8A40CF]/40">{event.title}</button> : null}
        </span>
      </div>
      <div data-room-header-actions className="flex shrink-0 items-center justify-end gap-1 sm:gap-1.5">
        <button type="button" onClick={props.onShare} aria-label="Share invite link" title="Share invite link" className={buttonStyle}><Share2 size={16} /></button>
        <button type="button" onClick={props.onParticipants} aria-label="Participants" title={`${participantCount} participants`} className={`${buttonStyle} relative`}>
          <Users size={17} /><span aria-hidden="true" className="absolute bottom-0.5 right-1 text-[10px] font-bold">{participantCount}</span>
        </button>
        {isHost ? <>
          <div className="hidden items-center gap-1.5 sm:flex">
            {raisedHandCount > 0 ? <button type="button" onClick={props.onHandQueue} aria-label={`${raisedHandCount} raised hands`} className={`${buttonStyle} gap-0.5 text-[#FF5BFC]`}><Hand size={14} /><span className="text-xs font-bold">{raisedHandCount}</span></button> : null}
            <button type="button" onClick={props.onMuteAll} aria-label="Mute everyone" title="Mute everyone" className={`${buttonStyle} text-[#FC253A]`}><VolumeX size={16} /></button>
            <button type="button" onClick={props.onUnmuteAll} aria-label="Let everyone unmute" title="Lift the mute — participants choose when to speak" className={buttonStyle}><Volume2 size={16} /></button>
          </div>
          <div ref={rootRef} className="sm:hidden" onBlur={(event) => {
            if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
          }}>
            <button ref={buttonRef} type="button" aria-label={raisedHandCount ? `Room actions, ${raisedHandCount} raised hands` : "Room actions"} title="Room actions"
              aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen(value => !value)} className={`${buttonStyle} relative`}>
              <MoreHorizontal size={20} />
              {raisedHandCount > 0 ? <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-md bg-[#FF5BFC] px-0.5 text-[9px] font-bold text-black">{raisedHandCount}</span> : null}
            </button>
            {open ? <div ref={menuRef} id={menuId} role="group" aria-label="Room actions" style={placement}
              className="fixed z-30 w-56 overflow-y-auto overscroll-contain rounded-xl border border-white/15 bg-[#111522] p-1 shadow-xl">
              {raisedHandCount > 0 ? <button type="button" onClick={() => select(props.onHandQueue)} aria-label={`${raisedHandCount} raised hands`} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-sm text-[#FF5BFC] hover:bg-white/10"><Hand size={16} />{raisedHandCount} raised hands</button> : null}
              <button type="button" onClick={() => select(props.onMuteAll)} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-sm text-[#FB7185] hover:bg-white/10"><VolumeX size={16} />Mute everyone</button>
              <button type="button" onClick={() => select(props.onUnmuteAll)} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-sm hover:bg-white/10"><Volume2 size={16} />Let everyone unmute</button>
            </div> : null}
          </div>
        </> : null}
      </div>
    </header>
  );
}
