import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  ensureTeamForUser,
  requireAuth,
  requireTeamAdmin,
  requireTeamMember,
} from "./auth";

// ── Bootstrap & list ────────────────────────────────────────────

// Called by the admin app right after sign-in. Idempotent: if the
// user already has a team, returns its id; otherwise creates a
// personal team (or claims the legacy data set if they're the first
// user in the deployment).
export const bootstrap = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId, email } = await requireAuth(ctx);
    const teamId = await ensureTeamForUser(ctx, userId, email);
    return { teamId };
  },
});

// All teams the current user belongs to, with role.
export const myTeams = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);
    const memberships = await ctx.db
      .query("teamMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const teams = await Promise.all(
      memberships.map(async (m) => {
        const team = await ctx.db.get(m.teamId);
        return team ? { ...team, role: m.role } : null;
      }),
    );
    return teams.filter((t): t is NonNullable<typeof t> => t !== null);
  },
});

// ── Create / rename / delete ────────────────────────────────────

export const create = mutation({
  args: { name: v.string(), slug: v.optional(v.string()) },
  handler: async (ctx, { name, slug }) => {
    const { userId, email } = await requireAuth(ctx);
    const cleaned = (slug || name)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-");
    let final = cleaned;
    let n = 1;
    while (
      await ctx.db
        .query("teams")
        .withIndex("by_slug", (q) => q.eq("slug", final))
        .first()
    ) {
      n += 1;
      final = `${cleaned}-${n}`;
    }
    const teamId = await ctx.db.insert("teams", {
      name,
      slug: final,
      createdAt: Date.now(),
      createdBy: email,
    });
    await ctx.db.insert("teamMembers", {
      teamId,
      userId,
      email,
      role: "admin",
      joinedAt: Date.now(),
    });
    return teamId;
  },
});

export const rename = mutation({
  args: { teamId: v.id("teams"), name: v.string() },
  handler: async (ctx, { teamId, name }) => {
    await requireTeamAdmin(ctx, teamId);
    await ctx.db.patch(teamId, { name });
  },
});

// ── Members ─────────────────────────────────────────────────────

export const members = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, { teamId }) => {
    await requireTeamMember(ctx, teamId);
    return ctx.db
      .query("teamMembers")
      .withIndex("by_team", (q) => q.eq("teamId", teamId))
      .collect();
  },
});

export const removeMember = mutation({
  args: { teamId: v.id("teams"), memberId: v.id("teamMembers") },
  handler: async (ctx, { teamId, memberId }) => {
    const me = await requireTeamAdmin(ctx, teamId);
    const target = await ctx.db.get(memberId);
    if (!target || target.teamId !== teamId) throw new Error("not found");

    // Prevent removing the last admin.
    if (target.role === "admin") {
      const admins = await ctx.db
        .query("teamMembers")
        .withIndex("by_team", (q) => q.eq("teamId", teamId))
        .filter((q) => q.eq(q.field("role"), "admin"))
        .collect();
      if (admins.length <= 1) throw new Error("can't remove the last admin");
    }

    // Self-remove is fine; admin-removing-other is fine.
    if (target.userId !== me.userId && me.role !== "admin")
      throw new Error("admin role required");

    await ctx.db.delete(memberId);
  },
});

export const setRole = mutation({
  args: {
    teamId: v.id("teams"),
    memberId: v.id("teamMembers"),
    role: v.union(v.literal("admin"), v.literal("member")),
  },
  handler: async (ctx, { teamId, memberId, role }) => {
    await requireTeamAdmin(ctx, teamId);
    const target = await ctx.db.get(memberId);
    if (!target || target.teamId !== teamId) throw new Error("not found");

    if (target.role === "admin" && role !== "admin") {
      const admins = await ctx.db
        .query("teamMembers")
        .withIndex("by_team", (q) => q.eq("teamId", teamId))
        .filter((q) => q.eq(q.field("role"), "admin"))
        .collect();
      if (admins.length <= 1) throw new Error("can't demote the last admin");
    }
    await ctx.db.patch(memberId, { role });
  },
});

// ── Widget secret ───────────────────────────────────────────────
//
// Each team gets its own shared secret for the embedded feedback
// widget. Stored in `settings` under (teamId, "widget.secret"); the
// HTTP route in convex/http.ts maps an inbound secret back to a team.

const WIDGET_SECRET_KEY = "widget.secret";

export const widgetSecret = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, { teamId }) => {
    await requireTeamAdmin(ctx, teamId);
    const row = await ctx.db
      .query("settings")
      .withIndex("by_team_key", (q) =>
        q.eq("teamId", teamId).eq("key", WIDGET_SECRET_KEY),
      )
      .first();
    return typeof row?.value === "string" ? row.value : null;
  },
});

export const rotateWidgetSecret = mutation({
  args: { teamId: v.id("teams") },
  handler: async (ctx, { teamId }) => {
    const me = await requireTeamAdmin(ctx, teamId);
    const at = Date.now();
    const next = `wk_${crypto.randomUUID().replace(/-/g, "")}`;
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_team_key", (q) =>
        q.eq("teamId", teamId).eq("key", WIDGET_SECRET_KEY),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        value: next,
        updatedAt: at,
        updatedBy: me.email,
      });
    } else {
      await ctx.db.insert("settings", {
        key: WIDGET_SECRET_KEY,
        value: next,
        updatedAt: at,
        updatedBy: me.email,
        teamId,
      });
    }
    await ctx.db.insert("auditLog", {
      itemId: null,
      event: "widget.secret.rotated",
      payload: {},
      actor: me.email,
      at,
      teamId,
    });
    return next;
  },
});

// ── Invites ─────────────────────────────────────────────────────

export const invite = mutation({
  args: {
    teamId: v.id("teams"),
    email: v.string(),
    role: v.optional(v.union(v.literal("admin"), v.literal("member"))),
  },
  handler: async (ctx, { teamId, email, role }) => {
    const me = await requireTeamAdmin(ctx, teamId);
    const normalized = email.trim().toLowerCase();
    if (!normalized) throw new Error("email required");

    // Already a member?
    const existingMember = await ctx.db
      .query("teamMembers")
      .withIndex("by_team", (q) => q.eq("teamId", teamId))
      .filter((q) => q.eq(q.field("email"), normalized))
      .first();
    if (existingMember) throw new Error("already a member");

    // Already an outstanding invite?
    const existingInvite = await ctx.db
      .query("teamInvites")
      .withIndex("by_email", (q) => q.eq("email", normalized))
      .filter((q) =>
        q.and(
          q.eq(q.field("teamId"), teamId),
          q.eq(q.field("acceptedAt"), undefined),
        ),
      )
      .first();
    if (existingInvite) return existingInvite._id;

    const token = crypto.randomUUID();
    return ctx.db.insert("teamInvites", {
      teamId,
      email: normalized,
      role: role ?? "member",
      token,
      invitedBy: me.email,
      invitedAt: Date.now(),
    });
  },
});

export const listInvites = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, { teamId }) => {
    await requireTeamAdmin(ctx, teamId);
    return ctx.db
      .query("teamInvites")
      .withIndex("by_team", (q) => q.eq("teamId", teamId))
      .filter((q) => q.eq(q.field("acceptedAt"), undefined))
      .collect();
  },
});

export const revokeInvite = mutation({
  args: { teamId: v.id("teams"), inviteId: v.id("teamInvites") },
  handler: async (ctx, { teamId, inviteId }) => {
    await requireTeamAdmin(ctx, teamId);
    const inv = await ctx.db.get(inviteId);
    if (!inv || inv.teamId !== teamId) throw new Error("not found");
    await ctx.db.delete(inviteId);
  },
});

// Auto-accept any pending invites that match the signed-in user's
// email. Called from the client right after bootstrap so a freshly
// signed-up user joins teams that already invited their address.
export const acceptPendingInvites = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId, email } = await requireAuth(ctx);
    const invites = await ctx.db
      .query("teamInvites")
      .withIndex("by_email", (q) => q.eq("email", email))
      .filter((q) => q.eq(q.field("acceptedAt"), undefined))
      .collect();

    let joined = 0;
    for (const inv of invites) {
      // Skip if already a member (race with bootstrap).
      const existing = await ctx.db
        .query("teamMembers")
        .withIndex("by_team_user", (q) =>
          q.eq("teamId", inv.teamId).eq("userId", userId),
        )
        .first();
      if (!existing) {
        await ctx.db.insert("teamMembers", {
          teamId: inv.teamId,
          userId,
          email,
          role: inv.role,
          joinedAt: Date.now(),
          invitedBy: inv.invitedBy,
        });
        joined++;
      }
      await ctx.db.patch(inv._id, {
        acceptedAt: Date.now(),
        acceptedBy: email,
      });
    }
    return { joined };
  },
});
