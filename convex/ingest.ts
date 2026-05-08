import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

export const recordGranola = internalMutation({
  args: {
    teamId: v.id("teams"),
    sourceRef: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, { teamId, sourceRef, payload }) => {
    const id = await ctx.db.insert("ingestEvents", {
      sourceType: "granola",
      sourceRef,
      payload,
      receivedAt: Date.now(),
      teamId,
    });

    await ctx.db.insert("auditLog", {
      itemId: null,
      event: "ingest.granola",
      payload: { ingestEventId: id, sourceRef },
      actor: "system",
      at: Date.now(),
      teamId,
    });

    await ctx.scheduler.runAfter(0, internal.parser.parse, {
      ingestEventId: id,
    });

    return id;
  },
});

export const recordZoom = internalMutation({
  args: {
    teamId: v.id("teams"),
    sourceRef: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, { teamId, sourceRef, payload }) => {
    const id = await ctx.db.insert("ingestEvents", {
      sourceType: "zoom",
      sourceRef,
      payload,
      receivedAt: Date.now(),
      teamId,
    });

    await ctx.db.insert("auditLog", {
      itemId: null,
      event: "ingest.zoom",
      payload: { ingestEventId: id, sourceRef },
      actor: "system",
      at: Date.now(),
      teamId,
    });

    await ctx.scheduler.runAfter(0, internal.parser.parse, {
      ingestEventId: id,
    });

    return id;
  },
});

export const recordWidget = internalMutation({
  args: {
    teamId: v.id("teams"),
    sourceRef: v.string(),
    payload: v.any(),
    // Optional — set when the widget snippet declared `data-project`.
    // The HTTP route already validated ownership against the team, so
    // we trust it here.
    projectId: v.optional(v.id("projects")),
  },
  handler: async (ctx, { teamId, sourceRef, payload, projectId }) => {
    const id = await ctx.db.insert("ingestEvents", {
      sourceType: "widget",
      sourceRef,
      payload,
      receivedAt: Date.now(),
      teamId,
      projectId,
    });

    await ctx.db.insert("auditLog", {
      itemId: null,
      event: "ingest.widget",
      payload: { ingestEventId: id, sourceRef },
      actor: "system",
      at: Date.now(),
      teamId,
    });

    await ctx.scheduler.runAfter(0, internal.parser.parse, {
      ingestEventId: id,
    });

    return id;
  },
});

// Used by the widget HTTP route to confirm a posted projectId belongs
// to the team that owns the secret. If the project was deleted or
// belongs to a different team, the route ignores the field and falls
// back to URL-pattern routing.
export const verifyProjectInTeam = internalQuery({
  args: { teamId: v.id("teams"), projectId: v.id("projects") },
  handler: async (ctx, { teamId, projectId }) => {
    const p = await ctx.db.get(projectId);
    return p && p.teamId === teamId ? true : false;
  },
});

// Used by the public widget HTTP route to map a posted secret to a
// team. Per-team widget secrets live in `settings` under the
// "widget.secret" key. We deliberately scan rather than index by
// secret — the table is small and we don't want secret values used
// as index keys (they'd appear in any error path that leaks index
// metadata).
export const findTeamByWidgetSecret = internalQuery({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    if (!secret) return null;
    const rows = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "widget.secret"))
      .collect();
    for (const row of rows) {
      if (row.value === secret && row.teamId) {
        return { teamId: row.teamId };
      }
    }
    return null;
  },
});

