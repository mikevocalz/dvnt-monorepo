/** Execute the actual native screen callbacks; no card/network/native runtime. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { URL } from "node:url";
import { completeNativeTicketCheckout } from "./native-checkout-outcome.ts";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = new URL("../../../", import.meta.url);
const screenSource = fs.readFileSync(
  new URL(
    "app/features/routes/screens/(protected)/events/[id]/index.tsx",
    root,
  ),
  "utf8",
);
const screenAst = ts.createSourceFile(
  "screen.tsx",
  screenSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
function callback(name: string): string {
  let found = "";
  function visit(node: any) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(screenAst) === name
    ) {
      found = node.initializer.arguments[0].getText(screenAst);
    }
    ts.forEachChild(node, visit);
  }
  visit(screenAst);
  assert.ok(found, `actual ${name} callback must exist`);
  return ts.transpileModule(`var callback = ${found}; callback;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
const nativeCallback = callback("handleNativeTicketCheckout");
const getTicketsCallback = callback("handleGetTickets");
const storeSource = fs.readFileSync(
  new URL("app/lib/stores/native-ticket-checkout-store.ts", root),
  "utf8",
);
const storeCode = ts.transpileModule(storeSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
function loadStore(storage: Map<string, any>) {
  const module = { exports: {} as any };
  const mockRequire = (name: string) =>
    name === "@dvnt/app/lib/mmkv-zustand"
      ? {
          mmkvStorage: {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: any) =>
              storage.set(key, JSON.parse(JSON.stringify(value))),
            removeItem: (key: string) => storage.delete(key),
          },
        }
      : require(name);
  vm.runInNewContext(storeCode, {
    require: mockRequire,
    module,
    exports: module.exports,
  });
  return module.exports;
}
function harness(options: { read?: () => Promise<any[]>; result?: any } = {}) {
  const storage = new Map<string, any>();
  const { useNativeTicketCheckoutStore: store, nativeTicketCheckoutKey: key } =
    loadStore(storage);
  const state = { isCheckingOut: false };
  const toasts: any[][] = [];
  let payments = 0;
  let writes = 0;
  const context: any = {
    eventData: { title: "Fixture event", status: "cancelled" },
    eventId: "42",
    viewerId: "viewer-1",
    nativeCheckoutKey: key("viewer-1", "42"),
    selectedTier: { id: "tier-ga" },
    ticketQty: 1,
    promoCode: "",
    useNativeTicketCheckoutStore: store,
    useEventDetailScreenStore: { getState: () => state },
    setIsCheckingOut: (value: boolean) => {
      state.isCheckingOut = value;
    },
    showToast: (...args: any[]) => toasts.push(args),
    nativeCheckout: async () => {
      payments++;
      return options.result ?? { success: true, paymentIntentId: "pi_current" };
    },
    completeNativeTicketCheckout: (input: any) =>
      completeNativeTicketCheckout({ ...input, wait: async () => {} }),
    ticketsApi: { getMyTickets: options.read ?? (async () => []) },
    qk: {
      tickets: {
        mine: (id: string) => [id],
        forEvent: (id: string, event: string) => [id, event],
      },
    },
    eventKeys: { all: ["events"] },
    queryClient: {
      invalidateQueries: () => {},
      setQueryData: () => {
        writes++;
      },
      setQueriesData: () => {
        writes++;
      },
    },
    toggleRsvp: () => {
      writes++;
    },
    console,
  };
  context.handleNativeTicketCheckout = vm.runInNewContext(
    nativeCallback,
    context,
  );
  return {
    context,
    storage,
    store,
    key,
    toasts,
    state,
    run: context.handleNativeTicketCheckout,
    get payments() {
      return payments;
    },
    get writes() {
      return writes;
    },
  };
}
const issued = {
  id: "issued",
  qr_token: "qr",
  event_id: 42,
  ticket_type_id: "tier-ga",
  stripe_payment_intent_id: "pi_current",
  status: "active",
};

test("native screen displays processing after delayed webhook, not purchased, and never inflates attendees", async () => {
  const h = harness();
  await h.run();
  assert.equal(h.toasts.at(-1)?.[0], "info");
  assert.match(h.toasts.at(-1)?.[2], /don't pay again/);
  assert.equal(h.writes, 0);
  // Run the real entry callback after sales are cancelled: recovery still works.
  await vm.runInNewContext(getTicketsCallback, h.context)();
  assert.equal(h.payments, 1);
  assert.equal(h.writes, 0);
});

test("native screen handles five failed reads as pending and prevents same-frame double taps", async () => {
  const h = harness({
    read: async () => {
      throw new Error("offline");
    },
  });
  await Promise.all([h.run(), h.run()]);
  assert.equal(h.payments, 1);
  assert.equal(h.toasts.length, 1);
  assert.equal(h.toasts[0][0], "info");
  assert.equal(h.state.isCheckingOut, false);
});

test("native screen never celebrates an older purchase of the same event", async () => {
  const h = harness({
    read: async () => [{ ...issued, stripe_payment_intent_id: "pi_old" }],
  });
  await h.run();
  assert.equal(h.toasts[0][0], "info");
  assert.equal(h.writes, 0);
});

test("native screen celebrates matching issuance and free confirmed tickets only", async () => {
  for (const options of [
    { read: async () => [issued] },
    {
      result: {
        success: true,
        free: true,
        tickets: [{ id: "free", qr_token: "qr-free" }],
      },
    },
  ]) {
    const h = harness(options);
    await h.run();
    assert.equal(h.toasts[0][0], "success");
    assert.equal(h.toasts[0][1], "Ticket Confirmed");
    assert.equal(h.writes, 0);
  }
});

test("pending purchase survives restart, remains account/event scoped, and rechecks its original quantity", async () => {
  const h = harness();
  await h.run();
  const restarted = loadStore(h.storage);
  const key = restarted.nativeTicketCheckoutKey("viewer-1", "42");
  assert.equal(
    restarted.useNativeTicketCheckoutStore.getState().pending[key]
      .paymentIntentId,
    "pi_current",
  );
  assert.equal(
    restarted.useNativeTicketCheckoutStore.getState().pending[
      h.key("viewer-2", "42")
    ],
    undefined,
  );
  assert.equal(
    restarted.useNativeTicketCheckoutStore.getState().pending[
      h.key("viewer-1", "43")
    ],
    undefined,
  );
  h.context.useNativeTicketCheckoutStore =
    restarted.useNativeTicketCheckoutStore;
  h.context.ticketsApi.getMyTickets = async () => [issued];
  h.context.ticketQty = 4; // A UI change cannot turn a one-ticket purchase into four.
  await vm.runInNewContext(nativeCallback, h.context)();
  assert.equal(h.payments, 1);
  assert.equal(h.toasts.at(-1)?.[0], "success");
  assert.equal(
    restarted.useNativeTicketCheckoutStore.getState().pending[key],
    undefined,
  );
});

const ctaSource = fs.readFileSync(
  new URL("app/features/events/ui/StickyCTA.tsx", root),
  "utf8",
);
const ctaAst = ts.createSourceFile(
  "cta.tsx",
  ctaSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let ctaFunction = "";
for (const statement of ctaAst.statements) {
  if (!ts.isVariableStatement(statement)) continue;
  for (const declaration of statement.declarationList.declarations) {
    if (declaration.name.getText(ctaAst) === "StickyCTA")
      ctaFunction = declaration.initializer.arguments[0].getText(ctaAst);
  }
}
assert.ok(ctaFunction);
let checkoutStateExpression = "";
function findCheckoutState(node: any) {
  if (
    ts.isJsxSelfClosingElement(node) &&
    node.tagName.getText(screenAst) === "StickyCTA"
  ) {
    checkoutStateExpression =
      node.attributes.properties
        .find((attribute: any) => attribute.name?.text === "checkoutState")
        ?.initializer.expression.getText(screenAst) ?? "";
  }
  ts.forEachChild(node, findCheckoutState);
}
findCheckoutState(screenAst);
assert.ok(
  checkoutStateExpression,
  "screen must wire pending/checking state into the rendered CTA",
);
const ctaCode = ts.transpileModule(`module.exports = ${ctaFunction}`, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;

test("actual native CTA replaces buying with read-only recovery, including existing holders", () => {
  for (const isCheckingOut of [false, true]) {
    const checkoutState = vm.runInNewContext(checkoutStateExpression, {
      isCheckingOut,
      isNativeCheckoutLoading: false,
      pendingNativeCheckout: { paymentIntentId: "pi_current" },
    });
    const module = { exports: null as any };
    const context = {
      module,
      require,
      exports: {},
      useSafeAreaInsets: () => ({ bottom: 0 }),
      useSharedValue: () => ({ value: 0 }),
      useState: () => [null, () => {}],
      useEffect: () => {},
      useAnimatedStyle: () => ({}),
      styles: new Proxy({}, { get: (_, name) => name }),
      View: "View",
      Pressable: "Pressable",
      Text: "Text",
      ActivityIndicator: "ActivityIndicator",
      Clock: "Clock",
    };
    vm.runInNewContext(ctaCode, context);
    for (const hasTicket of [false, true]) {
      const onGetTickets = () => {};
      const tree = module.exports({
        checkoutState,
        hasTicket,
        selectedTier: { price: 30 },
        onGetTickets,
        onBuyMore: () => {
          throw new Error("must not buy again");
        },
      });
      const children = tree.props.children.props.children;
      assert.equal(children.type, "Pressable");
      assert.equal(children.props.onPress, onGetTickets);
      assert.equal(children.props.disabled, isCheckingOut);
      assert.equal(
        children.props.children[1].props.children,
        isCheckingOut ? "Confirming tickets..." : "Check ticket status",
      );
    }
  }
});
