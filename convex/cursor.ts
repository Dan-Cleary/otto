"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Agent } from "@cursor/sdk";
import { buildPrompt } from "./cursorPrompt";

const AGENT_NAME = process.env.OTTO_AGENT_NAME ?? "Otto";
const POLL_INTERVAL_SECONDS = 20;
// 30m at 20s interval. Long enough for non-trivial Cursor runs;
// short enough that a stuck run doesn't accumulate forever.
const MAX_POLL_ATTEMPTS = 90;

export const fire = internalAction({
  args: { itemId: v.id("items") },
  handler: async (ctx, { itemId }) => {
    const ctxData = await ctx.runQuery(internal.cursorDb.getFireContext, {
      itemId,
    });
    if (!ctxData) throw new Error(`item ${itemId} not found`);
    if (!ctxData.repo) {
      await ctx.runMutation(internal.cursorDb.markFailed, {
        itemId,
        reason: "no repo set on item",
      });
      return;
    }

    const prompt = buildPrompt({
      agentName: AGENT_NAME,
      sourceLabel:
        ctxData.item.sourceType === "widget" ? "feedback widget" : "meeting",
      sourceRef: ctxData.item.sourceRef,
      description: ctxData.item.description,
      quotedContext: ctxData.item.quotedContext,
      parserConfidence: ctxData.item.parserConfidence,
      routerConfidence: ctxData.item.routerConfidence,
    });

    const apiKey = ctxData.cursorApiKey ?? process.env.CURSOR_API_KEY;
    if (!apiKey) {
      await ctx.runMutation(internal.cursorDb.markFailed, {
        itemId,
        reason:
          "no cursor api key configured for this team (set in onboarding) and no fallback in env",
      });
      return;
    }
    const modelId = process.env.OTTO_CURSOR_MODEL;
    const agent = await Agent.create({
      apiKey,
      ...(modelId ? { model: { id: modelId } } : {}),
      cloud: {
        repos: [{ url: ctxData.repo.githubUrl, startingRef: "main" }],
        autoCreatePR: true,
      },
    });

    const run = await agent.send(prompt);

    await ctx.runMutation(internal.cursorDb.markFired, {
      itemId,
      cursorRunId: run.id,
      cursorAgentId: run.agentId,
    });

    await ctx.scheduler.runAfter(POLL_INTERVAL_SECONDS * 1000, internal.cursor.poll, {
      itemId,
      runId: run.id,
      agentId: run.agentId,
      attempt: 0,
    });
  },
});

// Status-check + reschedule. Each invocation is short — we never block on a
// long-running cloud run via run.wait(), which would exceed Convex action
// time limits. The scheduler chains polls until the run reaches a terminal
// status or we exceed MAX_POLL_ATTEMPTS.
export const poll = internalAction({
  args: {
    itemId: v.id("items"),
    runId: v.string(),
    agentId: v.string(),
    attempt: v.number(),
  },
  handler: async (ctx, { itemId, runId, agentId, attempt }) => {
    const run = await Agent.getRun(runId, {
      runtime: "cloud",
      agentId,
    });

    if (run.status === "running") {
      if (attempt + 1 >= MAX_POLL_ATTEMPTS) {
        const reason = `poll timeout after ${MAX_POLL_ATTEMPTS} attempts`;
        await ctx.runMutation(internal.cursorDb.markFailed, { itemId, reason });
        await ctx.scheduler.runAfter(0, internal.slack.postFailure, {
          itemId,
          reason,
        });
        return;
      }
      await ctx.scheduler.runAfter(
        POLL_INTERVAL_SECONDS * 1000,
        internal.cursor.poll,
        { itemId, runId, agentId, attempt: attempt + 1 },
      );
      return;
    }

    if (run.status === "error" || run.status === "cancelled") {
      const reason = `cursor run ${run.status}`;
      await ctx.runMutation(internal.cursorDb.markFailed, { itemId, reason });
      await ctx.scheduler.runAfter(0, internal.slack.postFailure, {
        itemId,
        reason,
      });
      return;
    }

    // status === "finished"
    const prUrl = run.git?.branches?.[0]?.prUrl;
    if (!prUrl) {
      const reason = "agent finished without a PR URL";
      await ctx.runMutation(internal.cursorDb.markFailed, { itemId, reason });
      await ctx.scheduler.runAfter(0, internal.slack.postFailure, {
        itemId,
        reason,
      });
      return;
    }

    // Trust contract: verify the PR is actually a draft. Fail closed otherwise.
    // Prefer a github-app installation token (per-team, scoped to the
    // repos the team installed on); fall back to the env PAT when no
    // installation is on file (legacy / CI / the "first run" case).
    const teamId = await ctx.runQuery(internal.cursorDb.getItemTeam, { itemId });
    let token: string | null = null;
    if (teamId) {
      const t = await ctx.runAction(internal.github.getInstallToken, { teamId });
      if ("value" in t) token = t.value;
    }
    if (!token) token = process.env.GITHUB_TOKEN ?? null;

    const isDraft = await verifyDraft(prUrl, token);
    if (!isDraft) {
      const reason = `non-draft PR opened: ${prUrl}`;
      await ctx.runMutation(internal.cursorDb.markFailed, { itemId, reason });
      await ctx.scheduler.runAfter(0, internal.slack.postFailure, {
        itemId,
        reason,
      });
      return;
    }

    await ctx.runMutation(internal.cursorDb.markPrOpened, { itemId, prUrl });
    await ctx.scheduler.runAfter(0, internal.slack.postSuccess, {
      itemId,
      prUrl,
    });
  },
});

async function verifyDraft(
  prUrl: string,
  token: string | null,
): Promise<boolean> {
  // Expect prUrl like https://github.com/OWNER/REPO/pull/NUMBER
  const m = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!m) return false;
  const [, owner, repo, number] = m;
  if (!token) {
    // Without a token we cannot verify — fail closed.
    return false;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${number}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "otto",
        },
        signal: ctrl.signal,
      },
    );
    if (!res.ok) return false;
    const body: any = await res.json();
    return body.draft === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
