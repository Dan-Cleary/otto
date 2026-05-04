import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { requireTeamAdmin, requireTeamMember } from "./auth";

const KIND = "github" as const;

// Per-team GitHub App installation. Stores the installation_id we get
// back from the GitHub App install callback, plus a cached short-lived
// installation token (renewed via JWT-signed app auth on demand).

export const getInternal = internalQuery({
  args: { teamId: v.id("teams") },
  handler: async (ctx, { teamId }) => {
    return ctx.db
      .query("integrations")
      .withIndex("by_team_kind", (q) =>
        q.eq("teamId", teamId).eq("kind", KIND),
      )
      .first();
  },
});

export const status = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, { teamId }) => {
    await requireTeamMember(ctx, teamId);
    const row = await ctx.db
      .query("integrations")
      .withIndex("by_team_kind", (q) =>
        q.eq("teamId", teamId).eq("kind", KIND),
      )
      .first();
    if (!row) {
      return {
        configured: false,
        installationId: null as number | null,
        accountLogin: null as string | null,
        accountType: null as string | null,
        repoCount: null as number | null,
      };
    }
    const cfg = row.config ?? {};
    return {
      configured: true,
      installationId:
        typeof cfg.installationId === "number" ? cfg.installationId : null,
      accountLogin:
        typeof cfg.accountLogin === "string" ? cfg.accountLogin : null,
      accountType: typeof cfg.accountType === "string" ? cfg.accountType : null,
      repoCount: typeof cfg.repoCount === "number" ? cfg.repoCount : null,
    };
  },
});

export const ensureTeamAdmin = internalQuery({
  args: { teamId: v.id("teams") },
  handler: async (ctx, { teamId }) => {
    await requireTeamAdmin(ctx, teamId);
    return true;
  },
});

export const upsertInstallation = internalMutation({
  args: {
    teamId: v.id("teams"),
    installationId: v.number(),
    accountLogin: v.union(v.string(), v.null()),
    accountType: v.union(v.string(), v.null()),
    repoCount: v.union(v.number(), v.null()),
    actor: v.string(),
  },
  handler: async (
    ctx,
    { teamId, installationId, accountLogin, accountType, repoCount, actor },
  ) => {
    const at = Date.now();
    const existing = await ctx.db
      .query("integrations")
      .withIndex("by_team_kind", (q) =>
        q.eq("teamId", teamId).eq("kind", KIND),
      )
      .first();
    const config = {
      installationId,
      accountLogin: accountLogin ?? null,
      accountType: accountType ?? null,
      repoCount: repoCount ?? null,
    };
    if (existing) {
      await ctx.db.patch(existing._id, {
        config,
        cachedToken: undefined,
        enabled: true,
        updatedAt: at,
        updatedBy: actor,
      });
    } else {
      await ctx.db.insert("integrations", {
        teamId,
        kind: KIND,
        enabled: true,
        config,
        createdAt: at,
        createdBy: actor,
        updatedAt: at,
        updatedBy: actor,
      });
    }
    await ctx.db.insert("auditLog", {
      itemId: null,
      event: "github.app.installed",
      payload: { installationId, accountLogin },
      actor,
      at,
      teamId,
    });
  },
});

export const setCachedToken = internalMutation({
  args: {
    teamId: v.id("teams"),
    token: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, { teamId, token, expiresAt }) => {
    const row = await ctx.db
      .query("integrations")
      .withIndex("by_team_kind", (q) =>
        q.eq("teamId", teamId).eq("kind", KIND),
      )
      .first();
    if (!row) return;
    await ctx.db.patch(row._id, {
      cachedToken: { value: token, expiresAt },
    });
  },
});

// Internal variant called by webhook handler when GitHub tells us the
// app was uninstalled or suspended.
export const removeInternal = internalMutation({
  args: { teamId: v.id("teams") },
  handler: async (ctx, { teamId }) => {
    const existing = await ctx.db
      .query("integrations")
      .withIndex("by_team_kind", (q) =>
        q.eq("teamId", teamId).eq("kind", KIND),
      )
      .first();
    if (existing) await ctx.db.delete(existing._id);
    await ctx.db.insert("auditLog", {
      itemId: null,
      event: "github.app.uninstalled",
      payload: { actor: "github:webhook" },
      actor: "github:webhook",
      at: Date.now(),
      teamId,
    });
  },
});

export const remove = mutation({
  args: { teamId: v.id("teams") },
  handler: async (ctx, { teamId }) => {
    const { email } = await requireTeamAdmin(ctx, teamId);
    const existing = await ctx.db
      .query("integrations")
      .withIndex("by_team_kind", (q) =>
        q.eq("teamId", teamId).eq("kind", KIND),
      )
      .first();
    if (existing) await ctx.db.delete(existing._id);
    await ctx.db.insert("auditLog", {
      itemId: null,
      event: "github.app.uninstalled",
      payload: { actor: email },
      actor: email,
      at: Date.now(),
      teamId,
    });
    return { ok: true };
  },
});

// Look up the team that owns a given GitHub installation. Used by the
// install callback (we get installation_id back from GitHub and need
// to map it via a signed state token to the right team).
export const findTeamByInstallationId = internalQuery({
  args: { installationId: v.number() },
  handler: async (ctx, { installationId }) => {
    const rows = await ctx.db
      .query("integrations")
      .withIndex("by_kind_enabled", (q) =>
        q.eq("kind", KIND).eq("enabled", true),
      )
      .collect();
    return rows.find((r) => r.config?.installationId === installationId)
      ?.teamId ?? null;
  },
});
