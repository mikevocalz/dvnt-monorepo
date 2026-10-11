/* Version 1: selection iframe + Stripe mounted in the merchant document, never nested. */
(() => {
  'use strict';
  const script = document.currentScript;
  if (!script?.src) return;
  const site = new URL(script.src).origin;
  const GLOBAL = '__dvntTicketEmbedV1';
  if (window[GLOBAL]) { window[GLOBAL].mount(); return; }
  const mounted = new WeakSet();
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
  let stripePromise;
  function stripeLibrary() {
    if (typeof window.Stripe === 'function') return Promise.resolve(window.Stripe);
    if (stripePromise) return stripePromise;
    stripePromise = new Promise((resolve, reject) => {
      let tag = document.querySelector('script[src^="https://js.stripe.com/"]');
      const own = !tag; if (!tag) { tag = document.createElement('script'); tag.src = 'https://js.stripe.com/v3/'; tag.async = true; }
      const timer = setTimeout(() => reject(new Error('Stripe could not load. Check your connection and retry.')), 20000);
      tag.addEventListener('load', () => { clearTimeout(timer); typeof window.Stripe === 'function' ? resolve(window.Stripe) : reject(new Error('Stripe is unavailable.')); }, { once: true });
      tag.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Stripe could not load.')); }, { once: true });
      if (own) document.head.append(tag);
    }).catch((error) => { stripePromise = null; throw error; });
    return stripePromise;
  }
  function mountOne(host) {
    const embedId = host.getAttribute('data-dvnt-ticket-embed');
    if (mounted.has(host) || !uuid.test(embedId || '') || host.shadowRoot) return;
    mounted.add(host);
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = ':host{display:block;width:100%;max-width:1100px;margin:0 auto;color-scheme:dark}*{box-sizing:border-box}[hidden]{display:none!important}iframe{display:block;width:100%;height:960px;border:0;background:transparent}.panel{font:14px/1.6 Inter,system-ui,sans-serif;color:#fff;background:#09090c;border:1px solid #ffffff22;border-radius:16px;padding:20px;overflow-wrap:anywhere}.actions{display:flex;gap:12px;flex-wrap:wrap}button,a{font:inherit;color:#8edaff}button{border:1px solid #ffffff33;background:#18161f;border-radius:10px;padding:10px 16px;cursor:pointer}button:disabled{opacity:.5;cursor:wait}.brand{width:100px;height:auto}.message{margin:16px 0}a{display:inline-block;margin:8px 16px 8px 0}:focus-visible{outline:2px solid #3fdcff;outline-offset:3px}';
    const frame = document.createElement('iframe'), panel = document.createElement('section');
    const channel = crypto.randomUUID();
    frame.title = 'DVNT event tickets'; frame.referrerPolicy = 'no-referrer';
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    frame.src = `${site}/embed/tickets/${embedId}?channel=${encodeURIComponent(channel)}`;
    panel.className = 'panel'; panel.hidden = true; panel.setAttribute('aria-label', 'Secure ticket checkout');
    root.append(style, frame, panel);
    let attempt = null, checkout = null, busy = false, generation = 0;
    const storageKey = `dvnt-ticket-checkout-v1:${embedId}`;
    function restore() {
      try { const item = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
        if (item && uuid.test(item.attemptId) && /^[a-f0-9]{64}$/.test(item.token)) attempt = item;
      } catch { /* Third-party/browser storage may be blocked. Keep this page's attempt in memory. */ }
    }
    function remember() { try { sessionStorage.setItem(storageKey, JSON.stringify(attempt)); } catch {} }
    function forget() { attempt = null; try { sessionStorage.removeItem(storageKey); } catch {} }
    function newAttempt() {
      restore();
      if (!attempt) { const bytes = crypto.getRandomValues(new Uint8Array(32));
        attempt = { attemptId: crypto.randomUUID(), token: Array.from(bytes).map((n) => n.toString(16).padStart(2, '0')).join('') }; remember(); }
      return attempt;
    }
    async function api(action, body = {}) {
      const response = await fetch(`${site}/embed/api`, { method: 'POST', credentials: 'omit', cache: 'no-store',
        referrerPolicy: 'no-referrer', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, embedId, ...body }), signal: AbortSignal.timeout(25000) });
      let result;
      try { result = await response.json(); } catch { throw new Error('Checkout is temporarily unavailable. Please retry.'); }
      if (!response.ok || result.error) { const error = new Error(result.error || 'Checkout is unavailable.'); error.code = result.code; throw error; }
      return result;
    }
    function post(type, requestId, extra) { frame.contentWindow?.postMessage({ version: 1, channel, type, requestId, ...extra }, site); }
    function destroyCheckout() { if (checkout) { checkout.destroy(); checkout = null; } }
    function heading(text) {
      panel.replaceChildren(); const brand = document.createElement('img'); brand.className = 'brand'; brand.src = `${site}/dvnt-wordmark.svg`; brand.alt = 'DVNT';
      const message = document.createElement('p'); message.className = 'message'; message.setAttribute('role', 'status'); message.textContent = text;
      panel.append(brand, message); panel.hidden = false; frame.hidden = true;
      return message;
    }
    function button(label, run) {
      const control = document.createElement('button'); control.type = 'button'; control.textContent = label;
      control.addEventListener('click', async () => { if (control.disabled) return; control.disabled = true;
        try { await run(); } catch (error) { const message = document.createElement('p'); message.setAttribute('role', 'alert'); message.textContent = error.message; panel.append(message); }
        finally { control.disabled = false; } }); panel.append(control); return control;
    }
    function showStatus(result) {
      destroyCheckout();
      if (result.state === 'fulfilled') {
        heading('Your tickets are ready. Your payment is confirmed.');
        for (const ticket of result.tickets || []) { const url = new URL(ticket.url);
          if (url.origin !== site || !url.pathname.startsWith('/public/tickets/guest/')) continue;
          const link = document.createElement('a'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = `Open ticket ${panel.querySelectorAll('a').length + 1}`; panel.append(link); }
        const delivery = document.createElement('p'); delivery.textContent = result.emailStatus === 'sent' ? 'A copy was emailed to you.' : 'Your ticket email is being prepared. You can open your tickets above.'; panel.append(delivery);
      } else if (result.state === 'expired') {
        forget(); generation++; panel.hidden = true; frame.hidden = false; frame.src = `${site}/embed/tickets/${embedId}?channel=${encodeURIComponent(channel)}`;
      } else if (['refunded','partially_refunded','cancelled','failed','payment_failed','disputed'].includes(result.state)) {
        heading(`Order status: ${result.state}. No new payment has been started.`);
      } else {
        heading(result.state === 'paid_issuing' ? 'Payment received. Preparing your tickets—do not pay again.' : 'Checking your payment. Keep this page open.');
        button('Check ticket status', () => poll());
      }
    }
    async function poll() {
      if (!attempt) return;
      const current = ++generation;
      for (let i = 0; i < 60 && generation === current; i++) {
        const result = await api('status', attempt);
        if (generation !== current) return;
        showStatus(result);
        if (['fulfilled','expired','refunded','partially_refunded','cancelled','failed','payment_failed','disputed'].includes(result.state)) return;
        if (result.state === 'payment_open' || result.state === 'preparing') {
          button('Resume secure checkout', () => resume()); return;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    async function openPayment(result) {
      if (result.state !== 'payment_open' || !result.clientSecret) { showStatus(result); if (['paid_issuing','payment_processing'].includes(result.state)) await poll(); return; }
      const Stripe = await stripeLibrary();
      destroyCheckout(); heading('Secure payment');
      const target = document.createElement('div'); panel.append(target);
      // Mount by element in the merchant document. Never post the client secret
      // into the selection iframe, its URL, analytics, or browser storage.
      const instance = await Stripe(result.publishableKey).initEmbeddedCheckout({
        fetchClientSecret: async () => result.clientSecret,
        onComplete: () => { poll().catch((error) => { heading(error.message); button('Check ticket status', () => poll()); }); },
      });
      checkout = instance; instance.mount(target);
      button('Cancel checkout', async () => {
        const state = await api('cancel', attempt);
        if (state.state === 'expired') showStatus(state);
        else { showStatus(state); await poll(); }
      });
    }
    async function resume() {
      if (!attempt) return;
      const result = await api('resume', attempt); await openPayment(result);
    }
    window.addEventListener('message', async (event) => {
      const message = event.data;
      if (event.source !== frame.contentWindow || event.origin !== site || !message || message.version !== 1 || message.channel !== channel) return;
      if (message.type === 'height') { if (typeof message.height === 'number' && Number.isFinite(message.height)) frame.style.height = `${Math.max(200, Math.min(4000, Math.ceil(message.height)))}px`; return; }
      if (!['quote','checkout'].includes(message.type) || !Number.isSafeInteger(message.requestId) || !message.payload || typeof message.payload !== 'object') return;
      if (busy && message.type === 'checkout') { post('error', message.requestId, { error: 'Checkout is already opening. Please wait.' }); return; }
      try {
        if (message.type === 'quote') { const result = await api('quote', message.payload); post('quote', message.requestId, { result }); }
        else { busy = true; const result = await api('checkout', { ...message.payload, ...newAttempt() }); await openPayment(result); }
      } catch (error) {
        post('error', message.requestId, { error: error.message, code: error.code });
        if (frame.hidden) { heading(error.message); button('Resume secure checkout', () => resume()); }
      } finally { if (message.type === 'checkout') busy = false; }
    });
    restore();
    if (attempt) { heading('An existing checkout was found for this event. Resume it to avoid starting another order.');
      button('Resume checkout / view tickets', () => resume());
      button('Back to event tickets', () => { panel.hidden = true; frame.hidden = false; }); }
  }
  function mount() { document.querySelectorAll('[data-dvnt-ticket-embed]').forEach(mountOne); }
  window[GLOBAL] = { mount }; mount();
})();
