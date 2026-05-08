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

// Used by the public widget HTTP route to map a posted secret to a
// project (and therefore the owning team). Each project has its own
// secret on the `projects` table; we deliberately scan rather than
// index by secret to avoid secret values appearing in any error path
// that leaks index metadata.
export const findProjectByWidgetSecret = internalQuery({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    if (!secret) return null;
    const projects = await ctx.db.query("projects").collect();
    for (const p of projects) {
      if (p.widgetSecret === secret && p.teamId && p.enabled) {
        return { teamId: p.teamId, projectId: p._id };
      }
    }
    return null;
  },
});

