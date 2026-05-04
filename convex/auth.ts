import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth, getAuthUserId } from "@convex-dev/auth/server";
import type {
  ActionCtx,
  MutationCtx,
  QueryCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";

// Convex Auth with the Password provider. Anyone with the deployment URL
// can sign up — they land in their own personal team automatically (see
// teams.bootstrap).

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password],
});

// Authentication only — does NOT scope to any team. Use this for
// queries/mutations that legitimately span teams (e.g. listing the
// teams a user belongs to). For everything else, use requireTeamMember.
export async function requireAuth(ctx: QueryCtx): Promise<{
  userId: string;
  email: string;
}> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("unauthorized");
  const user = await ctx.db.get(userId);
  const email = String((user as any)?.email ?? "").toLowerCase();
  return { userId: String(userId), email };
}

// Verify the caller is a member of the given team and return their
// role. This is the gate every team-scoped query/mutation must use.
export async function requireTeamMember(
  ctx: QueryCtx,
  teamId: Id<"teams">,
): Promise<{
  userId: string;
  email: string;
  teamId: Id<"teams">;
  role: "admin" | "member";
}> {
  const { userId, email } = await requireAuth(ctx);
  const member = await ctx.db
    .query("teamMembers")
    .withIndex("by_team_user", (q) =>
      q.eq("teamId", teamId).eq("userId", userId),
    )
    .first();
  if (!member) throw new Error("not a member of this team");
  return { userId, email, teamId, role: member.role };
}

export async function requireTeamAdmin(
  ctx: QueryCtx,
  teamId: Id<"teams">,
): Promise<{
  userId: string;
  email: string;
  teamId: Id<"teams">;
  role: "admin";
}> {
  const m = await requireTeamMember(ctx, teamId);
  if (m.role !== "admin") throw new Error("admin role required");
  return { ...m, role: "admin" };
}

// Action-context variant: returns the authenticated user. Despite the
// historical name, this does NOT verify admin role on its own — pair
// it with internal.<integration>Db.ensureTeamAdmin for the admin gate.
// Actions don't have ctx.db, so we round-trip through an internal
// query to fetch the user record.
export async function requireAuthAction(ctx: ActionCtx): Promise<{
  userId: string;
  email: string;
}> {
  return ctx.runQuery(internal.authDb.currentUser, {});
}

// Backwards-compat alias. New call sites should use requireAuthAction
// + an explicit ensureTeamAdmin runQuery.
export const requireAdminAction = requireAuthAction;

// Mutation-context: ensure the user has at least one team. If not,
// bootstrap a personal team (or claim the legacy data set if they're
// the very first user in the deployment) and return the team id.
export async function ensureTeamForUser(
  ctx: MutationCtx,
  userId: string,
  email: string,
): Promise<Id<"teams">> {
  const existing = await ctx.db
    .query("teamMembers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  if (existing) return existing.teamId;

  // Special-case: a fresh deployment that contains pre-team-era rows
  // (e.g. data created before the multi-tenant refactor landed). The
  // very first user there inherits that data into a "Legacy" team so
  // nothing gets orphaned. On any normal deployment with no orphan
  // data, this branch is skipped and the user gets an ordinary
  // personal team.
  const anyTeamMember = await ctx.db.query("teamMembers").first();
  const isFirstUser = anyTeamMember === null;
  const shouldClaimLegacy = isFirstUser && (await hasOrphanRows(ctx));

  const slugBase = (email.split("@")[0] || "team")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-");
  let slug = shouldClaimLegacy ? "legacy" : slugBase;
  let n = 1;
  while (
    await ctx.db
      .query("teams")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first()
  ) {
    n += 1;
    slug = `${slugBase}-${n}`;
  }

  const teamId = await ctx.db.insert("teams", {
    name: shouldClaimLegacy ? "Legacy" : `${email.split("@")[0]}'s team`,
    slug,
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

  if (shouldClaimLegacy) {
    await claimOrphanRows(ctx, teamId);
  }

  return teamId;
}

// Cheap probe: does any team-scoped table contain a row that pre-dates
// the multi-tenant refactor (i.e. has no teamId)? We sample up to 50
// rows per table because Convex doesn't guarantee ordering — just
// looking at .first() can miss a legacy row sitting behind a
// post-refactor row.
const ORPHAN_PROBE_LIMIT = 50;
async function hasOrphanRows(ctx: MutationCtx): Promise<boolean> {
  for (const tableName of [
    "projects",
    "repos",
    "items",
    "ingestEvents",
    "routingMemory",
    "auditLog",
    "settings",
  ] as const) {
    const sample = await ctx.db.query(tableName).take(ORPHAN_PROBE_LIMIT);
    if (
      sample.some(
        (r) =>
          (r as any).teamId === undefined || (r as any).teamId === null,
      )
    ) {
      return true;
    }
  }
  return false;
}

async function claimOrphanRows(
  ctx: MutationCtx,
  teamId: Id<"teams">,
): Promise<void> {
  // Each table where teamId is optional gets backfilled to the
  // legacy team. Only rows with no teamId yet are touched.
  for (const tableName of [
    "projects",
    "repos",
    "items",
    "ingestEvents",
    "routingMemory",
    "auditLog",
    "settings",
  ] as const) {
    // We can't conditionally index on missing fields, so scan and
    // filter. These tables are small (admin-tool scale) so this is
    // a one-time, bounded migration.
    const rows = await ctx.db.query(tableName).collect();
    for (const row of rows) {
      if ((row as any).teamId === undefined || (row as any).teamId === null) {
        await ctx.db.patch(row._id, { teamId } as any);
      }
    }
  }
}
