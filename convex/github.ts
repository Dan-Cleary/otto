"use node";

import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireAuthAction } from "./auth";
import { createSign, createHmac, timingSafeEqual } from "node:crypto";

// Otto's GitHub App. One app, many per-team installations. Each
// install gives us an installation_id that we exchange (via JWT-signed
// app auth) for short-lived installation tokens used to call the
// GitHub REST API as the bot.
//
// Flow:
//   1. UI: action getInstallUrl(teamId) → returns
//        https://github.com/apps/<slug>/installations/new?state=<signed>
//   2. User picks repos on GitHub, clicks Install
//   3. GitHub redirects to Setup URL:
//        https://ottoagent.app/dashboard/?gh=installed&installation_id=…&setup_action=install&state=…
//   4. UI: action completeInstall({state, installationId}) verifies state
//      and persists installation_id under the team
//
// Env vars required on the convex deployment:
//   GITHUB_APP_ID                — numeric app id from github.com/settings/apps/<slug>
//   GITHUB_APP_CLIENT_ID         — OAuth-style client id
//   GITHUB_APP_CLIENT_SECRET     — OAuth-style client secret (only used for user-auth flows; app auth uses the private key)
//   GITHUB_APP_PRIVATE_KEY       — full PEM (BEGIN RSA PRIVATE KEY … END RSA PRIVATE KEY)
//   GITHUB_APP_SLUG              — app slug, e.g. otto-agent-app, used to build the install url
//   GITHUB_APP_WEBHOOK_SECRET    — secret token used to verify x-hub-signature-256 headers
//   OAUTH_STATE_SECRET           — already used by zoom; reused here for state HMAC

const STATE_SECRET_KEY = "OAUTH_STATE_SECRET" as const;

export const getInstallUrl = action({
  args: { teamId: v.id("teams"), returnTo: v.optional(v.string()) },
  handler: async (ctx, { teamId, returnTo }): Promise<{ url: string } | { error: string }> => {
    await requireAuthAction(ctx);
    await ctx.runQuery(internal.githubDb.ensureTeamAdmin, { teamId });

    const slug = process.env.GITHUB_APP_SLUG;
    if (!slug) return { error: "GITHUB_APP_SLUG not set" };

    const state = signState({
      teamId: String(teamId),
      returnTo: returnTo ?? "",
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    const url = new URL(`https://github.com/apps/${slug}/installations/new`);
    url.searchParams.set("state", state);
    return { url: url.toString() };
  },
});

export const completeInstall = action({
  args: { state: v.string(), installationId: v.number() },
  handler: async (
    ctx,
    { state, installationId },
  ): Promise<{ ok: boolean; error?: string }> => {
    const { email } = await requireAuthAction(ctx);
    const verified = verifyState(state);
    if (!verified) return { ok: false, error: "invalid or expired state" };

    // Sanity-fetch the installation so we capture account metadata and
    // confirm the installation actually exists for our app.
    const meta = await fetchInstallation(installationId);
    if ("error" in meta) return { ok: false, error: meta.error };

    await ctx.runMutation(internal.githubDb.upsertInstallation, {
      teamId: verified.teamId as any,
      installationId,
      accountLogin: meta.accountLogin,
      accountType: meta.accountType,
      repoCount: meta.repoCount,
      actor: email,
    });

    return { ok: true };
  },
});

export const uninstall = action({
  args: { teamId: v.id("teams") },
  handler: async (ctx, { teamId }): Promise<{ ok: true }> => {
    await ctx.runMutation(internal.githubDb.removeInternal, { teamId });
    return { ok: true };
  },
});

// ── Webhook signature verification (called from HTTP route) ──────

export function verifyWebhookSignature(secret: string, body: string, header: string | null): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  const mac = createHmac("sha256", secret).update(body).digest("hex");
  const expected = `sha256=${mac}`;
  if (expected.length !== header.length) return false;
  return timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(header),
  );
}

// ── Internal helpers used by repos.ts / cursor.ts to call the GitHub REST API as the bot ──

// Returns a valid installation token for this team's installation,
// minting (or refreshing from cache) on demand.
export const getInstallToken = internalAction({
  args: { teamId: v.id("teams") },
  handler: async (ctx, { teamId }): Promise<{ value: string } | { error: string }> => {
    const integ: any = await ctx.runQuery(internal.githubDb.getInternal, {
      teamId,
    });
    if (!integ?.config?.installationId) {
      return { error: "no github app installation for this team" };
    }
    const installationId = integ.config.installationId as number;

    // Cache hit (60s skew).
    const cached = integ.cachedToken;
    if (
      cached?.value &&
      typeof cached.expiresAt === "number" &&
      cached.expiresAt - 60_000 > Date.now()
    ) {
      return { value: cached.value };
    }

    const token = await mintInstallationToken(installationId);
    if ("error" in token) return token;

    await ctx.runMutation(internal.githubDb.setCachedToken, {
      teamId,
      token: token.value,
      expiresAt: token.expiresAt,
    });
    return { value: token.value };
  },
});

// ── Lower-level GitHub helpers ───────────────────────────────────

async function fetchInstallation(installationId: number): Promise<
  | {
      accountLogin: string | null;
      accountType: string | null;
      repoCount: number | null;
    }
  | { error: string }
> {
  const jwt = signAppJwt();
  if ("error" in jwt) return jwt;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(
      `https://api.github.com/app/installations/${installationId}`,
      {
        headers: {
          Authorization: `Bearer ${jwt.value}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "otto",
        },
        signal: ctrl.signal,
      },
    );
    if (!res.ok) {
      return { error: `github /app/installations: ${res.status}` };
    }
    const body: any = await res.json();
    return {
      accountLogin: body?.account?.login ?? null,
      accountType: body?.account?.type ?? null,
      repoCount:
        typeof body?.repository_selection === "string" &&
        body.repository_selection === "all"
          ? null
          : (typeof body?.repository_selection === "string"
              ? body?.repositories?.length ?? null
              : null),
    };
  } catch (err) {
    return { error: `github /app/installations: ${(err as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
}

async function mintInstallationToken(installationId: number): Promise<
  { value: string; expiresAt: number } | { error: string }
> {
  const jwt = signAppJwt();
  if ("error" in jwt) return jwt;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt.value}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "otto",
        },
        signal: ctrl.signal,
      },
    );
    if (!res.ok) {
      return { error: `github access_tokens: ${res.status}` };
    }
    const body: any = await res.json();
    if (typeof body?.token !== "string") {
      return { error: "github access_tokens: missing token in response" };
    }
    const expiresAt = body.expires_at
      ? Date.parse(body.expires_at)
      : Date.now() + 50 * 60 * 1000;
    return { value: body.token, expiresAt };
  } catch (err) {
    return { error: `github access_tokens: ${(err as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
}

function signAppJwt(): { value: string } | { error: string } {
  const appId = process.env.GITHUB_APP_ID;
  const pem = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!appId) return { error: "GITHUB_APP_ID not set" };
  if (!pem) return { error: "GITHUB_APP_PRIVATE_KEY not set" };

  // GitHub allows iat to be slightly in the past to compensate for
  // clock drift; expiry must be ≤10 minutes from iat.
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = { iat: now - 30, exp: now + 9 * 60, iss: appId };
  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;
  try {
    const signer = createSign("RSA-SHA256");
    signer.update(signingInput);
    const sig = signer.sign(pem);
    const sigB64 = sig
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    return { value: `${signingInput}.${sigB64}` };
  } catch (err) {
    return { error: `jwt sign failed: ${(err as Error).message}` };
  }
}

function base64url(s: string): string {
  return Buffer.from(s)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

// State token: HMAC-signed JSON, identical scheme to convex/zoom.ts.
type State = { teamId: string; returnTo: string; expiresAt: number };

function signState(state: State): string {
  const secret = requireStateSecret();
  const json = JSON.stringify(state);
  const b64 = base64url(json);
  const mac = createHmac("sha256", secret).update(b64).digest("hex");
  return `${b64}.${mac}`;
}

export function verifyState(token: string): State | null {
  const secret = process.env[STATE_SECRET_KEY];
  if (!secret) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const b64 = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(b64).digest("hex");
  if (expected.length !== mac.length) return null;
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(mac))) return null;
  let parsed: State;
  try {
    parsed = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    return null;
  }
  if (parsed.expiresAt < Date.now()) return null;
  return parsed;
}

function requireStateSecret(): string {
  const v = process.env[STATE_SECRET_KEY];
  if (!v) {
    throw new Error(`${STATE_SECRET_KEY} is not configured on this deployment`);
  }
  return v;
}

// Used by the webhook handler for installation/uninstallation events.
export const handleInstallationEvent = internalAction({
  args: { event: v.string(), payload: v.any() },
  handler: async (ctx, { event, payload }) => {
    const action_ = payload?.action;
    const installationId = payload?.installation?.id;
    if (typeof installationId !== "number") return;

    if (event === "installation" && (action_ === "deleted" || action_ === "suspend")) {
      // Find the team by installation id and disable.
      const teamId = await ctx.runQuery(
        internal.githubDb.findTeamByInstallationId,
        { installationId },
      );
      if (teamId) {
        await ctx.runMutation(internal.githubDb.removeInternal, { teamId });
      }
    }
  },
});
