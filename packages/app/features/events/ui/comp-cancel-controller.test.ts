import { URL } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { canSubmitCompCancellation } from "../../../lib/tickets/organizer-comp-cancel.ts";
const ts = createRequire(import.meta.url)("typescript");
function fixture() {
  let resolve: (r: any) => void = () => {};
  const calls: any[] = [],
    toasts: any[] = [],
    cleanups: (() => void)[] = [];
  const state: any = {
    ticket: {
      id: "t",
      user_id: "u",
      event_id: 80,
      organizer_free_cancel: { eligible: true },
    },
    reason: "Wrong event",
    busy: false,
    generation: 0,
    close: () => {
      state.ticket = null;
      state.generation++;
    },
  };
  const store = Object.assign(() => state, {
    getState: () => state,
    setState: (update: any) =>
      Object.assign(
        state,
        typeof update === "function" ? update(state) : update,
      ),
  });
  const exports: any = {};
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(new URL("./use-comp-cancel.ts", import.meta.url), "utf8"),
      { compilerOptions: { module: ts.ModuleKind.CommonJS } },
    ).outputText,
    {
      exports,
      require: (name: string) =>
        name === "react"
          ? { useEffect: (fn: any) => cleanups.push(fn()) }
          : name === "@tanstack/react-query"
            ? { useQueryClient: () => ({ invalidateQueries: async () => {} }) }
            : name.endsWith("comp-cancel-store")
              ? { useCompCancelStore: store }
              : name.endsWith("organizer-comp-cancel")
                ? { canSubmitCompCancellation }
                : name.endsWith("api/tickets")
                  ? {
                      ticketsApi: {
                        cancelOrganizerFreeTicket: (args: any) => {
                          calls.push(args);
                          return new Promise((r) => {
                            resolve = r;
                          });
                        },
                      },
                    }
                  : {
                      useUIStore: {
                        getState: () => ({
                          showToast: (...args: any[]) => toasts.push(args),
                        }),
                      },
                    },
    },
  );
  return {
    state,
    calls,
    toasts,
    cleanups,
    hook: exports.useCompCancel,
    resolve: (r: any) => resolve(r),
  };
}
test("double tap submits once and exact original holder is confirmed", async () => {
  const f = fixture();
  const h = f.hook(80);
  const first = h.submit();
  await h.submit();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].expected_owner_id, "u");
  f.resolve({ ok: true });
  await first;
  assert.equal(f.state.ticket, null);
  assert.equal(f.toasts.length, 1);
});
test("navigation cleanup prevents stale completion closing a later dialog or toast", async () => {
  const f = fixture();
  const first = f.hook(80).submit();
  f.cleanups[0]();
  f.state.ticket = { id: "new" };
  f.resolve({ ok: true });
  await first;
  assert.equal(f.state.ticket.id, "new");
  assert.equal(f.toasts.length, 0);
});
test("unconfirmed response retains review with error and no success toast", async () => {
  const f = fixture();
  const first = f.hook(80).submit();
  f.resolve({ error: "Refresh roster" });
  await first;
  assert.equal(f.state.error, "Refresh roster");
  assert.equal(f.state.busy, false);
  assert.equal(f.toasts.length, 0);
});
