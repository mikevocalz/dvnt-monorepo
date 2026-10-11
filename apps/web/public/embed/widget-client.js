/* DVNT ticket selection runs in its own document. All payment UI stays outside it. */
(() => {
  'use strict';
  const data = JSON.parse(document.getElementById('dvnt-data').textContent);
  const $ = (id) => document.getElementById(id);
  let quoteHash = null, sequence = 0, pending = null;
  const send = (type, payload = {}) => parent.postMessage({ version: 1, channel: data.channel, type, ...payload }, data.allowedOrigin);
  const size = () => send('height', { height: Math.ceil(document.querySelector('.widget').getBoundingClientRect().height) });
  const money = (c) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  function lockSelection(locked) { document.querySelectorAll('.checkout input, .checkout select').forEach((input) => { input.disabled = locked; }); }
  function changed() {
    quoteHash = null; pending = null; sequence++;
    $('totals').hidden = true; $('error').hidden = true;
    $('continue').disabled = false; $('continue').textContent = 'Review total';
    size();
  }
  function attendeeFields() {
    const count = Number($('quantity').value), root = $('attendees');
    const old = Array.from(root.querySelectorAll('input')).map((i) => i.value);
    root.replaceChildren();
    if (data.event.attendeeNamesRequired) for (let i = 0; i < count; i++) {
      const label = document.createElement('label'); label.className = 'field'; label.textContent = `Attendee ${i + 1}`;
      const input = document.createElement('input'); input.maxLength = 40; input.required = true;
      input.value = old[i] || ''; input.setAttribute('aria-label', `Attendee ${i + 1}`);
      label.append(input); root.append(label);
    }
    changed();
  }
  function tierChanged() {
    const selected = document.querySelector('input[name="tier"]:checked');
    const tier = data.tiers.find((t) => t.id === selected?.value);
    $('quantity').replaceChildren();
    if (!tier) return;
    const maximum = Math.min(10, tier.maxQuantity, tier.available ?? 10);
    for (let i = 1; i <= maximum; i++) { const option = new Option(String(i), String(i)); $('quantity').add(option); }
    attendeeFields();
  }
  $('selection').addEventListener('input', changed);
  document.querySelectorAll('input[name="tier"]').forEach((i) => i.addEventListener('change', tierChanged));
  $('quantity').addEventListener('change', attendeeFields);
  $('continue').addEventListener('click', () => {
    const inputs = [$('buyer-name'), $('buyer-email'), ...$('attendees').querySelectorAll('input')];
    if (inputs.some((i) => !i.reportValidity())) return;
    const payload = { tierId: document.querySelector('input[name="tier"]:checked')?.value,
      quantity: Number($('quantity').value), name: $('buyer-name').value.trim(), email: $('buyer-email').value.trim(),
      promoterCode: $('promoter-code').value.trim(), attendeeNames: Array.from($('attendees').querySelectorAll('input')).map((i) => i.value.trim()) };
    const requestId = ++sequence; pending = requestId;
    lockSelection(true);
    $('continue').disabled = true; $('continue').textContent = quoteHash ? 'Opening secure checkout…' : 'Checking price…';
    send(quoteHash ? 'checkout' : 'quote', { requestId, payload: { ...payload, ...(quoteHash ? { quoteHash } : {}) } });
    // Do not create another attempt on timeout. The parent retains its attempt ID.
    setTimeout(() => { if (pending === requestId) { pending = null; lockSelection(!!quoteHash); $('continue').disabled = false;
      $('continue').textContent = quoteHash ? 'Resume checkout' : 'Review total'; } }, 30000);
  });
  window.addEventListener('message', (event) => {
    const message = event.data;
    if (event.source !== parent || event.origin !== data.allowedOrigin || message?.version !== 1 || message.channel !== data.channel || message.requestId !== pending) return;
    pending = null; lockSelection(false); $('continue').disabled = false;
    if (message.type === 'quote') {
      quoteHash = message.result.quoteHash; const totals = message.result.totals; $('totals').replaceChildren();
      for (const [label, value, total] of [['Tickets', totals.subtotal, false], ['Service fee', totals.serviceFee, false], ['Total', totals.total, true]]) {
        const row = document.createElement('p'); if (total) row.className = 'total';
        const left = document.createElement('span'); left.textContent = label;
        const right = document.createElement('span'); right.textContent = money(value); row.append(left, right); $('totals').append(row);
      }
      if (totals.discount > 0) { const note = document.createElement('p'); note.textContent = `Promoter discount applied: ${money(totals.discount)}`; $('totals').prepend(note); }
      $('totals').hidden = false; $('continue').textContent = `Pay ${money(totals.total)}`;
    } else if (message.type === 'error') {
      $('error').textContent = message.error || 'Please try again.'; $('error').hidden = false;
      if (['quote_changed','selection_changed','sold_out','buyer_limit','tier_unavailable','promoter_changed','embed_unavailable','organizer_changed','invalid_buyer','names_required'].includes(message.code)) quoteHash = null;
      lockSelection(!!quoteHash);
      $('continue').textContent = quoteHash ? 'Resume checkout' : 'Review total';
    }
    size();
  });
  new ResizeObserver(size).observe(document.querySelector('.widget'));
  tierChanged(); size(); send('ready');
})();
