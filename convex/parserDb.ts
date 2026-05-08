import { internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { resolveProjectFromUrl } from "./projects";

export const getIngestEvent = internalQuery({
  args: { id: v.id("ingestEvents") },
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const persistItems = internalMutation({
  args: {
    ingestEventId: v.id("ingestEvents"),
    teamId: v.id("teams"),
    sourceType: v.union(
      v.literal("widget"),
      v.literal("granola"),
      v.literal("zoom"),
    ),
    sourceRef: v.string(),
    widgetUrl: v.union(v.string(), v.null()),
    items: v.array(
      v.object({
        description: v.string(),
        quotedContext: v.string(),
        repoCandidate: v.union(v.string(), v.null()),
        surfacedInUserNotes: v.optional(v.boolean()),
        confidence: v.number(),
      }),
    ),
  },
  handler: async (
    ctx,
    { ingestEventId, teamId, sourceType, sourceRef, widgetUrl, items },
  ) => {
    let project: { projectId: any; primaryRepoId: any } | null = null;
    let routedBy: "snippet" | "url-pattern" | "router" = "router";

    if (sourceType === "widget") {
      // Prefer the `data-project` declared on the widget snippet — it's
      // already team-validated at the HTTP route. Fall back to URL
      // pattern matching only when the snippet didn't declare one.
      const ev = await ctx.db.get(ingestEventId);
      if (ev?.projectId) {
        const p = await ctx.db.get(ev.projectId);
        if (p && p.teamId === teamId) {
          project = { projectId: p._id, primaryRepoId: p.primaryRepoId };
          routedBy = "snippet";
        }
      }
      if (!project && widgetUrl) {
        project = await resolveProjectFromUrl(ctx, teamId, widgetUrl);
        if (project) routedBy = "url-pattern";
      }
    }

    for (const it of items) {
      const itemId = await ctx.db.insert("items", {
        ingestEventId,
        sourceType,
        sourceRef,
        description: it.description,
        quotedContext: it.quotedContext,
        repoCandidate: it.repoCandidate,
        repoId: project?.primaryRepoId ?? null,
        parserConfidence: it.confidence,
        routerConfidence: project?.primaryRepoId ? 0.95 : null,
        surfacedInUserNotes: it.surfacedInUserNotes,
        status: "parsed",
        createdAt: Date.now(),
        projectId: project?.projectId ?? null,
        teamId,
      });

      await ctx.db.insert("auditLog", {
        itemId,
        event: "parser.item",
        payload: {
          description: it.description,
          confidence: it.confidence,
          routedBy: project ? routedBy : "router",
          projectId: project?.projectId ?? null,
        },
        actor: "system",
        at: Date.now(),
        teamId,
      });

      if (project?.primaryRepoId) {
        await ctx.scheduler.runAfter(0, internal.router.gate, { itemId });
      } else {
        await ctx.scheduler.runAfter(0, internal.router.route, { itemId });
      }
    }
  },
});
