import { createHash } from "node:crypto";

export const CLAIM_PATH = "/public/staff/claim";
const ISSUE_PATH = "/staff-email/invite/";
const AUTH_RETURN = encodeURIComponent(CLAIM_PATH);

export type StaffEmailRuntime = {
  // A fixed configured origin, never inferred from the inbound Host header.
  origin: string;
  issuanceReady: boolean;
  actor: (request: Request) => Promise<string | null>;
  mayIssue: (actor: string, eventId: number, request: Request) => Promise<boolean>;
  // The staged entry repeats session, rate-limit, owner/verified-email checks
  // and performs the transaction. The screen's authorization is not authority.
  dispatch: (request: Request, operation: { kind: "issue" | "revoke"; eventId: number } | { kind: "claim" }, actor: string) => Promise<Response>;
};

const policy = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

const plain = (body: string, status: number) => new Response(body, {
  status, headers: { ...policy, "Content-Type": "text/plain; charset=utf-8" },
});

const html = (headline: string, body: string, js: string = "") => {
  const hash = createHash("sha256").update(js).digest("base64");
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${headline}</title>${js ? `<script>${js}</script>` : ""}</head><body><main><h1>${headline}</h1>${body}</main></body></html>`, {
    headers: {
      ...policy,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": `default-src 'none'; script-src 'sha256-${hash}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
    },
  });
};

// A standalone route handler serves this document, bypassing Next client
// instrumentation, app layout, third-party pixels, and service-worker setup.
// Keep this the first script. It captures and removes the secret before any
// navigation and does not write it to storage/browser state or auth URLs.
const claimScript = `(() => {
  let token = /^#[a-f0-9]{64}$/.test(location.hash) ? location.hash.slice(1) : null;
  addEventListener("pagehide", () => { token = null; });
  // Reopening the email in a tab already on the clean return path can be
  // fragment-only navigation. Refresh the server session before allowing
  // acceptance; HTTP never carries the fragment to the server.
  addEventListener("hashchange", () => {
    if (/^#[a-f0-9]{64}$/.test(location.hash)) location.reload();
    else if (location.hash) history.replaceState(null, "", location.pathname);
  });
  try { history.replaceState(null, "", location.pathname); }
  catch { location.replace(location.pathname); return; }
  addEventListener("DOMContentLoaded", () => {
    const status = document.querySelector("[role=status]");
    const button = document.querySelector("#staff-email-accept");
    const links = document.querySelector("#staff-email-links");
    if (!token) { status.textContent = "Open the original invitation email to continue."; return; }
    if (!button) return;
    button.disabled = false;
    button.onclick = async () => {
      button.disabled = true;
      if (!token) { status.textContent = "Open the original invitation email to continue."; return; }
      try {
        const response = await fetch(location.pathname, {
          method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({token}),
          credentials: "same-origin", cache: "no-store", referrerPolicy: "same-origin"
        });
        const accepted = response.ok && (await response.json()).state === "accepted";
        if (accepted) {
          status.textContent = "Staff invitation accepted.";
          button.hidden = true;
          links.hidden = true;
        } else if (response.status === 401) {
          status.textContent = "Sign in again, then reopen the original invitation email.";
        } else if (response.status === 429 || response.status >= 500) {
          status.textContent = "Could not check this invitation. Try again.";
          button.disabled = false;
        } else {
          status.textContent = "This invitation is not available to this account. Verify the invited email and complete account verification, then reopen the original link.";
        }
      } catch {
        status.textContent = "Could not check this invitation. Try again.";
        button.disabled = false;
      }
    };
  });
})();`;

const issueScript = (eventId: number) => `addEventListener("DOMContentLoaded", () => {
  const form=document.querySelector("form"), button=form.querySelector("button");
  const status=document.querySelector("[role=status]");
  const revoke=document.querySelector("#staff-email-revoke");
  let active=false, pending;
  button.disabled=false;
  form.onsubmit=async event=>{
    event.preventDefault();
    if(active || button.disabled) return;
    const email=form.elements.email.value.trim(), role=form.elements.role.value;
    if(pending && (pending.email!==email || pending.role!==role)) {
      status.textContent="Restore the original address and role to retry the same request."; return;
    }
    pending ||= {eventId:${eventId}, email, role, requestId:crypto.randomUUID()};
    active=true; button.disabled=true;
    try {
      const response=await fetch(location.pathname,{
        method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(pending),
        credentials:"same-origin", cache:"no-store", referrerPolicy:"same-origin"
      });
      if(response.status===202 && (await response.json()).state==="queued"){
        form.reset();
        status.textContent="Invitation queued. Delivery is not confirmed.";
        revoke.hidden=false;
        return;
      }
      status.textContent="Invitation was not confirmed. Retry the same request.";
    } catch {
      status.textContent="Invitation outcome unknown. Retry the same request.";
    } finally {
      active=false;
      button.disabled = status.textContent === "Invitation queued. Delivery is not confirmed.";
    }
  };
  revoke.onclick=async()=>{
    if(!pending || revoke.disabled) return;
    revoke.disabled=true;
    try {
      const response=await fetch(location.pathname,{
        method:"POST", headers:{"Content-Type":"application/json","X-DVNT-Staff-Action":"revoke"},
        body:JSON.stringify({eventId:pending.eventId,requestId:pending.requestId}),
        credentials:"same-origin", cache:"no-store", referrerPolicy:"same-origin"
      });
      if (response.ok && (await response.json()).state==="revoked"){
        status.textContent="Invitation revoked. Its link can no longer grant access.";
        revoke.hidden=true; return;
      }
      status.textContent="Revocation was not confirmed. The invitation may already be accepted or closed.";
    } catch { status.textContent="Revocation outcome unknown. Check the event staff roster before retrying."; }
    finally { revoke.disabled=false; }
  };
});`;

function eventIdFrom(request: Request) {
  const path = new URL(request.url).pathname;
  if (!path.startsWith(ISSUE_PATH)) return null;
  const raw = path.slice(ISSUE_PATH.length);
  const id = Number(raw);
  return /^[1-9][0-9]*$/.test(raw) && Number.isInteger(id) && id<=2147483647 ? id : null;
}

export function staffEmailRoutes(runtime: StaffEmailRuntime | null) {
  const unavailable = () => plain("Not found", 404);
  // Next may normalize the request URL to its internal origin. Match the
  // actual inbound Host to the configured origin; never trust forwarded host.
  const hostAllowed = (request: Request) => !!runtime && request.headers.get("host") === new URL(runtime.origin).host;
  const originAllowed = (request: Request) => {
    if (!runtime || !hostAllowed(request)) return false;
    const origin = request.headers.get("origin");
    return origin === null ? request.headers.get("sec-fetch-site") === "same-origin" : origin === runtime.origin;
  };

  return {
    async claimPage(request: Request) {
      if (!runtime || !hostAllowed(request)) return unavailable();
      // The fragment does not reach this server. In particular, this GET never
      // redeems the invite; email prefetchers and automated scanners cannot claim.
      let actor: string | null;
      try { actor = await runtime.actor(request); } catch { return plain("Try again", 503); }
      return html("Review your staff invitation",
        `<p role="status"></p>${actor ? '<button type="button" id="staff-email-accept" disabled>Accept with this account</button>' : ""}
        <div id="staff-email-links"><p>Use the invited email and complete the usual account verification.
        After signing in or creating an account, reopen the original invitation email. This page never carries the secret through sign-up.</p>
        ${actor ? "" : `<a href="/auth/signup?returnTo=${AUTH_RETURN}">Create an account</a> <a href="/auth/login?returnTo=${AUTH_RETURN}">Sign in</a>`}</div>`,
        claimScript);
    },
    async issuePage(request: Request) {
      if (!runtime || !runtime.issuanceReady || !hostAllowed(request)) return unavailable();
      const eventId = eventIdFrom(request);
      if (eventId === null) return unavailable();
      try {
        const actor = await runtime.actor(request);
        if (!actor || !(await runtime.mayIssue(actor, eventId, request))) return unavailable();
      } catch { return plain("Try again", 503); }
      return html("Invite event staff by email",
        `<p>Only the invited, verified email can accept. An invitation will not publish the event.</p>
        <form><label>Email <input name="email" type="email" maxlength="254" required></label>
        <label>Role <select name="role"><option value="admin">Co-host</option><option value="editor">Manager</option></select></label>
        <button type="submit" disabled>Queue email invitation</button></form>
        <button id="staff-email-revoke" type="button" hidden>Revoke this invitation</button>
        <p role="status"></p><a href="/feed/events/${eventId}/staff">Back to event staff</a>`, issueScript(eventId));
    },
    async mutate(request: Request, operation: "issue" | "claim" | "revoke") {
      if (!runtime) return unavailable();
      if (!originAllowed(request)) return plain("Not allowed", 403);
      if (operation==="issue" && !runtime.issuanceReady) return unavailable();
      try {
        const actor = await runtime.actor(request);
        if (!actor) return plain("Sign in required", 401);
        if (operation !== "claim") {
          const eventId = eventIdFrom(request);
          if (eventId === null || !(await runtime.mayIssue(actor, eventId, request))) return unavailable();
          // The bounded request parser checks this path authority against the
          // body before queueing. Do not rewrite it by parsing any body twice.
          return await runtime.dispatch(request, { kind: operation, eventId }, actor);
        }
        return await runtime.dispatch(request, { kind: "claim" }, actor);
      } catch { return plain("Try again", 503); }
    },
  };
}
