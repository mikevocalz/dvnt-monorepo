#!/usr/bin/env node
// The same production-source fixture as the Chromium runner, executed with real
// React + Zustand and a DOM when a system browser is not available.
const assert = require("node:assert/strict");
const {
  buildCheckoutFixture,
  TIER,
} = require("./fixtures/reviewed-checkout.cjs");
(async () => {
  const { Window } = await import(require.resolve("happy-dom"));
  const bundle = (await buildCheckoutFixture()).outputFiles[0].text;
  let window;
  let act;
  const errors = [];
  const fresh = async () => {
    if (window) await act(async () => window.unmount());
    await window?.happyDOM.close();
    window = new Window({ url: "http://localhost/review" });
    window.IS_REACT_ACT_ENVIRONMENT = true;
    window.console = { ...console, timeStamp() {} };
    // Happy DOM does not implement these scheduler primitives.
    window.MessageChannel = class {
      constructor() {
        this.port1 = { onmessage: null };
        this.port2 = {
          postMessage: () => setTimeout(() => this.port1.onmessage?.(), 0),
        };
      }
    };
    window.addEventListener("error", (event) =>
      errors.push(event.error?.message || event.message),
    );
    window.document.body.innerHTML = '<div id="root"></div>';
    // react-dom initializes only against this isolated synthetic DOM.
    window.eval(bundle);
    act = window.act;
    await tick();
  };
  const tick = async () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  const button = (label) =>
    [...window.document.querySelectorAll("button")].find(
      (node) =>
        (node.getAttribute("aria-label") || node.textContent.trim()) === label,
    );
  const click = async (label) => {
    assert.ok(button(label), `button exists: ${label}`);
    await act(async () => {
      button(label).click();
    });
  };
  const count = (name) =>
    window.fixture.calls.filter((call) => call.name === name).length;
  const gate = (name) => {
    window.fixture.gates[name] = true;
  };
  const release = async (name, error) =>
    act(async () => {
      window.release(name, error);
    });
  const invoke = async (fn) =>
    act(async () => {
      fn();
    });
  const start = () => click("Continue to payment");
  const pay = () => click("Pay $39.93");
  const hasPayment = () =>
    !!window.document.querySelector("[data-payment-element]");
  const ready = async () => {
    await fresh();
    await start();
    assert.ok(hasPayment());
  };
  try {
    if (process.env.CHECKOUT_BASELINE_PROBE) {
      assert.ok(
        process.env.CHECKOUT_BASELINE_REF,
        "baseline probe requires an explicit old ref",
      );
      await fresh();
      await start();
      assert.ok(
        button("Pay $63.50"),
        "old implementation ignores server total $39.93",
      );
      assert.equal(
        button("Decrease General Admission quantity").disabled,
        false,
      );
      await click("Decrease General Admission quantity");
      assert.equal(window.cart.getState().cart.lineItems[0].quantity, 1);
      assert.ok(button("Pay $31.75"));
      assert.equal(count("cart-checkout"), 1);
      console.log(
        "REPRODUCED: original PaymentIntent still mounted while quantity drops from 2 to 1 and Pay label changes; original server quote also ignored.",
      );
      return;
    }
    await fresh();
    gate("cart-create-hold");
    await invoke(() => {
      const next = button("Continue to payment");
      next.click();
      next.click();
      button("Decrease General Admission quantity").click();
      button("Clear cart").click();
    });
    assert.equal(count("cart-create-hold"), 1);
    assert.equal(window.cart.getState().cart.lineItems[0].quantity, 2);
    for (const label of [
      "Decrease General Admission quantity",
      "Increase General Admission quantity",
      "Remove General Admission",
      "Clear cart",
      "Go back",
    ])
      assert.equal(button(label).disabled, true, label);
    await release("cart-create-hold");
    assert.ok(hasPayment());
    assert.equal(count("cart-checkout"), 1);
    for (const label of [
      "Decrease General Admission quantity",
      "Increase General Admission quantity",
      "Remove General Admission",
      "Clear cart",
    ])
      assert.equal(button(label).disabled, true, label);
    assert.equal(window.document.querySelector("input").disabled, true);
    const adds = [...window.document.querySelectorAll("button")].filter(
      (b) => b.textContent.trim() === "Add",
    );
    assert.equal(adds.length, 2);
    for (const add of adds) assert.equal(add.disabled, true);
    const text = window.document.querySelector("main").textContent;
    for (const value of ["$40.00", "−$3.00", "$2.93", "$39.93"])
      assert.ok(text.includes(value), value);
    assert.ok(!text.includes("$63.50"));
    gate("submit");
    await invoke(() => {
      const b = button("Pay $39.93");
      b.click();
      b.click();
    });
    assert.equal(count("submit"), 1);
    assert.equal(count("confirm"), 0);
    const paidId = window.cart.getState().cart.cartId;
    await release("submit");
    assert.equal(count("confirm"), 1);
    assert.equal(
      window.fixture.navigation.at(-1),
      "/feed/checkout/success?cartId=" + paidId,
    );
    console.log(
      "PASS: locked review controls, authoritative quote totals, same-tick Continue/Pay, pinned paid-cart navigation.",
    );

    for (const stage of ["cart-create-hold", "cart-checkout"]) {
      await fresh();
      gate(stage);
      await start();
      assert.equal(count(stage), 1);
      let newId;
      await invoke(() => {
        newId = window.newCart(1);
      });
      await release(stage);
      assert.equal(hasPayment(), false);
      assert.equal(window.payments.getState().checkoutLoading, false);
      assert.equal(window.cart.getState().cart.cartId, newId);
      assert.equal(window.cart.getState().cart.holdExpiresAt, undefined);
      assert.equal(window.cart.getState().cart.paymentIntentId, undefined);
      if (stage === "cart-create-hold") assert.equal(count("cart-checkout"), 0);
    }
    await fresh();
    gate("cart-checkout");
    await start();
    await invoke(() => window.navigate("/event"));
    await invoke(() => window.showReview());
    await release("cart-checkout");
    assert.equal(
      hasPayment(),
      true,
      "Back/remount recovers the same immutable quote",
    );
    await ready();
    await invoke(() => {
      const c = window.cart.getState().cart;
      window.cart
        .getState()
        .updateLineItemQuantity(c.lineItems[0].lineItemId, 1);
    });
    assert.equal(hasPayment(), false);
    assert.equal(count("confirm"), 0);
    await ready();
    await click("Go back");
    await invoke(() => window.showReview());
    assert.equal(hasPayment(), true);
    assert.equal(button("Decrease General Admission quantity").disabled, true);
    assert.equal(count("cart-create-hold"), 1);
    await click("Start a new cart");
    assert.equal(hasPayment(), false);
    assert.equal(window.cart.getState().cart, null);
    await invoke(() => window.newCart(1));
    assert.equal(button("Continue to payment").disabled, false);
    console.log(
      "PASS: stale cart responses blocked; Back/remount preserves the immutable quote; explicit new cart unlocks editing.",
    );

    for (const change of ["clear", "replace", "back"]) {
      await ready();
      gate("submit");
      await pay();
      assert.equal(count("submit"), 1);
      await invoke(() => {
        if (change === "clear") window.cart.getState().clearCart();
        else if (change === "replace") window.newCart(1);
        else window.navigate("/event");
      });
      await release("submit");
      assert.equal(window.payments.getState().checkoutLoading, false);
      assert.equal(count("confirm"), 0, change);
    }
    await ready();
    gate("submit");
    await pay();
    await release("submit", "Synthetic network failure");
    assert.equal(button("Pay $39.93").disabled, false);
    assert.equal(count("confirm"), 0);
    await pay();
    assert.equal(count("confirm"), 1);
    await ready();
    const expiredNow = window.Date.now() + 700000;
    window.Date.now = () => expiredNow;
    await pay();
    assert.equal(count("confirm"), 0);
    assert.equal(count("submit"), 0);
    assert.equal(button("Reservation expired").disabled, true);
    assert.ok(button("Start a new cart"));
    console.log(
      "PASS: submit interruption, thrown provider error/retry, and hold expiry prevent an unintended confirmation.",
    );

    const args = { eventId: "1", ticketTypeId: TIER, quantity: 1 };
    await fresh();
    gate("token");
    const savedTicket = window.ticket.checkout;
    let first, second;
    await invoke(() => {
      first = savedTicket(args);
      second = savedTicket(args);
    });
    assert.equal((await second).error, "Checkout already in progress");
    assert.equal(count("token"), 1);
    assert.equal(
      (await savedTicket(args)).error,
      "Checkout already in progress",
    );
    await release("token");
    assert.equal((await first).success, true);
    assert.equal(count("create-payment-intent"), 1);
    await invoke(() => {
      first = savedTicket(args);
    });
    assert.equal((await first).success, true);
    await fresh();
    gate("token");
    await invoke(() => {
      first = window.ticket.checkout(args);
    });
    assert.equal(
      (await window.mixed.checkout()).error,
      "Checkout already in progress",
    );
    await release("token");
    await first;
    await fresh();
    gate("cart-create-hold");
    const savedMixed = window.mixed.checkout;
    await invoke(() => {
      first = savedMixed();
      second = savedMixed();
    });
    assert.equal((await second).error, "Checkout already in progress");
    assert.equal(count("cart-create-hold"), 1);
    assert.equal((await savedMixed()).error, "Checkout already in progress");
    await release("cart-create-hold");
    assert.equal((await first).success, true);
    assert.equal(count("sheet-present"), 1);
    let newId;
    await invoke(() => {
      newId = window.newCart(1);
    });
    await invoke(() => {
      first = savedMixed();
    });
    assert.equal((await first).success, true);
    assert.equal(
      window.fixture.calls.filter((c) => c.name === "cart-create-hold").at(-1)
        .payload.cartId,
      newId,
    );
    await fresh();
    gate("cart-create-hold");
    await invoke(() => {
      first = window.mixed.checkout();
    });
    await invoke(() => window.newCart(1));
    await release("cart-create-hold");
    assert.equal((await first).success, false);
    assert.equal(count("cart-checkout"), 0);
    assert.equal(count("sheet-present"), 0);
    await fresh();
    gate("token");
    await invoke(() => {
      first = window.ticket.checkout(args);
    });
    await release("token", "Synthetic auth failure");
    assert.equal((await first).success, false);
    assert.equal(window.payments.getState().checkoutLoading, false);
    // Cancel reopens the original native intent, not a frozen-cart re-hold.
    await fresh();
    window.fixture.responses["sheet-present"] = { error: { code: "Canceled" } };
    await invoke(() => {
      first = window.mixed.checkout();
    });
    assert.equal((await first).cancelled, true);
    delete window.fixture.responses["sheet-present"];
    await invoke(() => {
      first = window.mixed.checkout();
    });
    assert.equal((await first).success, true);
    assert.equal(count("cart-create-hold"), 1);
    assert.equal(count("cart-checkout"), 1);
    assert.equal(count("sheet-present"), 2);
    // An edited cancelled cart cannot reuse the old intent or mutate its lines.
    await fresh();
    window.fixture.responses["sheet-present"] = { error: { code: "Canceled" } };
    await invoke(() => {
      first = window.mixed.checkout();
    });
    await first;
    await invoke(() => {
      const c = window.cart.getState().cart;
      window.cart
        .getState()
        .updateLineItemQuantity(c.lineItems[0].lineItemId, 1);
    });
    await invoke(() => {
      first = window.mixed.checkout();
    });
    assert.match((await first).error, /Clear the cart/);
    assert.equal(count("cart-create-hold"), 1);
    assert.equal(count("sheet-present"), 1);
    // Restart/hard reload has a persisted PI but deliberately no client secret.
    await fresh();
    await invoke(() =>
      window.cart.getState().setPaymentIntent("pi_before_reload"),
    );
    assert.ok(button("View order status"));
    assert.ok(button("Start a new cart"));
    assert.equal(button("Continue to payment"), undefined);
    assert.equal(button("Decrease General Admission quantity").disabled, true);
    await invoke(() => {
      first = window.mixed.checkout();
    });
    assert.match((await first).error, /Clear the cart/);
    assert.equal(count("cart-create-hold"), 0);
    const oldId = window.cart.getState().cart.cartId;
    await click("Start a new cart");
    await invoke(() => window.newCart(1));
    assert.notEqual(window.cart.getState().cart.cartId, oldId);
    await start();
    assert.ok(hasPayment());
    assert.equal(count("cart-create-hold"), 1);
    console.log(
      "PASS: native cancel/retry reuses one intent; edited/restarted payment-bound carts require explicit new-cart recovery.",
    );
    await fresh();
    const activeCartId = window.cart.getState().cart.cartId;
    window.fixture.status = {
      completed: true,
      cart: { status: "completed" },
      tickets: [],
      addons: [],
    };
    await invoke(() =>
      window.showSuccess("99999999-9999-4999-8999-999999999999"),
    );
    assert.equal(
      window.cart.getState().cart.status,
      "draft",
      "old order must not complete the new cart",
    );
    await invoke(() => window.showSuccess(activeCartId));
    assert.equal(
      window.cart.getState().cart.status,
      "completed",
      "matching order does complete its cart",
    );
    await invoke(() => window.newCart(1));
    assert.equal(
      window.cart.getState().cart.status,
      "draft",
      "later cart replacement is not completed by stale status",
    );
    console.log(
      "PASS: real success screen completes only the queried cart, never an older order's replacement cart.",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: real native hooks reject same-tick/stale/cross-hook duplicates, use current carts, and release failures.",
    );
  } finally {
    if (window) await act(async () => window.unmount());
    await window?.happyDOM.close();
  }
})().catch((error) => {
  console.error(error.stack);
  if (error.errors)
    for (const cause of error.errors) console.error(cause.stack);
  process.exitCode = 1;
});
