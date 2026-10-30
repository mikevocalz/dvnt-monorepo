#!/usr/bin/env node
/**
 * Mounted production ticket-detail screens, not copied action components.
 * Runs web HTML and native screen handlers (RN host views map to DOM buttons).
 * Network/auth/QR/wallet edges are offline fixtures; no service is contacted.
 * The real shared eligibility helper and web UI store stay in the bundle.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const ROOT = path.resolve(__dirname, "..");
const dependencyPaths = (process.env.NODE_PATH || "")
  .split(path.delimiter)
  .filter(Boolean);
const resolveDependency = (name) =>
  require.resolve(name, {
    paths: [ROOT, ...dependencyPaths],
  });
const { build } = require(resolveDependency("esbuild"));

const fixture = {
  "ticket-test-fixture": `import {create} from 'zustand';
    export const state = {edgeCalls:[],edgeResponse:{ok:true},edgeError:null,tokenError:false,calls:[],toasts:[],navigations:[],invalidations:[],queries:[],defer:false,releases:[],response:undefined,throwError:false};
    export const useFixture=create(()=>({routeId:'ticket-a',viewerId:'viewer-a',ticket:null,group:null,isLoading:false,isError:false,addons:[],storeTicket:undefined,pendingError:false,incoming:[],outgoing:[]}));
    export const router={back:()=>state.navigations.push('back'),push:p=>state.navigations.push(p),replace:p=>state.navigations.push(p)};
    export const queryClient={cancelQueries:async()=>{},setQueriesData:(filter,update)=>{const s=useFixture.getState();if(filter.queryKey[1]!==s.viewerId)return;const next=update(s.ticket?[s.ticket]:[]);if(next?.[0])useFixture.setState({ticket:next[0]});},invalidateQueries:async input=>{state.invalidations.push(input.queryKey);}};
    export async function perform(method,args){
      state.calls.push({method,args});
      if(state.defer) await new Promise(resolve=>state.releases.push(resolve));
      if(state.throwError) throw new Error('Connection interrupted');
      return state.response === undefined ? {ok:true,ticket_id:typeof args==='string'?args:undefined,status:'void',message:'Request completed'} : state.response;
    }
    export const ticketsApi={
      cancelFreeTicket:id=>perform('cancelFreeTicket',id),
      requestRefund:id=>perform('requestRefund',id),
      requestLineRefund:input=>perform('requestLineRefund',input),
      getPendingTransfers:async()=>({outgoing:[],incoming:[]}),
      cancelTransfer:id=>perform('cancelTransfer',id),
      initiateTransfer:(id,username)=>perform('initiateTransfer',{id,username})
    };`,
  "solito/navigation": `import {useFixture,router} from 'ticket-test-fixture';export const useParams=()=>({id:useFixture(s=>s.routeId)});export const useRouter=()=>router;`,
  "expo-router": `import {useFixture,router} from 'ticket-test-fixture';export const useLocalSearchParams=()=>({id:useFixture(s=>s.routeId)});export const useRouter=()=>router;`,
  "@tanstack/react-query": `import {state,useFixture,queryClient} from 'ticket-test-fixture';export const useQueryClient=()=>queryClient;export const useQuery=input=>{const s=useFixture();state.queries.push(input.queryKey);return {data:input.queryKey[0]==='my-order-addons'?s.addons:input.queryKey[0]==='ticket-transfers'?{outgoing:s.outgoing,incoming:s.incoming}:[],isLoading:false,isError:input.queryKey[0]==='ticket-transfers'&&s.pendingError,refetch:()=>{state.calls.push({method:'retryTransferStatus'});useFixture.setState({pendingError:false,outgoing:[{id:'transfer-a',ticket_id:'ticket-a'}]});}};};`,
  "@dvnt/app/lib/hooks/use-tickets": `import {useFixture,state} from 'ticket-test-fixture';export const useTicketViewerId=()=>useFixture(s=>s.viewerId);export const useTicketRoute=()=>{const s=useFixture();return {resolution:s.ticket?{kind:'ticket',ticket:s.ticket,group:s.group??[s.ticket],index:0}:{kind:'not-found'},eventId:s.ticket?String(s.ticket.event_id):undefined,isLoading:s.isLoading,isError:s.isError,isRefetching:false,refetch:()=>{}};};export const useMyTickets=()=>{const s=useFixture();return {data:s.ticket?[s.ticket]:[],isLoading:s.isLoading,isPending:s.isLoading,isError:s.isError,isRefetching:false,refetch:()=>{}};};export const useTicketViewerAuthId=()=>useFixture(s=>s.viewerId);export const ticketKeys={};export const usePendingTransfers=()=>{const s=useFixture();return {data:s.incoming,isError:s.pendingError,isRefetching:false,refetch:()=>{state.calls.push({method:'retryTransfers'});useFixture.setState({pendingError:false,incoming:[{id:'incoming-a',tickets:{events:{title:'Incoming concert'}}}]});}};};export const useTransferSender=()=>({data:null});export const useSetAttendeeName=()=>({isPending:false,mutateAsync:async()=>({})});`,
  "@dvnt/app/lib/supabase/client": `import {state} from 'ticket-test-fixture';export const supabase={functions:{invoke:async(name,input)=>{state.edgeCalls.push({name,input});return {data:state.edgeResponse,error:state.edgeError};}}};`,
  "@dvnt/app/lib/api/auth-helper": `export const getCurrentUserAuthId=async()=> 'viewer-a';`,
  "@dvnt/app/lib/auth/identity": `import {state} from 'ticket-test-fixture';export const requireBetterAuthToken=async()=>{if(state.tokenError)throw new Error('Authentication required');return 'fixture-auth-token';};`,
  "@dvnt/app/lib/api/invoke-edge": `export const invokeEdge=()=>{throw new Error('Unexpected edge path')};`,
  "@dvnt/app/lib/stores/offline-checkin-store": `export const useOfflineCheckinStore={getState:()=>({setAddonTokensForEvent(){}})};`,
  "@dvnt/app/lib/stores/promoter-ref-store": `export const getPendingPromoterRef=()=>null;`,
  "@dvnt/app/lib/api/tickets": `export {ticketsApi} from 'ticket-test-fixture';`,
  "@dvnt/app/lib/api/ticket-types": `export const ticketTypesApi={getByEvent:async()=>[]};`,
  "@dvnt/app/lib/api/addons": `export const addonsApi={getMyAddonsForEvent:async()=>[]};`,
  "@dvnt/app/lib/stores/ticket-store": `import {useFixture} from 'ticket-test-fixture';export const useTicketStore=selector=>{const s=useFixture();return selector({getTicketByEventId:()=>s.storeTicket});};`,
  "@dvnt/app/lib/stores/ui-store": `import {state} from 'ticket-test-fixture';const value={showToast:(...args)=>state.toasts.push(args)};export const useUIStore=selector=>selector(value);useUIStore.getState=()=>value;`,
  "@tanstack/react-virtual": `export const useVirtualizer=({count})=>({getTotalSize:()=>count*150,getVirtualItems:()=>Array.from({length:count},(_,index)=>({index,start:index*150})),measureElement:()=>{}});`,
  "@dvnt/app/lib/hooks/use-scroll-restoration.web": `export const useScrollRestoration=()=>{};`,
  "@dvnt/app/components/ui/card-link.web": `export const CardLink=({children,href})=><a href={href}>{children}</a>;`,
  "@dvnt/app/lib/navigation/use-motion-tier": `export const useMotionTier=()=> 'lite';`,
  sonner: `export const toast=Object.assign(()=>{}, {error:()=>{},success:()=>{}});`,
  "react-native-reanimated": `const Fade={duration:()=>Fade,delay:()=>Fade,springify:()=>Fade};export const FadeIn=Fade;export const FadeInDown=Fade;export default {View:({children})=><div>{children}</div>};`,
  "expo-image": `export const Image=()=>null;`,
  "@dvnt/app/components/list": `export const LegendList=({data,renderItem})=><div>{data.map((item,index)=><div key={index}>{renderItem({item,index})}</div>)}</div>;`,
  "@dvnt/app/components/ui/skeleton": `export const Skeleton=()=>null;`,
  "@dvnt/app/lib/theme": `export const color={};`,
  "@dvnt/app/lib/hooks/use-event-realtime": `export const useEventRealtime=()=>{};`,
  "@dvnt/app/lib/hooks/use-search": `export const useSearchUsers=()=>({data:{docs:[{id:"recipient",username:"friend",name:"Friend"}]},isFetching:false});`,
  "@dvnt/app/lib/stores/events-location-store": `export const useEventsLocationStore=selector=>selector({activeCity:null,deviceLat:null,deviceLng:null});`,
  "@dvnt/ui": `export const Dialog=({open,children,title})=>open?<div role="dialog" aria-label={title}>{children}</div>:null;`,
  qrcode: `export default {toDataURL:async value=>'data:image/png;base64,fixture-'+value};`,
  "react-native-qrcode-svg": `export default ()=>null;`,
  "react-native": `export const Alert={alert:()=>{}};export const View=({children,testID})=><div data-testid={testID}>{children}</div>;
    export const Text=({children})=><span>{children}</span>;
    export const ScrollView=View;export const KeyboardAvoidingView=View;
    export const Modal=({visible,children})=>visible?<div role="dialog">{children}</div>:null;
    export const TextInput=({value,onChangeText,placeholder})=><input value={value} placeholder={placeholder} onChange={e=>onChangeText(e.target.value)}/>;
    export const Pressable=({children,onPress,disabled,accessibilityLabel,style})=>{const Tag=style?.borderTopLeftRadius||style?.justifyContent==='flex-end'?'div':'button';return <Tag onClick={onPress} disabled={disabled} aria-label={accessibilityLabel}>{typeof children==='function'?children({pressed:false}):children}</Tag>;};
    export const StyleSheet={create:x=>x,absoluteFillObject:{},hairlineWidth:1};
    export const ActivityIndicator=()=> <span role="progressbar"/>;
    export const Platform={OS:'ios',select:x=>x.ios??x.default};`,
  "react-native-safe-area-context": `export const useSafeAreaInsets=()=>({top:0,right:0,bottom:0,left:0});`,
  "@legendapp/motion": `export const Motion={View:({children})=><div>{children}</div>};`,
  "@dvnt/app/components/error-boundary": `export const ErrorBoundary=({children})=>children;`,
  "@dvnt/app/features/ticket/ui": `export const TicketHeroCard=({ticket})=><h1>{ticket.eventTitle}</h1>;export const TicketQRCode=({ticket})=><div data-ticket-qr={ticket?.qrToken}/>;export const TicketAccessDetails=()=>null;export {TicketActionsBar} from '${ROOT}/packages/app/features/ticket/ui/TicketActionsBar.tsx';`,
  "expo-haptics": `export const impactAsync=async()=>{};export const ImpactFeedbackStyle={Light:'light'};`,
  "@dvnt/app/features/ticket/helpers/add-to-calendar": `export const addTicketToCalendar=async()=>({success:true});`,
  "@dvnt/app/features/ticket/helpers/share-ticket": `export const shareTicket=async()=>({success:true});`,
  "@dvnt/app/components/ui/avatar": `export const Avatar=()=>null;`,
  "@dvnt/app/features/ticket/helpers": `export const addToWallet=()=>{throw new Error('Unexpected wallet write')};`,
  "@dvnt/app/components/ui/screen-skeleton": `export const ScreenSkeleton=()=> <div>Loading ticket</div>;`,
  "@dvnt/app/features/events": `export const WeatherStrip=()=>null;`,
  "@dvnt/app/components/layout/screen-shell": `export const CONTENT_MAX_WIDTH=600;export const DETAIL_HEADER_ROW={};`,
  "@dvnt/app/components/layout/detail-header": `export const DetailBackButton=()=>null;`,
};
const icons = [
  "Calendar",
  "QrCode",
  "CloudOff",
  "Check",
  "Share2",
  "ArrowLeft",
  "CalendarDays",
  "CalendarPlus",
  "CheckCircle2",
  "ChevronRight",
  "Clock",
  "Crown",
  "Gem",
  "Hash",
  "Lock",
  "MapPin",
  "Send",
  "Share2",
  "Shield",
  "ShieldCheck",
  "Shirt",
  "Sparkles",
  "Star",
  "Ticket",
  "RotateCcw",
  "User",
  "TicketX",
  "WifiOff",
  "XCircle",
  "RefreshCw",
  "WalletCards",
];
fixture["lucide-react"] = fixture["lucide-react-native"] = [...new Set(icons)]
  .map((name) => `export const ${name}=()=>null;`)
  .join("\n");

const source = `import React,{act} from 'react';import {createRoot} from 'react-dom/client';
  import {TicketDetailScreen} from './packages/app/features/events/ticket-detail.web';
  import {MyTicketsScreen as WebLibrary} from './packages/app/features/events/my-tickets.web';
  import NativeLibrary from './packages/app/features/routes/screens/(protected)/events/my-tickets';
  import NativeTicketScreen from './packages/app/features/routes/screens/(protected)/ticket/[id]';
  import {state,useFixture} from 'ticket-test-fixture';
  import {useTicketDetailUIStore} from './packages/app/lib/stores/ticket-detail-ui-store';
  import {qk} from './packages/app/lib/query/keys';
  import {ticketsApi as actualTicketsApi} from '${ROOT}/packages/app/lib/api/tickets.ts';
  export {act,state,useFixture,useTicketDetailUIStore,qk,actualTicketsApi};
  export const mount=(node,platform)=>{const root=createRoot(node);let mounted=true;return {render:()=>root.render(<React.StrictMode>{platform==='web-list'?<WebLibrary/>:platform==='native-list'?<NativeLibrary/>:platform==='web'?<TicketDetailScreen/>:<NativeTicketScreen/>}</React.StrictMode>),unmount:()=>{if(mounted){mounted=false;root.unmount();}}};};`;

function record(overrides = {}) {
  return {
    id: "ticket-a",
    event_id: 71,
    user_id: "viewer-a",
    ticket_type_id: "tier-a",
    status: "active",
    purchase_amount_cents: 0,
    self_service_action: "cancel_free",
    category: "admission",
    stripe_payment_intent_id: null,
    cart_id: null,
    cart_line_item_id: null,
    checked_in_at: null,
    checked_in_by: null,
    transferred_from: null,
    qr_token: "issued-qr-a",
    created_at: "2026-01-01T00:00:00Z",
    event_title: "Fixture concert",
    event_date: "2099-01-01T20:00:00Z",
    event_tz: "UTC",
    ticket_type_name: "General Admission",
    ...overrides,
  };
}

(async () => {
  const { Window } = await import(resolveDependency("happy-dom"));
  const window = new Window({ url: "https://ticket-fixture.invalid" });
  Object.assign(global, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ticket-self-service-"));
  let count = 0;
  try {
    await build({
      stdin: { contents: source, resolveDir: ROOT, loader: "tsx" },
      bundle: true,
      platform: "node",
      format: "cjs",
      jsx: "automatic",
      outfile: path.join(dir, "test.cjs"),
      nodePaths: dependencyPaths,
      alias: Object.fromEntries(
        ["react", "react-dom", "zustand"].map((name) => [
          name,
          path.dirname(resolveDependency(name + "/package.json")),
        ]),
      ),
      define: { __DEV__: "false" },
      tsconfigRaw: { compilerOptions: { jsx: "react-jsx" } },
      plugins: [
        {
          name: "offline-ticket-actions",
          setup(b) {
            b.onResolve({ filter: /.*/ }, (a) => {
              if (Object.hasOwn(fixture, a.path))
                return { path: a.path, namespace: "fixture" };
              if (a.path.startsWith(".")) {
                const resolved = path.resolve(a.resolveDir, a.path);
                const alias =
                  "@dvnt/app/" +
                  path
                    .relative(path.join(ROOT, "packages/app"), resolved)
                    .replace(/\\/g, "/");
                if (Object.hasOwn(fixture, alias))
                  return { path: alias, namespace: "fixture" };
              }
              if (a.path.startsWith("@dvnt/app/")) {
                const stem = path.join(ROOT, "packages/app", a.path.slice(10));
                for (const suffix of ["", ".ts", ".tsx"])
                  if (fs.existsSync(stem + suffix))
                    return { path: stem + suffix };
              }
            });
            b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({
              contents: fixture[a.path],
              loader: "tsx",
              resolveDir: ROOT,
            }));
          },
        },
      ],
    });
    const f = require(path.join(dir, "test.cjs"));
    const flush = async (run) =>
      f.act(async () => {
        await run?.();
        await new Promise((r) => setTimeout(r, 0));
      });
    const findButton = (label) =>
      [...document.querySelectorAll("button")].find(
        (button) => button.textContent.replace(/\s+/g, " ").trim() === label,
      );
    const requireButton = (label) => {
      const button = findButton(label);
      assert.ok(
        button,
        `Missing button: ${label}\n${document.body.textContent}`,
      );
      return button;
    };
    const noAction = (reason) => {
      for (const label of [
        "Cancel RSVP",
        "Cancel Ticket",
        "Request Refund",
        "Yes, Cancel",
      ])
        assert.equal(findButton(label), undefined, `${reason}: hides ${label}`);
    };
    const successToasts = () =>
      f.state.toasts.filter((toast) => toast[0] === "success");
    const reset = (ticket = record(), extra = {}) => {
      Object.assign(f.state, {
        calls: [],
        toasts: [],
        navigations: [],
        invalidations: [],
        queries: [],
        defer: false,
        releases: [],
        response: undefined,
        throwError: false,
      });
      f.useTicketDetailUIStore.getState().reset();
      f.useFixture.setState({
        routeId: ticket?.id ?? "ticket-a",
        viewerId: "viewer-a",
        ticket,
        group: null,
        isLoading: false,
        isError: false,
        addons: [],
        storeTicket: undefined,
        pendingError: false,
        incoming: [],
        outgoing: [],
        ...extra,
      });
    };
    const test = async (platform, label, work) => {
      const node = document.createElement("div");
      document.body.append(node);
      let app;
      try {
        await flush(() => reset());
        app = f.mount(node, platform);
        await flush(() => app.render());
        await work({
          app,
          change: (patch) => flush(() => f.useFixture.setState(patch)),
          reset: async (ticket, extra) => {
            await flush(() => reset(ticket, extra));
          },
        });
        count += 1;
        console.log(`ok ${count} - ${platform}: ${label}`);
      } catch (error) {
        error.message = `${platform}: ${label}: ${error.message}`;
        throw error;
      } finally {
        if (app) await flush(() => app.unmount());
        node.remove();
      }
    };
    const confirm = async (label) => {
      await flush(() => requireButton(label).click());
      requireButton("Yes, Cancel");
    };
    const submit = async () =>
      flush(() => requireButton("Yes, Cancel").click());

    const chooseRecipient = async (platform) => {
      await flush(() => requireButton("Transfer").click());
      if (platform === "web")
        await flush(() =>
          f.useTicketDetailUIStore.getState().setTransferQuery("friend"),
        );
      else {
        const input = document.querySelector(
          'input[placeholder="Search users"]',
        );
        await flush(() => {
          Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            "value",
          ).set.call(input, "friend");
          input.dispatchEvent(new window.Event("input", { bubbles: true }));
          input.dispatchEvent(new window.Event("change", { bubbles: true }));
        });
      }
      const recipient = [...document.querySelectorAll("button")].find(
        (b) => b.textContent.includes("@friend") && !b.querySelector("button"),
      );
      assert.ok(recipient, "recipient result is visible");
      return recipient;
    };

    for (const platform of ["web-list", "native-list"]) {
      await test(
        platform,
        "pending inbox failures preserve passes and expose working retry",
        async ({ change }) => {
          await change({ pendingError: true });
          assert.match(
            document.body.textContent,
            /Could not refresh incoming transfers/,
          );
          assert.match(document.body.textContent, /Fixture concert/);
          await flush(() => requireButton("Retry transfers").click());
          assert.equal(
            f.state.calls.filter((c) => c.method === "retryTransfers").length,
            1,
          );
          assert.doesNotMatch(
            document.body.textContent,
            /Could not refresh incoming transfers/,
          );
          assert.match(document.body.textContent, /Incoming concert/);
        },
      );
    }
    for (const platform of ["web", "native"]) {
      await test(
        platform,
        "failed outgoing lookup exposes retry rather than silently losing cancellation",
        async ({ change }) => {
          await change({
            ticket: record({ status: "transfer_pending" }),
            pendingError: true,
          });
          assert.match(
            document.body.textContent,
            /Could not refresh transfer status/,
          );
          await flush(() => requireButton("Retry transfer status").click());
          assert.equal(
            f.state.calls.filter((c) => c.method === "retryTransferStatus")
              .length,
            1,
          );
          requireButton("Cancel");
        },
      );

      await test(
        platform,
        "successful transfer immediately refreshes owner credentials",
        async () => {
          f.state.response = { transfer_id: "transfer-a" };
          const recipient = await chooseRecipient(platform);
          await flush(() => recipient.click());
          assert.equal(
            f.state.calls.filter((c) => c.method === "initiateTransfer").length,
            1,
          );
          assert.ok(
            f.state.invalidations.some(
              (key) =>
                JSON.stringify(key) ===
                JSON.stringify(f.qk.tickets.mine("viewer-a")),
            ),
            "refreshes the credential query actually used by this screen",
          );
          assert.equal(
            f.useFixture.getState().ticket.status,
            "transfer_pending",
            "confirmed pending transfer immediately disables old pass",
          );
        },
      );

      await test(
        platform,
        "same-frame recipient taps submit once",
        async () => {
          f.state.defer = true;
          f.state.response = { transfer_id: "transfer-a" };
          const recipient = await chooseRecipient(platform);
          await flush(() => {
            recipient.click();
            recipient.click();
          });
          assert.equal(f.state.calls.length, 1);
          assert.equal(
            f.useFixture.getState().ticket.status,
            "active",
            "no speculative ownership update",
          );
          await flush(() => f.state.releases.shift()());
          assert.equal(
            f.useFixture.getState().ticket.status,
            "transfer_pending",
          );
        },
      );
      await test(
        platform,
        "failed or unconfirmed transfers preserve ticket and permit retry",
        async ({ reset }) => {
          for (const response of [{ error: "Recipient is unavailable" }, {}]) {
            await reset(
              record({
                id: response.error ? "ticket-failure" : "ticket-unconfirmed",
              }),
            );
            f.state.response = response;
            {
              const recipient = await chooseRecipient(platform);
              await flush(() => recipient.click());
            }
            assert.equal(f.useFixture.getState().ticket.status, "active");
            assert.equal(successToasts().length, 0);
            assert.equal(f.state.invalidations.length, 0);
            f.state.response = { transfer_id: "transfer-retry" };
            {
              const recipient = await chooseRecipient(platform);
              await flush(() => recipient.click());
            }
            assert.equal(
              f.useFixture.getState().ticket.status,
              "transfer_pending",
            );
          }
        },
      );
      await test(
        platform,
        "unmounted transfer completion refreshes cache without late toast",
        async ({ app }) => {
          f.state.defer = true;
          f.state.response = { transfer_id: "transfer-a" };
          const recipient = await chooseRecipient(platform);
          await flush(() => recipient.click());
          await flush(() => app.unmount());
          await flush(() => f.state.releases.shift()());
          assert.equal(successToasts().length, 0);
          assert.equal(
            f.useFixture.getState().ticket.status,
            "transfer_pending",
          );
        },
      );
      await test(
        platform,
        "account switch suppresses old transfer UI and preserves new owner cache",
        async ({ change }) => {
          f.state.defer = true;
          f.state.response = { transfer_id: "transfer-a" };
          const recipient = await chooseRecipient(platform);
          await flush(() => recipient.click());
          await change({
            viewerId: "viewer-b",
            ticket: record({ id: "ticket-b", user_id: "viewer-b" }),
          });
          await flush(() => f.state.releases.shift()());
          assert.equal(successToasts().length, 0);
          assert.equal(f.useFixture.getState().ticket.status, "active");
          assert.equal(f.useFixture.getState().ticket.id, "ticket-b");
        },
      );

      await test(
        platform,
        "free admission cancels only the selected RSVP",
        async () => {
          assert.equal(findButton("Request Refund"), undefined);
          await confirm("Cancel RSVP");
          assert.doesNotMatch(
            document.body.textContent,
            /refund will be issued|original payment method|Processing refund/i,
          );
          await submit();
          assert.deepEqual(f.state.calls, [
            { method: "cancelFreeTicket", args: "ticket-a" },
          ]);
          assert.equal(successToasts().length, 1);
          assert.doesNotMatch(
            successToasts()[0].join(" "),
            /refund processed/i,
          );
          assert.deepEqual(f.state.navigations, ["back"]);
          assert.ok(
            f.state.invalidations.some(
              (key) =>
                JSON.stringify(key) ===
                JSON.stringify(f.qk.tickets.mine("viewer-a")),
            ),
            "refreshes the correct owner's ticket cache",
          );
        },
      );

      await test(
        platform,
        "comp and 100%-discounted admission never enter the money-refund flow",
        async ({ reset }) => {
          for (const overrides of [
            { ticket_type_name: "Complimentary VIP" },
            {
              stripe_payment_intent_id: "pi_discounted",
              cart_id: null,
              cart_line_item_id: null,
            },
          ]) {
            await reset(record(overrides));
            await confirm("Cancel RSVP");
            await submit();
            assert.deepEqual(f.state.calls, [
              { method: "cancelFreeTicket", args: "ticket-a" },
            ]);
          }
        },
      );

      await test(
        platform,
        "supported zero-order credential cancellation leaves paid sibling and add-on untouched",
        async ({ reset }) => {
          const free = record({
            cart_id: "synthetic-zero-group",
            cart_line_item_id: null,
            stripe_payment_intent_id: null,
          });
          const paidSibling = record({
            id: "ticket-paid",
            purchase_amount_cents: 3200,
            self_service_action: "refund_line",
            cart_id: "cart-mixed",
            cart_line_item_id: "line-paid",
            stripe_payment_intent_id: "pi_mixed",
          });
          const addon = {
            id: "addon-paid",
            event_id: 71,
            cart_id: "cart-mixed",
            cart_line_item_id: "line-addon",
            ticket_addons: { name: "Paid coat check", is_redeemable: false },
            variant_label: null,
            quantity: 1,
            unit_price_cents: 500,
            status: "unfulfilled",
            qr_token: null,
            addon_type: "service",
          };
          const before = JSON.stringify({ paidSibling, addon });
          await reset(free, { group: [free, paidSibling], addons: [addon] });
          assert.match(document.body.textContent, /Paid coat check/);
          await confirm("Cancel RSVP");
          assert.doesNotMatch(
            document.body.textContent,
            /cancels every ticket or pass from this cart line/i,
          );
          await submit();
          assert.deepEqual(
            f.state.calls,
            [{ method: "cancelFreeTicket", args: "ticket-a" }],
            "only the selected credential id crosses the mutation boundary",
          );
          assert.equal(
            JSON.stringify({ paidSibling, addon }),
            before,
            "UI does not mutate the paid sibling or add-on",
          );
          assert.match(document.body.textContent, /Paid coat check/);
        },
      );

      await test(
        platform,
        "free line in a paid mixed cart stays closed without touching its paid add-on",
        async ({ reset }) => {
          const ticket = record({
            cart_id: "mixed-paid-cart",
            cart_line_item_id: "free-line",
            stripe_payment_intent_id: "pi_mixed",
            self_service_action: null,
          });
          const addon = {
            id: "mixed-paid-addon",
            ticket_addons: {
              name: "Paid mixed-cart add-on",
              is_redeemable: false,
            },
            quantity: 1,
            status: "unfulfilled",
            qr_token: null,
          };
          await reset(ticket, { addons: [addon] });
          noAction("unsupported cart-line cancellation is not offered");
          assert.match(document.body.textContent, /Paid mixed-cart add-on/);
          assert.equal(f.state.calls.length, 0);
          assert.equal(addon.status, "unfulfilled");
        },
      );

      await test(
        platform,
        "free non-admission says Cancel Ticket, not RSVP or refund",
        async ({ reset }) => {
          for (const category of ["coat_check", "product", "service"]) {
            await reset(record({ category }));
            assert.equal(findButton("Cancel RSVP"), undefined);
            await confirm("Cancel Ticket");
            await submit();
            assert.deepEqual(f.state.calls, [
              { method: "cancelFreeTicket", args: "ticket-a" },
            ]);
          }
        },
      );

      await test(
        platform,
        "paid legacy and cart-line refunds preserve their distinct API paths",
        async ({ reset }) => {
          const paid = {
            purchase_amount_cents: 2400,
            stripe_payment_intent_id: "pi_paid",
            self_service_action: "refund",
          };
          await reset(record(paid));
          await confirm("Request Refund");
          assert.match(document.body.textContent, /original payment method/i);
          await submit();
          assert.deepEqual(f.state.calls, [
            { method: "requestRefund", args: "ticket-a" },
          ]);
          await reset(
            record({
              ...paid,
              self_service_action: "refund_line",
              cart_id: "cart-paid",
              cart_line_item_id: "line-paid",
            }),
          );
          await confirm("Request Refund");
          assert.match(
            document.body.textContent,
            /Other items from the same checkout stay active/i,
          );
          await submit();
          assert.deepEqual(f.state.calls, [
            {
              method: "requestLineRefund",
              args: { cartId: "cart-paid", lineItemId: "line-paid" },
            },
          ]);
        },
      );

      await test(
        platform,
        "server policy and the conservative 24-hour cutoff both fail closed",
        async ({ reset }) => {
          await reset(
            record({
              event_date: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            }),
          );
          noAction("inside the conservative 24-hour cutoff");
          await reset(
            record({
              self_service_action: null,
              event_date: "2099-01-01T20:00:00Z",
            }),
          );
          noAction("server refuses action despite distant event");
        },
      );

      await test(
        platform,
        "invalid, incomplete and unowned server states fail closed",
        async ({ reset }) => {
          for (const [label, overrides] of [
            ["scanned", { status: "scanned" }],
            ["refunded", { status: "refunded" }],
            ["void", { status: "void" }],
            ["transfer pending", { status: "transfer_pending" }],
            ["checked in", { checked_in_at: "2026-01-01T01:00:00Z" }],
            ["transferred", { transferred_from: "viewer-original" }],
            ["missing amount", { purchase_amount_cents: undefined }],
            ["null amount", { purchase_amount_cents: null }],
            ["negative amount", { purchase_amount_cents: -1 }],
            ["missing capability", { self_service_action: undefined }],
            ["null capability", { self_service_action: null }],
            [
              "zero cannot refund",
              {
                self_service_action: "refund",
                stripe_payment_intent_id: "pi_zero",
              },
            ],
            [
              "paid cannot cancel free",
              {
                purchase_amount_cents: 1200,
                stripe_payment_intent_id: "pi_paid",
              },
            ],
            [
              "paid without payment intent",
              { purchase_amount_cents: 1200, self_service_action: "refund" },
            ],
            [
              "free cart-line",
              {
                cart_id: "cart-mixed",
                cart_line_item_id: "line-free",
                stripe_payment_intent_id: "pi_mixed",
                self_service_action: null,
              },
            ],
            [
              "invalid free cart-line capability",
              { cart_id: "cart-mixed", cart_line_item_id: "line-free" },
            ],
            [
              "line refund without line",
              {
                purchase_amount_cents: 1200,
                self_service_action: "refund_line",
                stripe_payment_intent_id: "pi_paid",
                cart_id: "cart-paid",
              },
            ],
          ]) {
            await reset(record(overrides));
            noAction(label);
            assert.equal(f.state.calls.length, 0);
          }
        },
      );

      await test(
        platform,
        "confirmation can be declined without submitting",
        async () => {
          await confirm("Cancel RSVP");
          await flush(() => requireButton("Keep Ticket").click());
          requireButton("Cancel RSVP");
          assert.equal(f.state.calls.length, 0);
        },
      );

      await test(
        platform,
        "same-frame repeated presses submit once and show cancellation loading",
        async () => {
          f.state.defer = true;
          await confirm("Cancel RSVP");
          const button = requireButton("Yes, Cancel");
          await flush(() => {
            button.click();
            button.click();
          });
          assert.equal(
            f.state.calls.length,
            1,
            "synchronous lock, not merely next-render state",
          );
          assert.doesNotMatch(document.body.textContent, /Processing refund/i);
          assert.equal(successToasts().length, 0);
          await flush(() =>
            f.state.releases.splice(0).forEach((resolve) => resolve()),
          );
          assert.equal(successToasts().length, 1);
        },
      );

      await test(
        platform,
        "API refusal resets confirmation without success and retry works",
        async () => {
          f.state.response = { error: "Cancellation is no longer allowed" };
          await confirm("Cancel RSVP");
          await submit();
          requireButton("Yes, Cancel");
          assert.equal(successToasts().length, 0);
          assert.equal(f.state.navigations.length, 0);
          assert.equal(f.state.toasts.at(-1)[0], "error");
          f.state.response = undefined;
          await submit();
          assert.equal(f.state.calls.length, 2);
          assert.equal(successToasts().length, 1);
        },
      );

      await test(
        platform,
        "transport exception resets confirmation without false success",
        async () => {
          f.state.throwError = true;
          await confirm("Cancel RSVP");
          await submit();
          requireButton("Yes, Cancel");
          assert.equal(successToasts().length, 0);
          assert.equal(f.state.navigations.length, 0);
          assert.equal(f.state.toasts.at(-1)[0], "error");
          f.state.throwError = false;
          await submit();
          assert.equal(successToasts().length, 1);
        },
      );

      await test(
        platform,
        "empty or unconfirmed responses are never reported as successful",
        async ({ reset }) => {
          for (const response of [
            null,
            {},
            { success: true },
            { ok: false },
            { ok: true, error: "Rejected" },
          ]) {
            await reset(record());
            f.state.response = response;
            await confirm("Cancel RSVP");
            await submit();
            requireButton("Yes, Cancel");
            assert.equal(successToasts().length, 0);
            assert.equal(f.state.navigations.length, 0);
            assert.equal(f.state.toasts.at(-1)[0], "error");
            await flush(() => requireButton("Keep Ticket").click());
          }
        },
      );

      await test(
        platform,
        "unmount while submitting suppresses late toast and navigation",
        async ({ app }) => {
          f.state.defer = true;
          await confirm("Cancel RSVP");
          await submit();
          await flush(() => app.unmount());
          await flush(() =>
            f.state.releases.splice(0).forEach((resolve) => resolve()),
          );
          assert.equal(successToasts().length, 0);
          assert.equal(f.state.navigations.length, 0);
        },
      );

      await test(
        platform,
        "route change resets confirmation to the new credential",
        async ({ change }) => {
          await confirm("Cancel RSVP");
          await change({
            routeId: "ticket-b",
            ticket: record({ id: "ticket-b", qr_token: "issued-qr-b" }),
          });
          assert.equal(findButton("Yes, Cancel"), undefined);
          await confirm("Cancel RSVP");
          await submit();
          assert.deepEqual(f.state.calls, [
            { method: "cancelFreeTicket", args: "ticket-b" },
          ]);
        },
      );

      await test(
        platform,
        "old route completion cannot toast success or navigate away from a new ticket",
        async ({ change }) => {
          f.state.defer = true;
          await confirm("Cancel RSVP");
          await submit();
          await change({
            routeId: "ticket-b",
            ticket: record({ id: "ticket-b", qr_token: "issued-qr-b" }),
          });
          requireButton("Cancel RSVP");
          await flush(() =>
            f.state.releases.splice(0).forEach((resolve) => resolve()),
          );
          assert.equal(successToasts().length, 0);
          assert.equal(f.state.navigations.length, 0);
          requireButton("Cancel RSVP");
          f.state.defer = false;
          await confirm("Cancel RSVP");
          await submit();
          assert.deepEqual(
            f.state.calls.map((call) => call.args),
            ["ticket-a", "ticket-b"],
          );
        },
      );

      await test(
        platform,
        "A to B to A navigation cannot resubmit either pending paid refund",
        async ({ change }) => {
          const a = record({
            purchase_amount_cents: 2500,
            stripe_payment_intent_id: "pi_a",
            self_service_action: "refund",
          });
          const b = record({
            id: "ticket-b",
            purchase_amount_cents: 3500,
            stripe_payment_intent_id: "pi_b",
            self_service_action: "refund",
          });
          await change({ ticket: a });
          f.state.defer = true;
          await confirm("Request Refund");
          await submit();
          await change({ routeId: "ticket-b", ticket: b });
          await confirm("Request Refund");
          await submit();
          await change({ routeId: "ticket-a", ticket: a });
          await confirm("Request Refund");
          await submit();
          assert.deepEqual(
            f.state.calls,
            [
              { method: "requestRefund", args: "ticket-a" },
              { method: "requestRefund", args: "ticket-b" },
            ],
            "all outstanding target identities stay locked, not just the last target",
          );
          await flush(() =>
            f.state.releases.splice(0).forEach((resolve) => resolve()),
          );
          assert.equal(f.state.calls.length, 2);
        },
      );

      await test(
        platform,
        "account change clears confirmation and suppresses old account completion",
        async ({ change }) => {
          f.state.defer = true;
          await confirm("Cancel RSVP");
          await submit();
          await change({
            viewerId: "viewer-b",
            ticket: null,
            isLoading: true,
            addons: [],
          });
          noAction("new viewer has not loaded a ticket");
          await flush(() =>
            f.state.releases.splice(0).forEach((resolve) => resolve()),
          );
          assert.equal(successToasts().length, 0);
          assert.equal(f.state.navigations.length, 0);
          await change({
            ticket: record({ user_id: "viewer-b", self_service_action: null }),
            isLoading: false,
          });
          noAction("new viewer's server row denies permission");
        },
      );

      await test(
        platform,
        "read error or locally cached ticket never grants self-service",
        async ({ reset }) => {
          const storeTicket = {
            id: "local-ticket",
            eventId: "71",
            userId: "viewer-a",
            paid: false,
            status: "valid",
            qrToken: "local-qr",
            tier: "free",
            eventTitle: "Local ticket",
          };
          await reset(null, { isError: true, storeTicket });
          noAction("offline/store-only row lacks server capability");
          assert.equal(f.state.calls.length, 0);
        },
      );
    }
    // Execute the production adapter too: the UI mock above records dispatch,
    // while this proves the selected id reaches the actual guarded edge action.
    const actual = f.actualTicketsApi;
    f.state.edgeCalls = [];
    f.state.edgeResponse = { ok: true, message: "Cancelled" };
    assert.deepEqual(await actual.cancelFreeTicket("credential-selected"), {
      ok: true,
      message: "Cancelled",
    });
    assert.deepEqual(f.state.edgeCalls, [
      {
        name: "ticket-refund",
        input: {
          body: { ticket_id: "credential-selected", action: "cancel_free" },
          headers: { Authorization: "Bearer fixture-auth-token" },
        },
      },
    ]);
    f.state.edgeResponse = JSON.stringify({
      ok: true,
      message: "Already cancelled",
    });
    assert.equal(
      (await actual.cancelFreeTicket("credential-selected")).ok,
      true,
      "adapter handles string edge responses",
    );
    f.state.edgeResponse = { error: "Server policy denied cancellation" };
    assert.equal(
      (await actual.cancelFreeTicket("credential-selected")).error,
      "Server policy denied cancellation",
    );
    const originalConsoleError = console.error;
    try {
      console.error = () => {};
      f.state.edgeError = new Error("Network refused");
      assert.equal(
        (await actual.cancelFreeTicket("credential-selected")).error,
        "Network refused",
      );
      f.state.edgeError = null;
      f.state.tokenError = true;
      const prior = f.state.edgeCalls.length;
      assert.equal(
        (await actual.cancelFreeTicket("credential-selected")).error,
        "Authentication required",
      );
      assert.equal(
        f.state.edgeCalls.length,
        prior,
        "no unauthenticated edge invocation",
      );
    } finally {
      console.error = originalConsoleError;
    }
    console.log(
      `PASS: ${count} mounted ticket-action scenarios across web and native; production cancelFreeTicket adapter route/auth/error contract`,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    await window.happyDOM.abort();
  }
})()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
