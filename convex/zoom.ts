import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireAdminAction } from "./auth";

// Zoom Server-to-Server OAuth integration. Customer drops three
// credentials (Account ID, Client ID, Client Secret) once; Otto
// exchanges them for short-lived access tokens, lists recent cloud
// recordings org-wide, fetches the auto-generated transcripts, and
// feeds them into the same parser as Granola/widget.
//
// References:
//   POST https://zoom.us/oauth/token?grant_type=account_credentials&account_id=…
//   GET  /v2/users (list users in the account)
//   GET  /v2/users/{userId}/recordings?from=YYYY-MM-DD&to=YYYY-MM-DD
//   GET  the recording_files[].download_url with the access token

const ZOOM_OAUTH_TOKEN = "https://zoom.us/oauth/token";
const ZOOM_OAUTH_AUTHORIZE = "https://zoom.us/oauth/authorize";
const ZOOM_API = "https://api.zoom.us/v2";

// Backwards-compat alias for the S2S code paths below.
const ZOOM_OAUTH = ZOOM_OAUTH_TOKEN;

// Cron entry point — fan out to every team that has Zoom enabled.
export const pollAll = internalAction({
  args: {},
  handler: async (ctx) => {
    const teamIds: string[] = await ctx.runQuery(
      internal.zoomDb.teamsToPoll,
      {},
    );
    for (const teamId of teamIds) {
      await ctx.scheduler.runAfter(0, internal.zoom.pollNewRecordings, {
        teamId: teamId as any,
      });
    }
  },
});

export const pollNewRecordings = internalAction({
  args: { teamId: v.id("teams") },
  handler: async (ctx, { teamId }) => {
    const integ: any = await ctx.runQuery(internal.zoomDb.getInternal, {
      teamId,
    });
    if (!integ || !integ.enabled || !integ.config) {
      await ctx.runMutation(internal.zoomDb.recordPoll, {
        teamId,
        ok: false,
        ingested: 0,
        error: "no zoom credentials configured",
      });
      return;
    }

    const token = await getValidToken(ctx, teamId, integ);
    if ("error" in token) {
      await ctx.runMutation(internal.zoomDb.recordPoll, {
        teamId,
        ok: false,
        ingested: 0,
        error: token.error,
      });
      return;
    }

    // Cursor: highest `start_time` we've ingested for this team. On
    // first run, start 7 days back so the first poll has something
    // to work with but doesn't drown us.
    const since: number =
      typeof integ.cursor?.sinceMs === "number"
        ? integ.cursor.sinceMs
        : Date.now() - 7 * 24 * 60 * 60 * 1000;
    const fromDate = new Date(since).toISOString().slice(0, 10);
    const toDate = new Date().toISOString().slice(0, 10);

    let users: { id: string; email: string }[];
    try {
      users = await listUsers(token.value);
    } catch (err) {
      await ctx.runMutation(internal.zoomDb.recordPoll, {
        teamId,
        ok: false,
        ingested: 0,
        error: `list users: ${(err as Error).message}`,
      });
      return;
    }

    let ingested = 0;
    let maxStart = since;

    for (const user of users) {
      let meetings: any[];
      try {
        meetings = await listRecordings(
          token.value,
          user.id,
          fromDate,
          toDate,
        );
      } catch (err) {
        // Skip user on error rather than failing the whole poll.
        continue;
      }

      for (const m of meetings) {
        const startMs = Date.parse(m.start_time ?? "");
        if (!Number.isFinite(startMs)) continue;
        if (startMs <= since) continue;
        if (startMs > maxStart) maxStart = startMs;

        const transcriptFile = (m.recording_files ?? []).find(
          (f: any) => f.file_type === "TRANSCRIPT",
        );
        if (!transcriptFile?.download_url) continue;

        let transcript: string;
        try {
          transcript = await downloadTranscript(
            transcriptFile.download_url,
            token.value,
          );
        } catch {
          continue;
        }

        const sourceRef = `zoom:${m.uuid ?? m.id}`;
        await ctx.runMutation(internal.ingest.recordZoom, {
          teamId,
          sourceRef,
          payload: {
            topic: m.topic,
            startedAt: m.start_time,
            durationMin: m.duration,
            hostEmail: user.email,
            meetingId: m.id,
            uuid: m.uuid,
            transcript: vttToText(transcript),
          },
        });
        ingested++;
      }
    }

    await ctx.runMutation(internal.zoomDb.recordPoll, {
      teamId,
      ok: true,
      ingested,
      nextCursor: { sinceMs: maxStart },
    });
  },
});

// ── Public actions called from the admin UI ─────────────────────

export const saveCreds = action({
  args: {
    teamId: v.id("teams"),
    accountId: v.string(),
    clientId: v.string(),
    clientSecret: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: boolean; error?: string }> => {
    const { email } = await requireAdminAction(ctx);
    await ctx.runQuery(internal.zoomDb.ensureTeamAdmin, {
      teamId: args.teamId,
    });

    const accountId = args.accountId.trim();
    const clientId = args.clientId.trim();
    const clientSecret = args.clientSecret.trim();
    if (!accountId || !clientId || !clientSecret) {
      return { ok: false, error: "all three fields are required" };
    }

    // Validate by exchanging for a token before persisting.
    const tok = await fetchToken({ accountId, clientId, clientSecret });
    if ("error" in tok) {
      return { ok: false, error: tok.error };
    }

    await ctx.runMutation(internal.zoomDb.upsertCreds, {
      teamId: args.teamId,
      actor: email,
      accountId,
      clientId,
      clientSecret,
    });
    await ctx.runMutation(internal.zoomDb.setCachedToken, {
      teamId: args.teamId,
      token: tok.value,
      expiresAt: tok.expiresAt,
    });

    // Fire an immediate poll so the user gets feedback within seconds
    // rather than waiting for the cron tick.
    await ctx.scheduler.runAfter(0, internal.zoom.pollNewRecordings, {
      teamId: args.teamId,
    });

    return { ok: true };
  },
});

// ── Otto-published OAuth flow ───────────────────────────────────
//
// Customer clicks "Connect Zoom" in Otto's UI. We generate a Zoom
// authorize URL signed with a state token (so the callback can prove
// which team initiated the flow). User consents on Zoom's screen,
// Zoom redirects to our /auth/zoom/callback, we exchange the code
// for tokens, and persist them in the integration row.
//
// This requires Otto's operator to register ONE Zoom Marketplace app
// and set ZOOM_OAUTH_CLIENT_ID + ZOOM_OAUTH_CLIENT_SECRET in convex
// env. Customers themselves never see Zoom credentials.

export const getOAuthConnectUrl = action({
  args: { teamId: v.id("teams"), returnTo: v.optional(v.string()) },
  handler: async (
    ctx,
    { teamId, returnTo },
  ): Promise<{ url: string } | { error: string }> => {
    await requireAdminAction(ctx);
    await ctx.runQuery(internal.zoomDb.ensureTeamAdmin, { teamId });

    const clientId = process.env.ZOOM_OAUTH_CLIENT_ID;
    const redirectUri = process.env.ZOOM_OAUTH_REDIRECT_URI;
    const stateSecret = process.env[STATE_SECRET_KEY];
    if (!clientId || !redirectUri || !stateSecret) {
      return {
        error:
          "Otto's Zoom OAuth app isn't configured. Operator: set ZOOM_OAUTH_CLIENT_ID + ZOOM_OAUTH_REDIRECT_URI + OAUTH_STATE_SECRET in convex env.",
      };
    }

    const state = await signState({
      teamId: String(teamId),
      returnTo: returnTo ?? "",
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    const url = new URL(ZOOM_OAUTH_AUTHORIZE);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    // Zoom doesn't require `scope` on authorize for OAuth apps —
    // scopes are baked into the app definition. Including it would
    // 400.
    return { url: url.toString() };
  },
});

// Internal: called by the HTTP callback after a successful code
// exchange to persist tokens.
export const completeOAuthInternal = internalAction({
  args: {
    teamId: v.id("teams"),
    code: v.string(),
  },
  handler: async (ctx, { teamId, code }) => {
    const clientId = process.env.ZOOM_OAUTH_CLIENT_ID;
    const clientSecret = process.env.ZOOM_OAUTH_CLIENT_SECRET;
    const redirectUri = process.env.ZOOM_OAUTH_REDIRECT_URI;
    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error("Otto OAuth app env vars missing");
    }

    const tokens = await exchangeCode(
      code,
      clientId,
      clientSecret,
      redirectUri,
    );
    if ("error" in tokens) throw new Error(tokens.error);

    // Probe /users/me so we can show "connected as <email>" in the UI
    // and capture account_id so webhooks can route back to this team.
    let accountEmail: string | null = null;
    let accountName: string | null = null;
    let accountId: string | null = null;
    try {
      const meRes = await fetch(`${ZOOM_API}/users/me`, {
        headers: { authorization: `Bearer ${tokens.accessToken}` },
      });
      if (meRes.ok) {
        const me = (await meRes.json()) as {
          email?: string;
          first_name?: string;
          last_name?: string;
          account_id?: string;
        };
        accountEmail = me.email ?? null;
        accountName =
          [me.first_name, me.last_name].filter(Boolean).join(" ") || null;
        accountId = me.account_id ?? null;
      }
    } catch {
      // Non-fatal — connection still works without the display label.
    }

    await ctx.runMutation(internal.zoomDb.upsertOAuthTokens, {
      teamId,
      tokens,
      accountEmail,
      accountName,
      accountId,
    });

    // Kick off the first poll right away so the user gets feedback
    // within seconds.
    await ctx.scheduler.runAfter(0, internal.zoom.pollNewRecordings, {
      teamId,
    });
  },
});

export const clearCreds = action({
  args: { teamId: v.id("teams") },
  handler: async (ctx, { teamId }): Promise<{ ok: true }> => {
    const { email } = await requireAdminAction(ctx);
    await ctx.runQuery(internal.zoomDb.ensureTeamAdmin, { teamId });
    await ctx.runMutation(internal.zoomDb.remove, { teamId, actor: email });
    return { ok: true };
  },
});

// ── Helpers ─────────────────────────────────────────────────────

// Returns a valid bearer token for whatever auth method this team's
// integration was set up with — Server-to-Server OAuth or the
// Otto-published OAuth flow. Refreshes if needed.
async function getValidToken(
  ctx: any,
  teamId: any,
  integ: any,
): Promise<{ value: string } | { error: string }> {
  const config = integ?.config ?? {};
  const authType = config.authType ?? "s2s";
  const skewMs = 60_000;

  if (authType === "oauth") {
    const expiresAt = Number(config.expiresAt ?? 0);
    if (config.accessToken && expiresAt - skewMs > Date.now()) {
      return { value: config.accessToken };
    }
    if (!config.refreshToken) {
      return { error: "oauth: no refresh token (please reconnect zoom)" };
    }
    const clientId = process.env.ZOOM_OAUTH_CLIENT_ID;
    const clientSecret = process.env.ZOOM_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return { error: "oauth: Otto's app env vars are missing" };
    }
    const refreshed = await refreshOAuth(
      config.refreshToken,
      clientId,
      clientSecret,
    );
    if ("error" in refreshed) return refreshed;
    await ctx.runMutation(internal.zoomDb.upsertOAuthTokens, {
      teamId,
      tokens: refreshed,
      accountEmail: config.accountEmail ?? null,
      accountName: config.accountName ?? null,
      accountId: config.accountId ?? null,
    });
    return { value: refreshed.accessToken };
  }

  // S2S path — uses cached short-lived token.
  const cached = integ?.cachedToken ?? {};
  if (
    cached.value &&
    typeof cached.expiresAt === "number" &&
    cached.expiresAt - skewMs > Date.now()
  ) {
    return { value: cached.value };
  }
  if (!config.accountId || !config.clientId || !config.clientSecret) {
    return { error: "s2s: missing credentials" };
  }
  const tok = await fetchToken({
    accountId: config.accountId,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  });
  if ("error" in tok) return tok;
  await ctx.runMutation(internal.zoomDb.setCachedToken, {
    teamId,
    token: tok.value,
    expiresAt: tok.expiresAt,
  });
  return { value: tok.value };
}

// ── OAuth helpers ───────────────────────────────────────────────

type OAuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
};

async function exchangeCode(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<OAuthTokens | { error: string }> {
  const url = new URL(ZOOM_OAUTH_TOKEN);
  url.searchParams.set("grant_type", "authorization_code");
  url.searchParams.set("code", code);
  url.searchParams.set("redirect_uri", redirectUri);
  const basic = btoa(`${clientId}:${clientSecret}`);
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: "POST",
      headers: { authorization: `Basic ${basic}` },
    });
  } catch (err) {
    return { error: `network: ${(err as Error).message}` };
  }
  if (!res.ok) return { error: `code exchange http ${res.status}` };
  let body: any;
  try {
    body = await res.json();
  } catch {
    return { error: "code exchange: bad json" };
  }
  if (typeof body.access_token !== "string")
    return { error: "code exchange: missing access_token" };
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? "",
    scope: body.scope ?? "",
    expiresAt:
      Date.now() +
      (typeof body.expires_in === "number" ? body.expires_in : 3500) * 1000,
  };
}

async function refreshOAuth(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<OAuthTokens | { error: string }> {
  const url = new URL(ZOOM_OAUTH_TOKEN);
  url.searchParams.set("grant_type", "refresh_token");
  url.searchParams.set("refresh_token", refreshToken);
  const basic = btoa(`${clientId}:${clientSecret}`);
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: "POST",
      headers: { authorization: `Basic ${basic}` },
    });
  } catch (err) {
    return { error: `refresh network: ${(err as Error).message}` };
  }
  if (!res.ok) return { error: `refresh http ${res.status}` };
  let body: any;
  try {
    body = await res.json();
  } catch {
    return { error: "refresh: bad json" };
  }
  if (typeof body.access_token !== "string")
    return { error: "refresh: missing access_token" };
  return {
    accessToken: body.access_token,
    // Zoom rotates the refresh token on each refresh — must save the
    // new one or the next refresh will 401.
    refreshToken: body.refresh_token ?? refreshToken,
    scope: body.scope ?? "",
    expiresAt:
      Date.now() +
      (typeof body.expires_in === "number" ? body.expires_in : 3500) * 1000,
  };
}

// ── State signing for OAuth flow ────────────────────────────────
//
// The state param Zoom round-trips back to our callback. We sign it
// with HMAC-SHA256 so the callback can prove the redirect originated
// from us (CSRF-safe), without persisting state rows in the DB.

const STATE_SECRET_KEY = "OAUTH_STATE_SECRET";

async function getStateKey(): Promise<CryptoKey> {
  const secret = process.env[STATE_SECRET_KEY];
  if (!secret) {
    throw new Error(`${STATE_SECRET_KEY} env var is required`);
  }
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signState(payload: object): Promise<string> {
  const json = JSON.stringify(payload);
  const b64 = b64url(new TextEncoder().encode(json));
  const key = await getStateKey();
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(b64),
  );
  return `${b64}.${b64url(new Uint8Array(sig))}`;
}

export async function verifyState(
  state: string,
): Promise<
  | { teamId: string; returnTo: string; expiresAt: number }
  | null
> {
  const [b64, sig] = state.split(".");
  if (!b64 || !sig) return null;
  let key: CryptoKey;
  try {
    key = await getStateKey();
  } catch {
    return null;
  }
  const sigBytes = fromB64url(sig);
  // Copy into a fresh ArrayBuffer so the type system is happy (Uint8Array
  // backed by SharedArrayBuffer would fail BufferSource).
  const sigBuf = new ArrayBuffer(sigBytes.byteLength);
  new Uint8Array(sigBuf).set(sigBytes);
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    sigBuf,
    new TextEncoder().encode(b64),
  );
  if (!ok) return null;
  let payload: any;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromB64url(b64)));
  } catch {
    return null;
  }
  if (
    typeof payload?.teamId !== "string" ||
    typeof payload?.expiresAt !== "number" ||
    payload.expiresAt < Date.now()
  ) {
    return null;
  }
  return {
    teamId: payload.teamId,
    returnTo: typeof payload.returnTo === "string" ? payload.returnTo : "",
    expiresAt: payload.expiresAt,
  };
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice(((s.length % 4) + 3) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function fetchToken(creds: {
  accountId: string;
  clientId: string;
  clientSecret: string;
}): Promise<{ value: string; expiresAt: number } | { error: string }> {
  const url =
    `${ZOOM_OAUTH}?grant_type=account_credentials&account_id=` +
    encodeURIComponent(creds.accountId);
  const basic = btoa(`${creds.clientId}:${creds.clientSecret}`);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Basic ${basic}` },
    });
  } catch (err) {
    return { error: `network: ${(err as Error).message}` };
  }
  if (res.status === 401) return { error: "zoom rejected the credentials" };
  if (!res.ok) return { error: `zoom oauth http ${res.status}` };
  let body: any;
  try {
    body = await res.json();
  } catch {
    return { error: "zoom oauth: bad json" };
  }
  if (typeof body.access_token !== "string")
    return { error: "zoom oauth: missing access_token" };
  const expiresIn =
    typeof body.expires_in === "number" ? body.expires_in : 3500;
  return {
    value: body.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

async function listUsers(
  token: string,
): Promise<{ id: string; email: string }[]> {
  // Single page is enough for almost all dev/SMB accounts; can paginate
  // later if a customer hits the cap.
  const res = await fetch(`${ZOOM_API}/users?page_size=300&status=active`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`http ${res.status}`);
  const body = (await res.json()) as { users?: { id: string; email: string }[] };
  return body.users ?? [];
}

async function listRecordings(
  token: string,
  userId: string,
  from: string,
  to: string,
): Promise<any[]> {
  const url = `${ZOOM_API}/users/${encodeURIComponent(userId)}/recordings?from=${from}&to=${to}&page_size=100`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`http ${res.status}`);
  const body = (await res.json()) as { meetings?: any[] };
  return body.meetings ?? [];
}

async function downloadTranscript(
  url: string,
  token: string,
): Promise<string> {
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`transcript http ${res.status}`);
  return res.text();
}

// VTT → plain text. Strip the WEBVTT header, timestamps, and cue
// identifiers; keep speaker tags ("Dan: …") and the spoken lines.
export function vttToText(vtt: string): string {
  const lines = vtt.split(/\r?\n/);
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line === "WEBVTT") continue;
    // skip timestamp lines like "00:00:01.500 --> 00:00:04.230"
    if (/^\d{2}:\d{2}:\d{2}/.test(line) && line.includes("-->")) continue;
    // skip pure-numeric cue ids
    if (/^\d+$/.test(line)) continue;
    // skip cue settings lines that may follow timestamps
    if (line.startsWith("NOTE")) continue;
    out.push(line);
  }
  return out.join("\n");
}
