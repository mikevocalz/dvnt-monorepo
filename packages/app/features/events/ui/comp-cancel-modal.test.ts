import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import * as policy from "../../../lib/tickets/organizer-comp-cancel.ts";
const require = createRequire(import.meta.url);
const ts = require("typescript"),
  React = require("react"),
  { renderToStaticMarkup } = require("react-dom/server");
function render(overrides = {}) {
  const exports: any = {};
  const state = {
    ticket: {
      id: "ticket-123",
      event_id: 80,
      event_title: "DC Wrong Event",
      event_location: "Washington DC",
      holder_name: "Free-form attendee",
      user_id: "account-123",
      username: "recipient",
      ticket_type_name: "Influencer",
      organizer_free_cancel: { eligible: true },
    },
    valid: true,
    reason: "Wrong event",
    ...overrides,
  };
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(
        new URL("./comp-cancel-modal.web.tsx", import.meta.url),
        "utf8",
      ),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
        },
      },
    ).outputText,
    {
      exports,
      require: (name: string) =>
        name.endsWith("bottom-sheet.web")
          ? {
              BottomSheet: ({ children, open }: any) =>
                open ? React.createElement("section", null, children) : null,
            }
          : name.endsWith("use-comp-cancel")
            ? { useCompCancel: () => state }
            : name.endsWith("organizer-comp-cancel")
              ? policy
              : require(name),
    },
  );
  return renderToStaticMarkup(
    React.createElement(exports.CompCancelModal, { eventId: 80 }),
  );
}
test("review renders exact event city holder tier ticket and non-financial warning", () => {
  const html = render();
  for (const value of [
    "DC Wrong Event",
    "Washington DC",
    "@recipient",
    "Influencer",
    "ticket-123",
    "No refund",
    "Offline scanners",
    "Reason for cancellation",
  ])
    assert.ok(html.includes(value), value);
  assert.match(html, /Keep ticket/);
});
test("pending and ambiguous responses disable destructive action", () => {
  for (const state of [
    { busy: true },
    { valid: false },
    { error: "Refresh roster" },
  ]) {
    const html = render(state);
    assert.match(
      html,
      /<button[^>]*disabled=""[^>]*>[^<]*(?:Cancel this free ticket|Cancelling…)/,
    );
  }
});
test("other event cannot display stale review", () => {
  assert.equal(render({ ticket: { id: "other", event_id: 90 } }), "");
});
