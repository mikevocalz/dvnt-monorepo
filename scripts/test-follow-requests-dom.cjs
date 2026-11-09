/**
 * Render the actual native/web request panels, Settings screens, and protected
 * post gates with real React Query hooks. Only platform hosts and service edges
 * are fixtures; no network requests or live account changes are made.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const ROOT = path.resolve(__dirname, "..");
const deps = (process.env.NODE_PATH || "")
  .split(path.delimiter)
  .filter(Boolean);
const resolve = (name) => require.resolve(name, { paths: [ROOT, ...deps] });
const { build } = require(resolve("esbuild"));

const fixtures = {
  fixture: `import {create} from 'zustand';
    export const useAuth=create(()=>({user:{id:'owner-a',authId:'auth-a',username:'Owner'},logout:async()=>{}}));
    export const state={calls:[],reads:[],navigations:[],pending:false,fail:false,loadFail:false,loadHold:false,statusHold:false,statusFail:false,releases:[],readReleases:[],statusReleases:[],requests:{},statuses:{},statusReads:0};
    export const router={push:path=>state.navigations.push(path),replace:()=>{},back:()=>{},canDismiss:()=>false};
    export const navigation={setOptions:()=>{}};`,
  "@dvnt/app/lib/stores/auth-store": `export {useAuth as useAuthStore} from 'fixture';`,
  "@dvnt/app/lib/auth/identity": `import {useAuth} from 'fixture';export const getAuthIdFromStore=()=>useAuth.getState().user?.authId;`,
  "@dvnt/app/lib/posts/revoke-post-overlays": `import {state} from 'fixture';export const resetPostAccessOverlays=()=>{state.overlayResets++;};`,
  "@dvnt/app/lib/api/follows": `import {state} from 'fixture';export const followsApi={
    getFollowRequests:async(identity)=>{state.reads.push(identity);const data=state.requests[identity.viewerId]||[];if(state.loadHold)await new Promise(r=>state.readReleases.push(r));if(state.loadFail)throw Error('Offline');return data;},
    getFollowRequestStatus:async(target,identity)=>{state.statusReads++;if(state.statusHold)await new Promise(r=>state.statusReleases.push(r));if(state.statusFail)throw Error('Offline');return {following:false,followRequestStatus:'none',...state.statuses[identity.viewerId]};},
    respondToFollowRequest:async(requesterId,action,identity)=>{state.calls.push({requesterId,action,identity});if(state.pending)await new Promise(r=>state.releases.push(r));if(state.fail)throw Error('Connection interrupted');state.requests[identity.viewerId]=(state.requests[identity.viewerId]||[]).filter(r=>String(r.follower_id)!==requesterId);}
  };`,
  "solito/navigation": `export {router} from 'fixture';import {router} from 'fixture';export const useRouter=()=>router;`,
  "expo-router": `import {router,navigation} from 'fixture';export const useRouter=()=>router;export const useNavigation=()=>navigation;`,
  "react-native": `import React from 'react';
    export const View=({children,accessibilityLabel})=><div aria-label={accessibilityLabel}>{children}</div>;
    export const Text=({children,accessibilityRole,accessibilityLiveRegion})=><span role={accessibilityRole==='header'?'heading':accessibilityRole} aria-live={accessibilityLiveRegion}>{children}</span>;
    export const Pressable=({children,onPress,disabled,accessibilityLabel,accessibilityRole,accessibilityState})=><button onClick={onPress} disabled={disabled} aria-label={accessibilityLabel} role={accessibilityRole} aria-busy={accessibilityState?.busy} aria-disabled={accessibilityState?.disabled}>{children}</button>;
    export const ScrollView=View;export const ActivityIndicator=()=> <span role="progressbar"/>;export const Alert={alert:()=>{}};
    export const Platform={OS:'ios',select:x=>x.ios??x.default};`,
  "@dvnt/app/components/ui/html": `export {View as Main,View as SafeAreaView} from 'react-native';`,
  "@dvnt/app/components/ui/switch": `export const Switch=()=>null;`,
  "@dvnt/app/lib/stores/app-store": `const state={feedMode:'classic',nsfwEnabled:false,setFeedMode:()=>{},setNsfwEnabled:()=>{}};export const useAppStore=s=>s(state);`,
  "@dvnt/app/lib/hooks": `const colors={foreground:'white',background:'black',primary:'cyan'};export const useColorScheme=()=>({colors});`,
  "@dvnt/app/lib/hooks/use-verified-gate": `export const useVerifiedGate=()=>()=>{};`,
  "@dvnt/app/lib/hooks/use-biometrics": `export const useBiometrics=()=>({isAvailable:false,getBiometricName:()=>''});`,
  "@dvnt/app/lib/supabase/privileged": `export const deleteAccountPrivileged=()=>{throw Error('Unexpected account write')};`,
  "sonner-native": `export const toast={success:()=>{},info:()=>{},error:()=>{}};`,
  "expo-updates": `export const checkForUpdateAsync=async()=>({isAvailable:false});`,
  "@dvnt/app/components/settings-back-button": `export const SettingsCloseButton=()=>null;`,
  "@dvnt/app/lib/hooks/use-user-settings": `export const usePrivacySettings=()=>({data:{privateAccount:true,activityStatus:true,readReceipts:true,showLikes:true},isLoading:false,error:null});export const useUpdatePrivacySettings=()=>({isPending:false,isError:false,mutate:()=>{throw Error('Unexpected privacy write');}});`,
  "@dvnt/app/features/settings/ui/CityVisibilityCard": `export const CityVisibilityCard=()=>null;`,
  "@dvnt/app/features/settings/ui/LocationControls": `export const LocationControls=()=>null;`,
  "@dvnt/app/lib/stores/city-discovery-visibility": `export const CITY_VISIBILITY_COPY={sectionTitle:'City visibility'};`,
  "expo-blur": `export const BlurView=()=>null;`,
  "@dvnt/app/lib/hooks/use-follow": `import {state} from 'fixture';import {getFollowIdentity,isFollowIdentityCurrent} from '@dvnt/app/lib/auth/follow-identity';export const useFollow=()=>({isPending:false,isError:false,mutate:(variables,options)=>{const identity=getFollowIdentity();state.gateCalls.push({variables,identity});state.gateCallbacks.push(()=>{if(isFollowIdentityCurrent(identity))options?.onSettled?.();});}});`,
  "@dvnt/app/lib/hooks/use-age-verification": `import {state} from 'fixture';export const useVerificationState=()=>({data:state.verification,isError:state.verificationError,isLoading:!state.verification});`,
  "@dvnt/app/lib/hooks/use-verified-admission": `import {state} from 'fixture';export const useVerifiedAdmission=()=>({data:state.admission,isError:state.admissionError,isLoading:!state.admission});`,
};
const icons = [
  "Archive",
  "Banknote",
  "Bell",
  "ChevronRight",
  "CheckCircle",
  "CreditCard",
  "Crown",
  "Eye",
  "EyeOff",
  "FileText",
  "Globe",
  "Heart",
  "HelpCircle",
  "Info",
  "LayoutGrid",
  "Lock",
  "LogOut",
  "Megaphone",
  "MessageCircle",
  "Moon",
  "Shield",
  "ShieldCheck",
  "Smartphone",
  "User",
  "UserCheck",
  "UserX",
  "X",
  "Watch",
  "Bug",
  "Trash2",
  "Fingerprint",
  "Download",
  "CloudRain",
];
fixtures["lucide-react"] = fixtures["lucide-react-native"] = icons
  .map((name) => `export const ${name}=()=>null;`)
  .join("\n");

const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider,useQuery} from '@tanstack/react-query';
  import {FollowRequestsPanel as Web} from '@dvnt/app/features/settings/follow-requests-panel.web';
  import {FollowRequestsPanel as Native} from '@dvnt/app/features/settings/follow-requests-panel';
  import {SettingsHomeScreen as WebSettings} from '@dvnt/app/features/settings/settings-home.web';
  import IOSSettings from '@dvnt/app/features/settings/ui/screens/SettingsScreen.ios';
  import AndroidSettings from '@dvnt/app/features/settings/ui/screens/SettingsScreen.android';
  import NativePrivacy from '@dvnt/app/features/routes/screens/settings/privacy';
  import {SpicyFollowGate as WebGate} from '@dvnt/app/components/feed/spicy-follow-gate.web';
  import {SpicyFollowGate as NativeGate} from '@dvnt/app/components/feed/spicy-follow-gate';
  import {FollowStatusRefresh as WebStatus} from '@dvnt/app/components/feed/follow-status-refresh.web';
  import {FollowStatusRefresh as NativeStatus} from '@dvnt/app/components/feed/follow-status-refresh';
  import {state,useAuth} from 'fixture';export {state,useAuth};export {act} from 'react';
  import {getFollowIdentity,assertFollowIdentity} from '@dvnt/app/lib/auth/follow-identity';
  import {isSpicyPostLocked} from '@dvnt/app/components/feed/spicy-lock';
  async function readProjection(kind,identity) {
    state.postReads.push({kind,owner:identity.viewerId});
    const result={isNSFW:true,isSpicyLocked:true,spicyAccessViewerId:identity.authId,caption:'OLD_CACHED_ORIGINAL',...state.postResponses[identity.viewerId]};
    if(state.postHold)await new Promise(resolve=>state.postReleases.push(resolve));
    assertFollowIdentity(identity);
    return result;
  }
  function ProtectedFeed({native=false}) {
    useAuth(s=>s.user);
    const identity=getFollowIdentity();
    const owner=JSON.stringify(identity);
    const posts=useQuery({queryKey:['posts','follow-refresh-test',owner],enabled:!!identity,queryFn:()=>readProjection('posts',identity),staleTime:Infinity});
    const profile=useQuery({queryKey:['profilePosts','follow-refresh-test',owner],enabled:!!identity,queryFn:()=>readProjection('profilePosts',identity),staleTime:Infinity});
    const Gate=native?NativeGate:WebGate;
    return <><span data-testid="profile-state">{profile.data?.isSpicyLocked===false?'Permitted profile projection':'Protected profile projection'}</span>{!posts.data?<p>Checking post access…</p>:isSpicyPostLocked(posts.data)?<><Gate author={{id:'target',username:'Target'}}/><Gate author={{id:'target',username:'Target'}}/></>:<p data-testid="permitted-post">{posts.data.caption}</p>}</>;
  }
  const WebFeed=()=> <ProtectedFeed/>;const NativeFeed=()=> <ProtectedFeed native/>;
  const WebProfileStatus=()=> <WebStatus targetId="target"/>;const NativeProfileStatus=()=> <NativeStatus targetId="target"/>;
  export {publishSessionBoundary} from '@dvnt/app/lib/auth/session-lifecycle';
  const screens={web:Web,native:Native,'web-status':WebProfileStatus,'native-status':NativeProfileStatus,'web-feed':WebFeed,'native-feed':NativeFeed,'native-privacy':NativePrivacy,'web-settings':WebSettings,'ios-settings':IOSSettings,'android-settings':AndroidSettings,'web-gate':WebGate,'native-gate':NativeGate};
  export const mount=(node)=>{const root=createRoot(node);const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});let mounted=true;return {client,render:screen=>{const Screen=screens[screen];root.render(<React.StrictMode><QueryClientProvider client={client}><Screen author={{id:'target',username:'Target'}}/></QueryClientProvider></React.StrictMode>);},unmount:()=>{if(mounted){mounted=false;root.unmount();client.clear();}}};};`;

module.exports = { fixtures, entry };

if (require.main === module) (async () => {
  const { Window } = await import(resolve("happy-dom"));
  const window = new Window({ url: "https://fixture.invalid" });
  Object.assign(global, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "follow-requests-ui-"));
  try {
    await build({
      stdin: { contents: entry, resolveDir: ROOT, loader: "tsx" },
      bundle: true,
      platform: "node",
      format: "cjs",
      jsx: "automatic",
      tsconfigRaw: { compilerOptions: { jsx: "react-jsx" } },
      define: { __DEV__: "true" },
      outfile: path.join(dir, "test.cjs"),
      nodePaths: deps,
      alias: Object.fromEntries(
        ["react", "react-dom", "zustand", "@tanstack/react-query"].map(
          (name) => [name, path.dirname(resolve(name + "/package.json"))],
        ),
      ),
      plugins: [
        {
          name: "offline-fixtures",
          setup(b) {
            b.onResolve({ filter: /.*/ }, (a) => {
              let canonical = a.path;
              if (a.path.startsWith(".")) {
                canonical =
                  "@dvnt/app/" +
                  path
                    .relative(
                      path.join(ROOT, "packages/app"),
                      path.resolve(a.resolveDir, a.path),
                    )
                    .replace(/\\/g, "/");
              }
              if (Object.hasOwn(fixtures, canonical))
                return { path: canonical, namespace: "fixture" };
              if (canonical.startsWith("@dvnt/app/")) {
                const stem = path.join(
                  ROOT,
                  "packages/app",
                  canonical.slice(10),
                );
                const suffixes = a.importer.endsWith(".web.tsx")
                  ? [".web.tsx", "", ".ts", ".tsx"]
                  : ["", ".ts", ".tsx"];
                for (const ext of suffixes)
                  if (
                    fs.existsSync(stem + ext) &&
                    fs.statSync(stem + ext).isFile()
                  )
                    return { path: stem + ext };
              }
            });
            b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({
              contents: fixtures[a.path],
              loader: "tsx",
              resolveDir: ROOT,
            }));
          },
        },
      ],
    });
    const f = require(path.join(dir, "test.cjs"));
    const flush = (fn) =>
      f.act(async () => {
        await fn?.();
        await new Promise((r) => setTimeout(r, 20));
      });
    const byText = (text) =>
      [...document.querySelectorAll("button")].find(
        (b) => b.textContent === text,
      );
    const byLabel = (text) =>
      [...document.querySelectorAll("button")].find(
        (b) => b.getAttribute("aria-label") === text,
      );
    const request = (id, username) => ({
      follower_id: id,
      created_at: "2026-11-09T00:00:00Z",
      requester: username ? { username } : null,
    });
    const release = (name) => f.state[name].splice(0).forEach((r) => r());
    const switchAccount = (id, authId) => {
      f.publishSessionBoundary({ ready: true, authId });
      f.useAuth.setState({
        user: id ? { id, authId, username: "Owner" } : null,
      });
    };
    const reset = () => {
      Object.assign(f.state, {
        calls: [],
        reads: [],
        navigations: [],
        pending: false,
        fail: false,
        loadFail: false,
        loadHold: false,
        statusHold: false,
        statusFail: false,
        releases: [],
        readReleases: [],
        statusReleases: [],
        requests: {
          "owner-a": [request(2, "First"), request(3, "Friend & co")],
          "owner-b": [],
        },
        statuses: {},
        statusReads: 0,
        overlayResets: 0,
        postReads: [],
        postResponses: {},
        postHold: false,
        postReleases: [],
        gateCalls: [],
        gateCallbacks: [],
        verification: { state: "approved", reason: null },
        admission: { state: "allowed", reason: "verified" },
        verificationError: false,
        admissionError: false,
      });
      switchAccount("owner-a", "auth-a");
    };
    for (const platform of ["web", "native"]) {
      reset();
      const node = document.createElement("div");
      document.body.append(node);
      const app = f.mount(node);
      try {
        f.state.loadHold = true;
        if (platform === "web") window.location.hash = "#follow-requests";
        await flush(() => app.render(platform));
        if (platform === "web")
          assert.equal(
            document.activeElement.id,
            "follow-requests",
            "direct Settings link focuses the requests panel after navigation",
          );
        assert.match(node.textContent, /Loading requests/);
        await flush(() => {
          f.state.loadHold = false;
          release("readReleases");
        });
        await flush();
        const profileLabel = "View Friend & co's profile";
        if (platform === "web") {
          // Some supported Happy DOM versions misparse apostrophes in CSS
          // attribute selectors. Compare the exact accessible label directly.
          const link = [...node.querySelectorAll("a")].find(
            (candidate) =>
              candidate.getAttribute("aria-label") === profileLabel,
          );
          assert.ok(
            link,
            "Requester profile link must have its exact accessible label",
          );
          assert.equal(link.getAttribute("href"), "/profile/Friend%20%26%20co");
        } else {
          await flush(() => byLabel(profileLabel).click());
          assert.equal(
            f.state.navigations.at(-1),
            "/profile/Friend%20%26%20co",
          );
        }
        f.state.pending = true;
        const approve = byLabel("Approve First's follow request");
        await flush(() => {
          approve.click();
          approve.click();
        });
        assert.equal(f.state.calls.length, 1, "rapid taps send one mutation");
        assert.equal(approve.textContent, "Approving…");
        assert.equal(approve.getAttribute("aria-busy"), "true");
        assert.equal(
          byLabel("Decline Friend & co's follow request").disabled,
          true,
        );
        assert.equal(byLabel("Refresh follow requests").disabled, true);
        await flush(() => {
          f.state.pending = false;
          release("releases");
        });
        await flush();
        assert.match(node.textContent, /Request approved/);
        assert.equal(byLabel("Approve First's follow request"), undefined);

        f.state.fail = true;
        await flush(() =>
          byLabel("Decline Friend & co's follow request").click(),
        );
        assert.match(
          node.textContent,
          /Could not decline request.*Connection interrupted/,
        );
        assert.equal(
          byLabel("Decline Friend & co's follow request").disabled,
          false,
        );
        f.state.fail = false;
        f.state.pending = true;
        await flush(() =>
          byLabel("Decline Friend & co's follow request").click(),
        );
        assert.ok(byText("Declining…"));
        await flush(() => {
          f.state.pending = false;
          release("releases");
        });
        await flush();
        assert.match(node.textContent, /No pending requests/);
        assert.match(node.textContent, /Request declined/);

        f.state.requests["owner-a"] = [request(4, null)];
        f.state.loadHold = true;
        await flush(() => byLabel("Refresh follow requests").click());
        assert.ok(byText("Refreshing…"));
        assert.equal(byText("Refreshing…").disabled, true);
        await flush(() => {
          f.state.loadHold = false;
          release("readReleases");
        });
        await flush();
        assert.ok(byLabel("Approve Member's follow request"));
        assert.equal(
          node.querySelectorAll("a").length,
          0,
          "missing usernames do not create broken profile links",
        );

        f.state.loadFail = true;
        await flush(() => byLabel("Refresh follow requests").click());
        assert.match(node.textContent, /Could not load requests/);
        assert.equal(
          byLabel("Approve Member's follow request"),
          undefined,
          "failed refresh hides stale actions",
        );
        f.state.loadFail = false;
        f.state.loadHold = true;
        await flush(() => byText("Retry").click());
        assert.ok(byText("Retrying…"));
        await flush(() => {
          f.state.loadHold = false;
          release("readReleases");
        });
        await flush();
        assert.ok(byLabel("Approve Member's follow request"));

        f.state.pending = true;
        await flush(() => byLabel("Approve Member's follow request").click());
        await flush(() => switchAccount("owner-b", "auth-b"));
        await flush();
        assert.match(node.textContent, /No pending requests/);
        assert.doesNotMatch(
          node.textContent,
          /Approving|Request approved|Request declined/,
        );
        await flush(() => switchAccount("owner-a", "auth-a"));
        await flush();
        assert.equal(
          byLabel("Approve Member's follow request").disabled,
          false,
          "new sign-in does not inherit the old pending lock",
        );
        await flush(() => {
          f.state.pending = false;
          release("releases");
        });
        await flush();
        assert.doesNotMatch(
          node.textContent,
          /Request approved|Account changed/,
        );
        // Even batched store-only account changes must clear in-flight labels.
        f.state.pending = true;
        await flush(() => byLabel("Approve Member's follow request").click());
        await flush(() => {
          f.useAuth.setState({ user: { id: "owner-b", authId: "auth-b" } });
          f.useAuth.setState({ user: { id: "owner-a", authId: "auth-a" } });
        });
        await flush();
        assert.doesNotMatch(node.textContent, /Approving request/);
        await flush(() => {
          f.state.pending = false;
          release("releases");
        });
        await flush(() => switchAccount(null, undefined));
        assert.equal(node.textContent, "");
        console.log(
          `PASS ${platform}: request loading, profile links, repeated taps, action progress, errors/retry, empty/refresh states, and account/session isolation`,
        );
      } finally {
        await flush(() => app.unmount());
        node.remove();
        window.location.hash = "";
      }
    }

    for (const screen of ["web-settings", "ios-settings", "android-settings"]) {
      reset();
      const node = document.createElement("div");
      document.body.append(node);
      const app = f.mount(node);
      try {
        await flush(() => app.render(screen));
        await flush();
        const row = () =>
          [...node.querySelectorAll("button")].find((b) =>
            b.textContent.startsWith("Follow requests"),
          );
        assert.match(row().textContent, /2 pending/);
        await flush(() => row().click());
        assert.equal(
          f.state.navigations.at(-1),
          screen === "web-settings"
            ? "/settings/privacy#follow-requests"
            : "/settings/privacy",
        );
        await flush(() =>
          app.render(screen === "web-settings" ? "web" : "native-privacy"),
        );
        if (screen !== "web-settings")
          assert.ok(
            node.textContent.indexOf("Page visibility") <
              node.textContent.indexOf("Follow requests") &&
              node.textContent.indexOf("Follow requests") <
                node.textContent.indexOf("Activity Status"),
            "native requests follow Page visibility and precede unrelated controls",
          );
        await flush();
        await flush(() => byLabel("Approve First's follow request").click());
        await flush();
        await flush(() => app.render(screen));
        await flush();
        assert.match(
          row().textContent,
          /1 pending/,
          "returning to Settings shows the updated count",
        );
        f.state.loadFail = true;
        await flush(() =>
          app.client.invalidateQueries({ queryKey: ["follow-requests"] }),
        );
        assert.match(
          row().textContent,
          /Check requests/,
          "failed count is not presented as zero",
        );
        f.state.loadFail = false;
        await flush(() => switchAccount("owner-b", "auth-b"));
        await flush();
        assert.match(row().textContent, /0 pending/);
        await flush(() => switchAccount(null, undefined));
        assert.equal(row(), undefined);
        console.log(
          `PASS ${screen}: discoverable request entry, navigation, live count updates, read failures, and account isolation`,
        );
      } finally {
        await flush(() => app.unmount());
        node.remove();
      }
    }

    for (const screen of ["web-gate", "native-gate"]) {
      reset();
      f.state.statuses["owner-a"] = {
        following: false,
        followRequestStatus: "pending",
      };
      const node = document.createElement("div");
      document.body.append(node);
      const app = f.mount(node);
      try {
        await flush(() => app.render(screen));
        await flush();
        assert.ok(byText("Check request status"));
        assert.ok(byText("Cancel follow request"));
        assert.equal(
          f.state.statusReads,
          1,
          "gate and refresh share the same query",
        );
        f.state.statusHold = true;
        await flush(() => byText("Check request status").click());
        assert.equal(byText("Checking…").disabled, true);
        assert.equal(
          f.state.calls.length,
          0,
          "status checks cannot approve requests",
        );
        f.state.statusFail = true;
        await flush(() => {
          f.state.statusHold = false;
          release("statusReleases");
        });
        await flush();
        assert.ok(byText("Retry follow status"));
        assert.equal(byText("Cancel follow request").disabled, true);
        f.state.statusFail = false;
        f.state.statuses["owner-a"] = {
          following: true,
          followRequestStatus: "approved",
        };
        await flush(() => byText("Retry follow status").click());
        await flush();
        assert.equal(byText("Check request status"), undefined);
        assert.match(
          node.textContent,
          /This post is still protected by its access settings/,
        );
        await flush(() => switchAccount("owner-b", "auth-b"));
        await flush();
        assert.doesNotMatch(
          node.textContent,
          /Cancel follow request|Check request status/,
        );
        assert.equal(f.state.calls.length, 0);
        console.log(
          `PASS ${screen}: shared status query, visible refresh progress, failure/retry, server-gated access, and account isolation`,
        );
      } finally {
        await flush(() => app.unmount());
        node.remove();
      }
    }
    for (const screen of ["web-gate", "native-gate"]) {
      const personas = [
        {
          name: "legacy allowed",
          verification: { state: "not_started", reason: null },
          admission: { state: "allowed", reason: "not_enforced" },
          allowed: true,
        },
        {
          name: "legacy grace",
          verification: { state: "not_started", reason: null },
          admission: { state: "grace", reason: "verification_required" },
          allowed: true,
        },
        { name: "approved adult", allowed: true },
        {
          name: "pending ID, allowed account",
          verification: { state: "pending", reason: null },
          allowed: true,
        },
        {
          name: "retryable ID, grace account",
          verification: {
            state: "retry_required",
            reason: "age_evidence_missing",
          },
          admission: { state: "grace" },
          allowed: true,
        },
        {
          name: "minor",
          verification: { state: "rejected", reason: "underage" },
          allowed: false,
        },
        {
          name: "rejected",
          verification: { state: "rejected", reason: "duplicate_identity" },
          allowed: false,
        },
        {
          name: "explicit underage evidence",
          verification: { state: "approved", reason: "underage" },
          allowed: false,
        },
        {
          name: "operator denied",
          admission: { state: "blocked", reason: "operator_denied" },
          allowed: false,
        },
        {
          name: "blocked account",
          admission: { state: "blocked", reason: "verification_required" },
          allowed: false,
        },
        {
          name: "verification read failed",
          verificationError: true,
          allowed: false,
        },
        { name: "admission read failed", admissionError: true, allowed: false },
        {
          name: "verification still loading",
          verification: null,
          allowed: false,
        },
        { name: "admission still loading", admission: null, allowed: false },
        { name: "signed out", guest: true, allowed: false },
      ];
      for (const persona of personas) {
        reset();
        for (const field of [
          "verification",
          "admission",
          "verificationError",
          "admissionError",
        ]) {
          if (Object.hasOwn(persona, field)) f.state[field] = persona[field];
        }
        if (persona.guest) switchAccount(null, undefined);
        const node = document.createElement("div");
        document.body.append(node);
        const app = f.mount(node);
        try {
          await flush(() => app.render(screen));
          await flush();
          const follow = byText("Request to FOLLOW");
          assert.equal(
            follow.disabled,
            !persona.allowed,
            `${screen}: ${persona.name}`,
          );
          await flush(() => follow.click());
          assert.equal(
            f.state.gateCalls.length,
            persona.allowed ? 1 : 0,
            `${persona.name}: no unauthorized follow call`,
          );
          assert.equal(
            node.querySelector('[data-testid="permitted-post"]'),
            null,
            "following never locally grants media access",
          );
          assert.doesNotMatch(
            node.textContent,
            /Verified adult access is required|verify your age to continue/,
          );
        } finally {
          await flush(() => app.unmount());
          node.remove();
        }
      }
      console.log(
        `PASS ${screen}: 15 legacy/approved/minor/denied/error/loading/guest personas preserve follow eligibility without granting local media access`,
      );
    }

    for (const screen of ["web-feed", "native-feed"]) {
      for (const relationshipStatus of ["approved", "none"]) {
        for (const allowed of [true, false]) {
          reset();
          f.state.statuses["owner-a"] = {
            following: true,
            followRequestStatus: relationshipStatus,
          };
          f.state.statusHold = true;
          const node = document.createElement("div");
          document.body.append(node);
          const app = f.mount(node);
          try {
            await flush(() => app.render(screen));
            await flush();
            await flush();
            assert.equal(
              f.state.postReads.length,
              2,
              "start with stale locked feed/profile projections and no successful status read",
            );
            assert.equal(
              node.querySelector('[data-testid="permitted-post"]'),
              null,
            );
            f.state.postResponses["owner-a"] = {
              isSpicyLocked: !allowed,
              caption: "First-check permitted post",
            };
            f.state.postHold = true;
            await flush(() => {
              f.state.statusHold = false;
              release("statusReleases");
            });
            await flush();
            assert.equal(
              f.state.postReads.length,
              4,
              "an initially followed private/public locked gate must refresh post/profile projections",
            );
            assert.equal(
              f.state.overlayResets,
              1,
              "duplicate cards recover an initial approval only once",
            );
            assert.doesNotMatch(
              node.textContent,
              /First-check permitted post|OLD_CACHED_ORIGINAL/,
            );
            await flush(() => {
              f.state.postHold = false;
              release("postReleases");
            });
            await flush();
            await flush();
            if (allowed) {
              assert.equal(
                node.querySelector('[data-testid="permitted-post"]')
                  .textContent,
                "First-check permitted post",
              );
            } else {
              assert.equal(
                node.querySelector('[data-testid="permitted-post"]'),
                null,
                "server denial remains authoritative after approved status",
              );
              assert.equal(
                f.state.postReads.length,
                4,
                "a still-protected server response cannot trigger a recovery loop",
              );
              assert.ok(
                byText("Unfollow"),
                "following controls the action even when request status is none",
              );
              await flush(() => byText("Unfollow").click());
              assert.equal(
                f.state.gateCalls.at(-1).variables.action,
                "unfollow",
              );
              await flush(() =>
                app.render(screen === "web-feed" ? "web" : "native"),
              );
              await flush();
              await flush(() => app.render(screen));
              await flush();
              await flush();
              assert.equal(
                f.state.overlayResets,
                1,
                "remounts with a new status read do not repeat initial recovery",
              );
              assert.equal(
                f.state.postReads.length,
                6,
                "remount only performs the normal feed/profile reads",
              );
              assert.equal(
                node.querySelector('[data-testid="permitted-post"]'),
                null,
              );
              f.state.statuses["owner-b"] = {
                following: true,
                followRequestStatus: relationshipStatus,
              };
              await flush(() => switchAccount("owner-b", "auth-b"));
              await flush();
              await flush();
              assert.equal(
                f.state.overlayResets,
                2,
                "the recovery bound belongs to one account/session",
              );
              assert.equal(
                f.state.postReads.filter((read) => read.owner === "owner-b")
                  .length,
                4,
              );
              assert.equal(
                node.querySelector('[data-testid="permitted-post"]'),
                null,
              );
            }
          } finally {
            await flush(() => app.unmount());
            node.remove();
          }
        }
      }
      console.log(
        `PASS ${screen}: first-read private/public following recovers stale locked content once, server denial cannot loop across cards/remounts, and recovery is account-scoped`,
      );
    }
    for (const screen of ["web-status", "native-status"]) {
      reset();
      f.state.statuses["owner-a"] = {
        following: true,
        followRequestStatus: "approved",
      };
      const node = document.createElement("div");
      document.body.append(node);
      const app = f.mount(node);
      try {
        const unrelated = { caption: "Unrelated cached post" };
        app.client.setQueryDefaults(["posts"], { gcTime: Infinity });
        app.client.setQueryData(["posts", "unrelated"], unrelated);
        await flush(() => app.render(screen));
        await flush();
        assert.equal(
          f.state.overlayResets,
          0,
          "profile-only initial approval must not reset unrelated protected queries",
        );
        assert.equal(
          app.client.getQueryData(["posts", "unrelated"]),
          unrelated,
        );
      } finally {
        await flush(() => app.unmount());
        node.remove();
      }
    }

    for (const screen of ["web-feed", "native-feed"]) {
      for (const allowed of [true, false]) {
        reset();
        f.state.statuses["owner-a"] = {
          following: false,
          followRequestStatus: "none",
        };
        const node = document.createElement("div");
        document.body.append(node);
        const app = f.mount(node);
        try {
          await flush(() => app.render(screen));
          await flush();
          await flush();
          assert.ok(byText("Request to FOLLOW"));
          assert.equal(f.state.postReads.length, 2);
          f.state.statuses["owner-a"] = {
            following: true,
            followRequestStatus: "none",
          };
          f.state.postResponses["owner-a"] = {
            isSpicyLocked: !allowed,
            caption: "Public server-permitted post",
          };
          f.state.postHold = true;
          await flush(() =>
            app.client.invalidateQueries({
              queryKey: ["follow-request-status"],
            }),
          );
          await flush();
          assert.equal(
            f.state.postReads.length,
            4,
            "none/false to none/true refetches protected projections even without an enum change",
          );
          assert.equal(f.state.overlayResets, 1);
          assert.doesNotMatch(
            node.textContent,
            /Public server-permitted post|OLD_CACHED_ORIGINAL/,
          );
          await flush(() => {
            f.state.postHold = false;
            release("postReleases");
          });
          await flush();
          await flush();
          if (allowed) {
            assert.equal(
              node.querySelector('[data-testid="permitted-post"]').textContent,
              "Public server-permitted post",
            );
          } else {
            assert.equal(
              node.querySelector('[data-testid="permitted-post"]'),
              null,
            );
            assert.ok(byText("Unfollow"));
            await flush(() => byText("Unfollow").click());
            assert.equal(f.state.gateCalls.at(-1).variables.action, "unfollow");
            assert.equal(
              f.state.postReads.length,
              4,
              "a denied public payload cannot cause a refetch loop",
            );
            assert.equal(
              node.querySelector('[data-testid="permitted-post"]'),
              null,
            );
          }
        } finally {
          await flush(() => app.unmount());
          node.remove();
        }
      }
      console.log(
        `PASS ${screen}: public following transitions refresh once, use Unfollow, and wait for server-permitted payloads`,
      );
    }

    for (const screen of ["web-feed", "native-feed"]) {
      for (const outcome of [
        "approved",
        "declined",
        "cancelled",
        "approved-but-protected",
      ]) {
        reset();
        f.state.statuses["owner-a"] = {
          following: false,
          followRequestStatus: "pending",
        };
        const node = document.createElement("div");
        document.body.append(node);
        const app = f.mount(node);
        try {
          await flush(() => app.render(screen));
          await flush();
          await flush();
          assert.ok(byText("Check request status"));
          assert.equal(f.state.postReads.length, 2);
          const approved = outcome.startsWith("approved");
          f.state.statuses["owner-a"] = {
            following: approved,
            followRequestStatus: approved ? "approved" : "none",
          };
          f.state.postResponses["owner-a"] = {
            isSpicyLocked: outcome !== "approved",
            caption: "Server-permitted post",
          };
          f.state.postHold = true;
          await flush(() => byText("Check request status").click());
          await flush();
          assert.equal(
            f.state.overlayResets,
            1,
            "two gates and explicit/background observers reset access only once",
          );
          assert.equal(
            f.state.postReads.length,
            4,
            "status change refetches post and profile projections exactly once",
          );
          assert.equal(
            node.querySelector('[data-testid="permitted-post"]'),
            null,
            "approved status alone cannot reveal posts",
          );
          assert.doesNotMatch(
            node.textContent,
            /OLD_CACHED_ORIGINAL|Server-permitted post/,
          );
          assert.match(node.textContent, /Checking post access/);
          await flush(() => {
            f.state.postHold = false;
            release("postReleases");
          });
          await flush();
          if (outcome === "approved") {
            assert.equal(
              node.querySelector('[data-testid="permitted-post"]').textContent,
              "Server-permitted post",
            );
            assert.match(node.textContent, /Permitted profile projection/);
          } else {
            assert.equal(
              node.querySelector('[data-testid="permitted-post"]'),
              null,
            );
            assert.match(node.textContent, /Request to FOLLOW/);
          }
          assert.doesNotMatch(node.textContent, /OLD_CACHED_ORIGINAL/);
        } finally {
          await flush(() => app.unmount());
          node.remove();
        }
      }

      reset();
      f.state.statuses["owner-a"] = {
        following: false,
        followRequestStatus: "pending",
      };
      const backgroundNode = document.createElement("div");
      document.body.append(backgroundNode);
      const background = f.mount(backgroundNode);
      try {
        await flush(() => background.render(screen));
        await flush();
        await flush();
        f.state.statuses["owner-a"] = {
          following: true,
          followRequestStatus: "approved",
        };
        f.state.postResponses["owner-a"] = {
          isSpicyLocked: false,
          caption: "Background-approved post",
        };
        await flush(() =>
          background.client.invalidateQueries({
            queryKey: ["follow-request-status"],
          }),
        );
        await flush();
        await flush();
        assert.equal(
          backgroundNode.querySelector('[data-testid="permitted-post"]')
            .textContent,
          "Background-approved post",
          "fresh background status changes also refresh protected content",
        );
        assert.equal(f.state.overlayResets, 1);
      } finally {
        await flush(() => background.unmount());
        backgroundNode.remove();
      }

      for (const pauseAt of ["status", "posts"]) {
        reset();
        f.state.statuses["owner-a"] = {
          following: false,
          followRequestStatus: "pending",
        };
        const node = document.createElement("div");
        document.body.append(node);
        const app = f.mount(node);
        try {
          await flush(() => app.render(screen));
          await flush();
          await flush();
          f.state.statuses["owner-a"] = {
            following: true,
            followRequestStatus: "approved",
          };
          f.state.postResponses["owner-a"] = {
            isSpicyLocked: false,
            caption: "Old account private post",
          };
          f.state.statusHold = pauseAt === "status";
          f.state.postHold = pauseAt === "posts";
          await flush(() => byText("Check request status").click());
          await flush();
          const resetsBeforeSwitch = f.state.overlayResets;
          await flush(() => {
            f.state.postHold = false;
            switchAccount("owner-b", "auth-b");
          });
          await flush();
          const bQueries = app.client
            .getQueryCache()
            .findAll({ queryKey: ["posts"] })
            .filter((q) => JSON.stringify(q.queryKey).includes("owner-b"));
          assert.equal(bQueries.length, 1);
          const bData = bQueries[0].state.data;
          await flush(() => {
            f.state.statusHold = false;
            release("statusReleases");
            release("postReleases");
          });
          await flush();
          await flush();
          assert.equal(
            f.state.overlayResets,
            resetsBeforeSwitch,
            "old completions cannot reset the new account's overlays or caches",
          );
          assert.equal(bQueries[0].state.data, bData);
          assert.equal(
            f.state.postReads.filter((read) => read.owner === "owner-b").length,
            2,
            "new account projections are fetched only by their own mount",
          );
          assert.equal(
            node.querySelector('[data-testid="permitted-post"]'),
            null,
          );
          assert.doesNotMatch(node.textContent, /Old account private post/);
        } finally {
          await flush(() => app.unmount());
          node.remove();
        }
      }
      console.log(
        `PASS ${screen}: fresh status changes refetch protected post/profile projections, deny stale originals, preserve locks after rejection/cancellation, and isolate account switches during either await`,
      );
    }

    for (const screen of ["web-gate", "native-gate"]) {
      reset();
      const node = document.createElement("div");
      document.body.append(node);
      const app = f.mount(node);
      try {
        await flush(() => app.render(screen));
        await flush();
        const first = byText("Request to FOLLOW");
        await flush(() => {
          first.click();
          first.click();
        });
        assert.equal(f.state.gateCalls.length, 1);
        await flush(() => switchAccount("owner-b", "auth-b"));
        await flush();
        await flush(() => f.state.gateCallbacks[0]());
        await flush(() => byText("Request to FOLLOW").click());
        assert.equal(
          f.state.gateCalls.length,
          2,
          "suppressed old-account callbacks cannot leave the new account locked",
        );
        await flush(() => {
          f.state.gateCallbacks[0]();
          byText("Request to FOLLOW").click();
        });
        assert.equal(
          f.state.gateCalls.length,
          2,
          "old callbacks cannot unlock a new in-flight operation",
        );
        await flush(() => f.state.gateCallbacks[1]());
        await flush(() => byText("Request to FOLLOW").click());
        assert.equal(f.state.gateCalls.length, 3);
        await flush(() => {
          f.useAuth.setState({ user: { id: "owner-a", authId: "auth-a" } });
          f.useAuth.setState({ user: { id: "owner-b", authId: "auth-b" } });
        });
        await flush();
        await flush(() => byText("Request to FOLLOW").click());
        assert.equal(
          f.state.gateCalls.length,
          4,
          "batched store-only account changes also release obsolete locks",
        );
        console.log(
          `PASS ${screen}: repeated actions remain locked only to their initiating account/session`,
        );
      } finally {
        await flush(() => app.unmount());
        node.remove();
      }
    }
  } finally {
    await window.happyDOM.abort();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
