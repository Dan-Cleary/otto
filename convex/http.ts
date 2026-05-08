import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import { verifyState } from "./zoom";

const http = httpRouter();
auth.addHttpRoutes(http);

// CORS preflight + headers used by the embedded widget.
const widgetCorsHeaders: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-otto-secret",
  "access-control-max-age": "86400",
};

// Widget no longer asks the user to choose a repo — Otto resolves it
// from the page URL via project URL patterns. The /widget/repos
// endpoint is gone. If a project doesn't match the URL, the parser
// falls back to the semantic router.

http.route({
  path: "/ingest/widget",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { headers: widgetCorsHeaders })),
});

http.route({
  path: "/ingest/widget",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const secret = req.headers.get("x-otto-secret") ?? "";
    if (!secret) {
      return new Response("unauthorized", {
        status: 401,
        headers: widgetCorsHeaders,
      });
    }

    // Resolve project (and therefore team) from the secret. Each
    // project owns its own widget secret on the `projects` table.
    const match = await ctx.runQuery(
      internal.ingest.findProjectByWidgetSecret,
      { secret },
    );
    if (!match) {
      return new Response("unauthorized", {
        status: 401,
        headers: widgetCorsHeaders,
      });
    }
    const { teamId, projectId } = match;

    let body: any;
    try {
      body = await req.json();
    } catch {
      return new Response("bad json", {
        status: 400,
        headers: widgetCorsHeaders,
      });
    }

    const sourceRef =
      typeof body?.url === "string" ? body.url : "widget:unknown";

    const trackingId: string = await ctx.runMutation(
      internal.ingest.recordWidget,
      { teamId, sourceRef, payload: body, projectId },
    );

    return new Response(JSON.stringify({ trackingId }), {
      headers: { "content-type": "application/json", ...widgetCorsHeaders },
    });
  }),
});

// Granola has no webhook system, so there is no /ingest/granola route.
// New meeting notes are pulled by the `granola.pollNewMeetings` cron
// (see convex/granola.ts and convex/crons.ts).

// Zoom OAuth callback. The "Connect Zoom" button in the admin UI
// sends users to Zoom's authorize URL with a signed state token; on
// consent, Zoom redirects them back here with a `code`. We exchange
// the code for tokens, persist them on the team's integration row,
// and bounce the user back to the admin app.
http.route({
  path: "/auth/zoom/callback",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const zoomError = url.searchParams.get("error");

    if (zoomError) {
      return zoomCallbackResponse(
        false,
        `zoom denied: ${zoomError}`,
        url.searchParams.get("error_description"),
      );
    }
    if (!code || !state) {
      return zoomCallbackResponse(false, "missing code or state");
    }

    const verified = await verifyState(state);
    if (!verified) {
      return zoomCallbackResponse(false, "invalid or expired state");
    }

    try {
      await ctx.runAction(internal.zoom.completeOAuthInternal, {
        teamId: verified.teamId as any,
        code,
      });
    } catch (err) {
      return zoomCallbackResponse(false, (err as Error).message);
    }

    return zoomCallbackResponse(true, "connected");
  }),
});

function zoomCallbackResponse(
  ok: boolean,
  message: string,
  detail?: string | null,
): Response {
  // Tiny self-contained HTML so the user lands on something readable.
  // The page tries to close itself if it was opened in a popup;
  // otherwise it offers a link back to the admin app.
  const safeMsg = escapeHtml(message);
  const safeDetail = detail ? escapeHtml(detail) : "";
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>otto · zoom · ${ok ? "connected" : "error"}</title>
<style>
  body { font: 14px ui-monospace, monospace; background: #ece4d3; color: #1c1a16; padding: 64px 24px; text-align: center; }
  .card { display: inline-block; max-width: 420px; background: #f6efde; border: 2px solid #1c1a16; box-shadow: 6px 6px 0 #b8ad94; padding: 32px 28px; text-align: left; }
  h1 { font: 32px 'VT323', monospace; margin: 0 0 12px; }
  .ok { color: #3d5440; }
  .err { color: #a04a2c; }
  p { margin: 8px 0; line-height: 1.5; }
  a.btn { display: inline-block; margin-top: 18px; padding: 8px 14px; background: #1c1a16; color: #f6efde; border: 1px solid #1c1a16; text-decoration: none; font: 11px ui-monospace, monospace; letter-spacing: 0.18em; text-transform: uppercase; }
</style>
</head>
<body>
<div class="card">
  <h1 class="${ok ? "ok" : "err"}">${ok ? "zoom connected." : "couldn't connect zoom."}</h1>
  <p>${safeMsg}</p>
  ${safeDetail ? `<p style="opacity: .7">${safeDetail}</p>` : ""}
  <a class="btn" href="/dashboard/" target="_self">return to otto</a>
</div>
<script>
  try { if (window.opener) { window.opener.postMessage({ type: "otto-zoom-${ok ? "connected" : "error"}" }, "*"); window.close(); } } catch {}
</script>
</body>
</html>`;
  return new Response(html, {
    status: ok ? 200 : 400,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c] as string,
  );
}

// GitHub App webhook receiver. We subscribe to installation,
// installation_target, and pull_request events. The handler verifies
// the x-hub-signature-256 HMAC, then dispatches.
http.route({
  path: "/github/webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const secret = process.env.GITHUB_APP_WEBHOOK_SECRET;
    if (!secret) {
      return new Response("github webhook not configured", { status: 503 });
    }

    const raw = await req.text();
    const sig = req.headers.get("x-hub-signature-256");
    const ok = await verifyGithubSignature(secret, raw, sig);
    if (!ok) return new Response("bad signature", { status: 401 });

    const event = req.headers.get("x-github-event") ?? "";
    let body: any;
    try {
      body = JSON.parse(raw);
    } catch {
      return new Response("bad json", { status: 400 });
    }

    if (event === "installation" || event === "installation_target") {
      await ctx.runAction(internal.github.handleInstallationEvent, {
        event,
        payload: body,
      });
    }
    // Other events (pull_request) are accepted (200) but not yet
    // wired — they'll feed into a future "PR opened/merged" timeline.
    return new Response("", { status: 200 });
  }),
});

async function verifyGithubSignature(
  secret: string,
  raw: string,
  header: string | null,
): Promise<boolean> {
  if (!header || !header.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const macBuf = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(raw),
  );
  const hex = [...new Uint8Array(macBuf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return timingSafeEqual(`sha256=${hex}`, header);
}

// Zoom webhook receiver. Two responsibilities:
//   1. Endpoint validation: respond to Zoom's `endpoint.url_validation`
//      challenge with the HMAC-SHA256 of the plainToken using our
//      ZOOM_WEBHOOK_SECRET_TOKEN.
//   2. Real events (e.g. `recording.completed`): verify the
//      x-zm-signature header, then trigger an immediate poll for the
//      team(s) whose integration matches payload.account_id. Polling
//      remains the source of truth — webhook just nudges it earlier.
http.route({
  path: "/zoom/webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const secret = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;
    if (!secret) {
      return new Response("webhook not configured", { status: 503 });
    }

    const raw = await req.text();
    let body: any;
    try {
      body = JSON.parse(raw);
    } catch {
      return new Response("bad json", { status: 400 });
    }

    if (body?.event === "endpoint.url_validation") {
      const plainToken = body?.payload?.plainToken;
      if (typeof plainToken !== "string") {
        return new Response("missing plainToken", { status: 400 });
      }
      const encryptedToken = await hmacSha256Hex(secret, plainToken);
      return new Response(
        JSON.stringify({ plainToken, encryptedToken }),
        { headers: { "content-type": "application/json" } },
      );
    }

    // Verify signature for non-validation events.
    const ts = req.headers.get("x-zm-request-timestamp");
    const sig = req.headers.get("x-zm-signature");
    if (!ts || !sig) {
      return new Response("missing signature", { status: 401 });
    }
    const message = `v0:${ts}:${raw}`;
    const expected = `v0=${await hmacSha256Hex(secret, message)}`;
    if (!timingSafeEqual(expected, sig)) {
      return new Response("bad signature", { status: 401 });
    }

    if (body?.event === "recording.completed") {
      const accountId = body?.payload?.account_id;
      if (typeof accountId === "string" && accountId) {
        const teamIds: string[] = await ctx.runQuery(
          internal.zoomDb.findTeamsByAccountId,
          { accountId },
        );
        for (const teamId of teamIds) {
          await ctx.scheduler.runAfter(0, internal.zoom.pollNewRecordings, {
            teamId: teamId as any,
          });
        }
      }
    }

    return new Response("", { status: 200 });
  }),
});

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const buf = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

http.route({
  path: "/slack/interactions",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const raw = await req.text();
    if (!(await verifySlackSignature(req, raw))) {
      return new Response("unauthorized", { status: 401 });
    }

    const params = new URLSearchParams(raw);
    const payloadStr = params.get("payload");
    if (!payloadStr) return new Response("missing payload", { status: 400 });

    let payload: any;
    try {
      payload = JSON.parse(payloadStr);
    } catch {
      return new Response("bad payload", { status: 400 });
    }

    const action = payload?.actions?.[0];
    if (!action) return new Response("", { status: 200 });

    await ctx.runAction(internal.slack.handleInteraction, {
      actionId: action.action_id,
      actionValue: action.value,
      user: payload.user?.id ?? "unknown",
      channel: payload.channel?.id ?? "",
      messageTs: payload.message?.ts ?? "",
    });

    return new Response("", { status: 200 });
  }),
});

async function verifySlackSignature(
  req: Request,
  rawBody: string,
): Promise<boolean> {
  const signing = process.env.SLACK_SIGNING_SECRET;
  if (!signing) return false;

  const ts = req.headers.get("x-slack-request-timestamp");
  const sig = req.headers.get("x-slack-signature");
  if (!ts || !sig) return false;

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return false;
  if (Math.abs(Date.now() / 1000 - tsNum) > 60 * 5) return false;

  const base = `v0:${ts}:${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signing),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const macBuf = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(base),
  );
  const hex = [...new Uint8Array(macBuf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return timingSafeEqual(`v0=${hex}`, sig);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default http;
