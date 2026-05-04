import { internalQuery } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

// Action-side helper: returns the signed-in user's id + email, or
// throws "unauthorized". Used by actions that can't call requireAuth
// directly (no ctx.db).
export const currentUser = internalQuery({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthorized");
    const user = await ctx.db.get(userId);
    const email = String((user as any)?.email ?? "").toLowerCase();
    return { userId: String(userId), email };
  },
});
