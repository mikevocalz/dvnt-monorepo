#!/usr/bin/env node
// Execute the real checkout screen, native hooks, cart/payment stores and API
// parsing in Chromium. Only auth, transport, unrelated UI and Stripe are stubbed.
// All data is synthetic. No production request, payment, ticket or email.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");
const ROOT = path.resolve(__dirname, "..");
const {
  buildCheckoutFixture,
  TIER,
} = require("./fixtures/reviewed-checkout.cjs");
(async () => {
  const built = await buildCheckoutFixture();
  const server = http.createServer((req, res) => {
    res.setHeader(
      "Content-Type",
      req.url === "/bundle.js" ? "application/javascript" : "text/html",
    );
    res.end(
      req.url === "/bundle.js"
        ? built.outputFiles[0].contents
        : '<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>',
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    const executablePath =
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
      (fs.existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
    browser = await chromium.launch({
      headless: true,
      executablePath,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const fresh = async () => {
      await page.goto("http://127.0.0.1:" + server.address().port);
      await page
        .getByRole("button", { name: "Continue to payment", exact: true })
        .waitFor();
    };
    const count = (name) =>
      page.evaluate(
        (name) => window.fixture.calls.filter((c) => c.name === name).length,
        name,
      );
    const gate = (name) =>
      page.evaluate((name) => (window.fixture.gates[name] = true), name);
    const release = (name, error) =>
      page.evaluate(({ name, error }) => window.release(name, error), {
        name,
        error,
      });
    const waitCall = (name) =>
      page.waitForFunction(
        (name) => window.fixture.calls.some((c) => c.name === name),
        name,
      );
    const start = () =>
      page
        .getByRole("button", { name: "Continue to payment", exact: true })
        .click();
    const pay = () =>
      page.getByRole("button", { name: "Pay $39.93", exact: true });
    const ready = async () => {
      await fresh();
      await start();
      await pay().waitFor();
    };

    await fresh();
    await gate("cart-create-hold");
    await page.evaluate(() => {
      const find = (label) =>
        document.querySelector('[aria-label="' + label + '"]');
      const button = [...document.querySelectorAll("button")].find(
        (b) => b.textContent === "Continue to payment",
      );
      button.click();
      button.click();
      find("Decrease General Admission quantity").click();
      find("Clear cart").click();
    });
    await waitCall("cart-create-hold");
    assert.equal(await count("cart-create-hold"), 1);
    assert.equal(
      await page.evaluate(
        () => window.cart.getState().cart.lineItems[0].quantity,
      ),
      2,
      "same-tick edit cannot change held order",
    );
    for (const label of [
      "Decrease General Admission quantity",
      "Increase General Admission quantity",
      "Remove General Admission",
      "Clear cart",
      "Go back",
    ])
      assert.equal(
        await page
          .getByRole("button", { name: label, exact: true })
          .isDisabled(),
        true,
        label,
      );
    await release("cart-create-hold");
    await pay().waitFor();
    assert.equal(await count("cart-checkout"), 1);
    for (const label of [
      "Decrease General Admission quantity",
      "Increase General Admission quantity",
      "Remove General Admission",
      "Clear cart",
    ])
      assert.equal(
        await page
          .getByRole("button", { name: label, exact: true })
          .isDisabled(),
        true,
        label,
      );
    assert.equal(
      await page
        .getByRole("textbox", { name: "Promo or promoter code" })
        .isDisabled(),
      true,
    );
    assert.equal(
      await page.getByRole("button", { name: "Add", exact: true }).count(),
      2,
      "both add-on kinds rendered",
    );
    for (const button of await page
      .getByRole("button", { name: "Add", exact: true })
      .all())
      assert.equal(await button.isDisabled(), true);
    const text = await page.locator("main").innerText();
    assert.match(text, /\$40\.00/);
    assert.match(text, /−\$3\.00/);
    assert.match(text, /\$2\.93/);
    assert.match(text, /\$39\.93/);
    assert.doesNotMatch(
      text,
      /\$63\.50/,
      "local estimate no longer labels payment",
    );
    await gate("submit");
    await page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find(
        (b) => b.textContent === "Pay $39.93",
      );
      button.click();
      button.click();
    });
    await waitCall("submit");
    assert.equal(await count("submit"), 1);
    assert.equal(await count("confirm"), 0);
    await release("submit");
    await waitCall("confirm");
    await page.waitForSelector("[data-away]");
    assert.equal(await count("confirm"), 1);
    const paidId = await page.evaluate(
      () => window.cart.getState().cart.cartId,
    );
    assert.match(
      await page.evaluate(() => window.fixture.navigation.at(-1)),
      new RegExp("cartId=" + paidId),
    );
    console.log(
      "PASS: reviewed quantities locked, server totals displayed, duplicate Continue/Pay blocked, paid cart pinned.",
    );

    // Interrupted cart creation cannot write hold/payment metadata to a new cart.
    for (const stage of ["cart-create-hold", "cart-checkout"]) {
      await fresh();
      await gate(stage);
      await start();
      await waitCall(stage);
      const replacement = await page.evaluate(() => window.newCart(1));
      await release(stage);
      await page.waitForFunction(
        () => !window.payments.getState().checkoutLoading,
      );
      assert.equal(await page.locator("[data-payment-element]").count(), 0);
      assert.equal(
        await page.evaluate(() => window.cart.getState().cart.cartId),
        replacement,
      );
      assert.equal(
        await page.evaluate(() => window.cart.getState().cart.holdExpiresAt),
        undefined,
      );
      assert.equal(
        await page.evaluate(() => window.cart.getState().cart.paymentIntentId),
        undefined,
      );
      if (stage === "cart-create-hold")
        assert.equal(await count("cart-checkout"), 0);
    }
    // Back/forward with a pending request resumes the same immutable quote.
    await fresh();
    await gate("cart-checkout");
    await start();
    await waitCall("cart-checkout");
    await page.evaluate(() => window.navigate("/event"));
    await page.waitForSelector("[data-away]");
    await page.evaluate(() => window.showReview());
    await release("cart-checkout");
    await page.waitForFunction(
      () => !window.payments.getState().checkoutLoading,
    );
    await pay().waitFor();
    assert.equal(await count("cart-create-hold"), 1);
    // A cart edited elsewhere immediately removes the old payment form.
    await ready();
    await page.evaluate(() => {
      const c = window.cart.getState().cart;
      window.cart
        .getState()
        .updateLineItemQuantity(c.lineItems[0].lineItemId, 1);
    });
    await page.waitForFunction(
      () => !document.querySelector("[data-payment-element]"),
    );
    assert.equal(await count("confirm"), 0);
    await ready();
    await page.getByRole("button", { name: "Go back", exact: true }).click();
    await page.waitForSelector("[data-away]");
    await page.evaluate(() => window.showReview());
    await pay().waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Decrease General Admission quantity" })
        .isDisabled(),
      true,
    );
    assert.equal(await count("cart-create-hold"), 1);
    await page
      .getByRole("button", { name: "Start a new cart", exact: true })
      .click();
    assert.equal(await page.evaluate(() => window.cart.getState().cart), null);
    await page.evaluate(() => window.newCart(1));
    await page
      .getByRole("button", { name: "Continue to payment", exact: true })
      .waitFor();
    console.log(
      "PASS: replacement/clear/back/remount discard stale quotes without contaminating the active cart.",
    );

    // Stale confirmations never progress beyond submit; failures release the lock.
    for (const change of ["clear", "replace", "back"]) {
      await ready();
      await gate("submit");
      await pay().click();
      await waitCall("submit");
      await page.evaluate((change) => {
        if (change === "clear") window.cart.getState().clearCart();
        else if (change === "replace") window.newCart(1);
        else window.navigate("/event");
      }, change);
      await release("submit");
      await page.waitForFunction(
        () => !window.payments.getState().checkoutLoading,
      );
      assert.equal(await count("confirm"), 0, change);
    }
    await ready();
    await gate("submit");
    await pay().click();
    await waitCall("submit");
    await release("submit", "Synthetic network failure");
    await pay().waitFor();
    assert.equal(await pay().isDisabled(), false);
    assert.equal(await count("confirm"), 0);
    await pay().click();
    await waitCall("confirm");
    await ready();
    await page.evaluate(() => {
      const expiredNow = Date.now() + 700000;
      Date.now = () => expiredNow;
    });
    await pay().click();
    assert.equal(
      await page
        .getByRole("button", { name: "Reservation expired", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(await count("confirm"), 0);
    assert.equal(await count("submit"), 0);
    console.log(
      "PASS: cart changes during submit, provider exception/retry, and expired hold all fail safely.",
    );

    // Execute both actual native hooks; saved callbacks model stale render closures.
    const args = { eventId: "1", ticketTypeId: TIER, quantity: 1 };
    await fresh();
    await gate("token");
    const second = await page.evaluate((args) => {
      window.savedTicket = window.ticket.checkout;
      window.firstTicket = window.savedTicket(args);
      return window.savedTicket(args);
    }, args);
    assert.equal(second.error, "Checkout already in progress");
    assert.equal(await count("token"), 1);
    assert.equal(
      (await page.evaluate((args) => window.savedTicket(args), args)).error,
      "Checkout already in progress",
    );
    await release("token");
    assert.equal((await page.evaluate(() => window.firstTicket)).success, true);
    assert.equal(await count("create-payment-intent"), 1);
    assert.equal(
      (await page.evaluate((args) => window.savedTicket(args), args)).success,
      true,
      "stale callback can retry after release",
    );
    await fresh();
    await gate("token");
    await page.evaluate((args) => {
      window.firstTicket = window.ticket.checkout(args);
    }, args);
    assert.equal(
      (await page.evaluate(() => window.mixed.checkout())).error,
      "Checkout already in progress",
      "single-ticket and mixed hooks share the same lock",
    );
    await release("token");
    await page.evaluate(() => window.firstTicket);
    await fresh();
    await gate("cart-create-hold");
    assert.equal(
      (
        await page.evaluate(() => {
          window.savedMixed = window.mixed.checkout;
          window.firstMixed = window.savedMixed();
          return window.savedMixed();
        })
      ).error,
      "Checkout already in progress",
    );
    assert.equal(await count("cart-create-hold"), 1);
    assert.equal(
      (await page.evaluate(() => window.savedMixed())).error,
      "Checkout already in progress",
    );
    await release("cart-create-hold");
    assert.equal((await page.evaluate(() => window.firstMixed)).success, true);
    assert.equal(await count("sheet-present"), 1);
    // An old native callback must use the current cart, not its captured cart.
    const nextId = await page.evaluate(() => window.newCart(1));
    await page.evaluate(() => window.savedMixed());
    assert.equal(
      await page.evaluate(
        () =>
          window.fixture.calls
            .filter((c) => c.name === "cart-create-hold")
            .at(-1).payload.cartId,
      ),
      nextId,
    );
    await fresh();
    await gate("cart-create-hold");
    await page.evaluate(() => {
      window.firstMixed = window.mixed.checkout();
    });
    await waitCall("cart-create-hold");
    await page.evaluate(() => window.newCart(1));
    await release("cart-create-hold");
    assert.equal((await page.evaluate(() => window.firstMixed)).success, false);
    assert.equal(await count("cart-checkout"), 0);
    assert.equal(await count("sheet-present"), 0);
    await fresh();
    await gate("token");
    await page.evaluate((args) => {
      window.firstTicket = window.ticket.checkout(args);
    }, args);
    await release("token", "Synthetic auth failure");
    assert.equal(
      (await page.evaluate(() => window.firstTicket)).success,
      false,
    );
    assert.equal(
      await page.evaluate(() => window.payments.getState().checkoutLoading),
      false,
    );
    await fresh();
    await page.evaluate(() => {
      window.fixture.responses["sheet-present"] = {
        error: { code: "Canceled" },
      };
    });
    assert.equal(
      (await page.evaluate(() => window.mixed.checkout())).cancelled,
      true,
    );
    await page.evaluate(() => {
      delete window.fixture.responses["sheet-present"];
    });
    assert.equal(
      (await page.evaluate(() => window.mixed.checkout())).success,
      true,
    );
    assert.equal(await count("cart-create-hold"), 1);
    assert.equal(await count("cart-checkout"), 1);
    assert.equal(await count("sheet-present"), 2);
    await fresh();
    await page.evaluate(() => {
      window.fixture.responses["sheet-present"] = {
        error: { code: "Canceled" },
      };
    });
    await page.evaluate(() => window.mixed.checkout());
    await page.evaluate(() => {
      const c = window.cart.getState().cart;
      window.cart
        .getState()
        .updateLineItemQuantity(c.lineItems[0].lineItemId, 1);
    });
    assert.match(
      (await page.evaluate(() => window.mixed.checkout())).error,
      /Clear the cart/,
    );
    assert.equal(await count("cart-create-hold"), 1);
    assert.equal(await count("sheet-present"), 1);
    await fresh();
    await page.evaluate(() =>
      window.cart.getState().setPaymentIntent("pi_before_reload"),
    );
    await page
      .getByRole("button", { name: "View order status", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Continue to payment", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page
        .getByRole("button", {
          name: "Decrease General Admission quantity",
          exact: true,
        })
        .isDisabled(),
      true,
    );
    assert.match(
      (await page.evaluate(() => window.mixed.checkout())).error,
      /Clear the cart/,
    );
    assert.equal(await count("cart-create-hold"), 0);
    const oldId = await page.evaluate(() => window.cart.getState().cart.cartId);
    await page
      .getByRole("button", { name: "Start a new cart", exact: true })
      .click();
    const freshId = await page.evaluate(() => window.newCart(1));
    assert.notEqual(freshId, oldId);
    await start();
    await pay().waitFor();
    assert.equal(await count("cart-create-hold"), 1);
    console.log(
      "PASS: native cancel/retry reuses one intent; edited/restarted payment-bound carts require explicit new-cart recovery.",
    );
    await fresh();
    const activeCartId = await page.evaluate(
      () => window.cart.getState().cart.cartId,
    );
    await page.evaluate(() => {
      window.fixture.status = {
        completed: true,
        cart: { status: "completed" },
        tickets: [],
        addons: [],
      };
      window.showSuccess("99999999-9999-4999-8999-999999999999");
    });
    await page
      .getByRole("button", { name: "View My Tickets", exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(() => window.cart.getState().cart.status),
      "draft",
    );
    await page.evaluate((id) => window.showSuccess(id), activeCartId);
    await page.waitForFunction(
      () => window.cart.getState().cart.status === "completed",
    );
    await page.evaluate(() => window.newCart(1));
    assert.equal(
      await page.evaluate(() => window.cart.getState().cart.status),
      "draft",
    );
    console.log(
      "PASS: real success screen never completes a newer cart from an old order status.",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: real native hooks reject same-tick/stale/cross-hook duplicate calls, use fresh carts, and release failed locks.",
    );
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
