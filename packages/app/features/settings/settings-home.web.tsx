"use client";

import { useRouter } from "solito/navigation";
import {
  Archive,
  Banknote,
  Bell,
  ChevronRight,
  CheckCircle,
  CreditCard,
  Crown,
  Eye,
  FileText,
  Globe,
  Heart,
  HelpCircle,
  Info,
  LayoutGrid,
  Lock,
  LogOut,
  Megaphone,
  MessageCircle,
  Moon,
  Shield,
  ShieldCheck,
  User,
  UserX,
  X,
} from "lucide-react";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useAppStore } from "@dvnt/app/lib/stores/app-store";

/**
 * Settings HOME / hub — web (Phase 1 port of native
 * `components/settings/screens/SettingsScreen.ios.tsx`, delegated to by
 * `app/settings/index.tsx`). Law 1: faithful to native data flow — user header
 * reads `useAuthStore`, Log Out calls the same `logout`, and the inline Feed
 * Layout / Show Spicy Content controls drive the same `useAppStore`
 * (`feedMode`/`setFeedMode`, `nsfwEnabled`/`setNsfwEnabled`). Each row navigates
 * to its `/settings/<slug>` sub-route mapped from the native expo-router hrefs.
 * Law 3: raw semantic HTML + Tailwind only (NativeWind interop off), sticky
 * header + close X like legal-page.web.tsx, rounded section cards, rounded-SQUARE
 * avatar (never circular), lucide-react icons mirroring native.
 */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wider text-white/40">
      {children}
    </p>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white/4 border border-white/10 px-4">{children}</div>
  );
}

function NavRow({
  icon,
  label,
  value,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center justify-between py-3.5 px-1 border-b border-white/8 last:border-0 active:bg-white/5"
    >
      <span className="flex items-center gap-3">
        <span className="text-white/60">{icon}</span>
        <span className="text-[15px] font-medium text-white">{label}</span>
      </span>
      <span className="flex items-center gap-2">
        {value ? <span className="text-sm text-white/60">{value}</span> : null}
        <ChevronRight size={18} className="text-white/40" />
      </span>
    </button>
  );
}

export function SettingsHomeScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const nsfwEnabled = useAppStore((s) => s.nsfwEnabled);
  const setNsfwEnabled = useAppStore((s) => s.setNsfwEnabled);
  const feedMode = useAppStore((s) => s.feedMode);
  const setFeedMode = useAppStore((s) => s.setFeedMode);

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  const go = (path: string) => () => router.push(path);

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Header */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 border-b border-white/8 bg-[#06070d]/85 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <span className="w-9" />
        <h1 className="text-[17px] font-semibold">Settings</h1>
        <button
          onClick={() => router.back()}
          aria-label="Close"
          className="w-9 h-9 rounded-xl bg-white/8 flex items-center justify-center active:scale-95"
        >
          <X size={18} color="#fff" />
        </button>
      </div>

      <main className="mx-auto w-full max-w-xl px-4 py-6">
        {/* User Info Card — rounded-square avatar, never circular */}
        {user ? (
          <div className="flex items-center gap-3 rounded-2xl bg-white/4 border border-white/10 p-4">
            {user.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.avatar}
                alt=""
                className="w-14 h-14 rounded-2xl object-cover bg-white/8"
              />
            ) : (
              <div className="w-14 h-14 rounded-2xl bg-white/8 flex items-center justify-center text-xl font-bold text-white/40">
                {(user.username || user.name || "U").slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-lg font-semibold text-white truncate">{user.name}</p>
              <p className="mt-0.5 text-sm text-white/60 truncate">{user.email}</p>
            </div>
          </div>
        ) : null}

        {/* Account */}
        <SectionLabel>Account</SectionLabel>
        <Card>
          <NavRow
            icon={<User size={20} />}
            label="Account Information"
            onClick={go("/settings/account")}
          />
          <NavRow icon={<Lock size={20} />} label="Privacy" onClick={go("/settings/privacy")} />
          <NavRow
            icon={<Eye size={20} />}
            label="Close Friends"
            onClick={go("/settings/close-friends")}
          />
          <NavRow icon={<UserX size={20} />} label="Blocked" onClick={go("/settings/blocked")} />
        </Card>

        {/* Payments */}
        <SectionLabel>Payments</SectionLabel>
        <Card>
          <NavRow
            icon={<CreditCard size={20} />}
            label="Payments"
            onClick={go("/settings/payments")}
          />
          <NavRow
            icon={<Banknote size={20} />}
            label="Organizer Payments"
            onClick={go("/settings/host-payments")}
          />
          <NavRow
            icon={<Crown size={20} />}
            label="Sneaky Lynk Subscription"
            onClick={go("/settings/membership")}
          />
        </Card>

        {/* Notifications */}
        <SectionLabel>Notifications</SectionLabel>
        <Card>
          <NavRow
            icon={<Bell size={20} />}
            label="Push Notifications"
            onClick={go("/settings/notifications")}
          />
          <NavRow
            icon={<MessageCircle size={20} />}
            label="Messages"
            onClick={go("/settings/messages")}
          />
          <NavRow
            icon={<Heart size={20} />}
            label="Likes and Comments"
            onClick={go("/settings/likes-comments")}
          />
        </Card>

        {/* Content */}
        <SectionLabel>Content</SectionLabel>
        <Card>
          <NavRow
            icon={<Archive size={20} />}
            label="Archived"
            onClick={go("/settings/archived")}
          />

          {/* Feed Layout — drives useAppStore.feedMode like native */}
          <div className="flex items-center justify-between py-3.5 px-1 border-b border-white/8">
            <span className="flex items-center gap-3">
              <span className="text-white/60">
                <LayoutGrid size={20} />
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] font-medium text-white">Feed Layout</span>
                <span className="block text-xs text-white/60">
                  Switch between list and grid view
                </span>
              </span>
            </span>
            <span className="flex items-center overflow-hidden rounded-lg border border-white/10">
              <button
                type="button"
                onClick={() => setFeedMode("classic")}
                className={`px-3 py-1.5 text-sm font-medium ${
                  feedMode === "classic" ? "bg-cyan-500/20 text-[#3FDCFF]" : "text-white/50"
                }`}
              >
                Feed
              </button>
              <span className="w-px h-5 bg-white/10" />
              <button
                type="button"
                onClick={() => setFeedMode("masonry")}
                className={`px-3 py-1.5 text-sm font-medium ${
                  feedMode === "masonry" ? "bg-cyan-500/20 text-[#3FDCFF]" : "text-white/50"
                }`}
              >
                Grid
              </button>
            </span>
          </div>

          {/* Show Spicy Content — drives useAppStore.nsfwEnabled like native */}
          <div className="flex items-center justify-between py-3.5 px-1 border-b border-white/8">
            <span className="flex items-center gap-3">
              <span className="text-xl leading-none">😈</span>
              <span className="min-w-0">
                <span className="block text-[15px] font-medium text-white">
                  Show Spicy Content
                </span>
                <span className="block text-xs text-white/60">
                  Display mature content in feed
                </span>
              </span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={nsfwEnabled}
              aria-label="Show Spicy Content"
              onClick={() => setNsfwEnabled(!nsfwEnabled, "settings-home-web")}
              className={`relative inline-flex w-12 h-7 shrink-0 items-center rounded-full transition-colors outline-none ${
                nsfwEnabled ? "bg-cyan-500" : "bg-white/15"
              }`}
            >
              <span
                className={`inline-block w-5 h-5 rounded-full bg-white shadow transition-transform ${
                  nsfwEnabled ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>

          <NavRow
            icon={<span className="text-[#8A40CF]"><Moon size={20} /></span>}
            label="Weather Ambiance"
            onClick={go("/settings/weather-ambiance")}
          />
          <NavRow
            icon={<Moon size={20} />}
            label="Theme"
            value="System"
            onClick={go("/settings/theme")}
          />
          <NavRow
            icon={<Globe size={20} />}
            label="Language"
            value="English"
            onClick={go("/settings/language")}
          />
        </Card>

        {/* About DVNT */}
        <SectionLabel>About DVNT</SectionLabel>
        <Card>
          <NavRow
            icon={<Info size={20} />}
            label="About / Community Focus"
            onClick={go("/settings/about")}
          />
          <NavRow
            icon={<CheckCircle size={20} />}
            label="Eligibility Criteria"
            onClick={go("/settings/eligibility")}
          />
          <NavRow
            icon={<ShieldCheck size={20} />}
            label="Identity Protection"
            onClick={go("/settings/identity-protection")}
          />
        </Card>

        {/* Legal & Policies */}
        <SectionLabel>Legal & Policies</SectionLabel>
        <Card>
          <NavRow
            icon={<Shield size={20} />}
            label="Privacy Policy"
            onClick={go("/settings/privacy-policy")}
          />
          <NavRow
            icon={<FileText size={20} />}
            label="Terms of Service"
            onClick={go("/settings/terms")}
          />
          <NavRow
            icon={<FileText size={20} />}
            label="Community Standards"
            onClick={go("/settings/community-guidelines")}
          />
          <NavRow
            icon={<Megaphone size={20} />}
            label="Advertising Policy"
            onClick={go("/settings/ad-policy")}
          />
        </Card>

        {/* Support */}
        <SectionLabel>Support</SectionLabel>
        <Card>
          <NavRow
            icon={<HelpCircle size={20} />}
            label="Help Center / FAQ"
            onClick={go("/settings/faq")}
          />
        </Card>

        {/* Log Out — calls the same auth-store logout as native */}
        <div className="mt-6">
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 rounded-2xl bg-white/4 border border-white/10 py-3.5 font-semibold text-red-500 active:bg-white/8"
          >
            <LogOut size={20} />
            Log Out
          </button>
        </div>

        <p className="mt-6 text-center text-xs text-white/40">Version 1.0.0</p>
      </main>
    </div>
  );
}
