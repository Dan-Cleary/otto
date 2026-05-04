"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import OpenAI from "openai";

const SLACK_API = "https://slack.com/api";

export const postReview = internalAction({
  args: { itemId: v.id("items") },
  handler: async (ctx, { itemId }) => {
    const channel = process.env.SLACK_REVIEW_CHANNEL;
    const token = process.env.SLACK_BOT_TOKEN;
    if (!channel || !token) {
      console.warn("[slack] missing SLACK_REVIEW_CHANNEL or SLACK_BOT_TOKEN");
      return;
    }

    const data = await ctx.runQuery(internal.slackDb.getReviewContext, {
      itemId,
    });
    if (!data) return;

    const blocks = buildReviewBlocks(itemId, data);

    const res = await fetch(`${SLACK_API}/chat.postMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ channel, blocks, text: "Otto review" }),
    });
    const body: any = await res.json();
    if (!body.ok) {
      console.error("[slack] postMessage failed", body);
      return;
    }

    await ctx.runMutation(internal.slackDb.recordReviewMessage, {
      itemId,
      channel: body.channel,
      ts: body.ts,
    });
  },
});

export const postSuccess = internalAction({
  args: { itemId: v.id("items"), prUrl: v.string() },
  handler: async (_ctx, { itemId, prUrl }) => {
    const channel = process.env.SLACK_REVIEW_CHANNEL;
    const token = process.env.SLACK_BOT_TOKEN;
    if (!channel || !token) return;
    await fetch(`${SLACK_API}/chat.postMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel,
        text: `Otto opened a draft PR for item \`${itemId}\`: ${prUrl}`,
      }),
    });
  },
});

export const postFailure = internalAction({
  args: { itemId: v.id("items"), reason: v.string() },
  handler: async (_ctx, { itemId, reason }) => {
    const channel = process.env.SLACK_REVIEW_CHANNEL;
    const token = process.env.SLACK_BOT_TOKEN;
    if (!channel || !token) return;
    await fetch(`${SLACK_API}/chat.postMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel,
        text: `:warning: Otto failed item \`${itemId}\`: ${reason}`,
      }),
    });
  },
});

// Called from the http interaction handler. We embed in node so we can write
// to routingMemory atomically with the reroute mutation.
export const handleInteraction = internalAction({
  args: {
    actionId: v.string(),
    actionValue: v.string(),
    user: v.string(),
    channel: v.string(),
    messageTs: v.string(),
  },
  handler: async (ctx, { actionId, actionValue, user, channel, messageTs }) => {
    const item = await ctx.runQuery(internal.slackDb.findItemBySlackTs, {
      channel,
      ts: messageTs,
    });
    if (!item) return;

    if (actionId === "otto_approve") {
      await ctx.runMutation(internal.routerDb.approve, {
        itemId: item._id,
        actor: `slack:${user}`,
      });
      await updateMessage(channel, messageTs, "Approved — firing.");
      return;
    }
    if (actionId === "otto_reject") {
      await ctx.runMutation(internal.routerDb.reject, {
        itemId: item._id,
        actor: `slack:${user}`,
      });
      await updateMessage(channel, messageTs, "Rejected.");
      return;
    }
    if (actionId === "otto_reroute") {
      // actionValue is repoId
      const text = `${item.description}\n\nContext: ${item.quotedContext}`;
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
      const embed = await client.embeddings.create({
        model: "text-embedding-3-small",
        input: text,
      });
      await ctx.runMutation(internal.routerDb.reroute, {
        itemId: item._id,
        repoId: actionValue as any,
        actor: `slack:${user}`,
        embedding: embed.data[0]!.embedding,
      });
      await updateMessage(
        channel,
        messageTs,
        `Re-routed by <@${user}> — firing.`,
      );
    }
  },
});

async function updateMessage(channel: string, ts: string, text: string) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return;
  await fetch(`${SLACK_API}/chat.update`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ channel, ts, text }),
  });
}

function buildReviewBlocks(
  itemId: string,
  data: {
    item: any;
    suggestions: { repoId: string; name: string; score: number }[];
  },
) {
  const { item, suggestions } = data;
  const lines = [
    `*New action item* (parser ${item.parserConfidence.toFixed(
      2,
    )}, router ${item.routerConfidence?.toFixed?.(2) ?? "n/a"})`,
    `> ${item.description}`,
    `_Source:_ ${item.sourceRef}`,
  ];

  const blocks: any[] = [
    { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
  ];

  const approveBtn = {
    type: "button",
    style: "primary",
    text: { type: "plain_text", text: "Approve" },
    action_id: "otto_approve",
    value: itemId,
  };
  const rejectBtn = {
    type: "button",
    style: "danger",
    text: { type: "plain_text", text: "Reject" },
    action_id: "otto_reject",
    value: itemId,
  };

  blocks.push({ type: "actions", elements: [approveBtn, rejectBtn] });

  if (suggestions.length > 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "*Re-route to:*" },
    });
    blocks.push({
      type: "actions",
      elements: suggestions.slice(0, 3).map((s) => ({
        type: "button",
        text: {
          type: "plain_text",
          text: `${s.name} (${s.score.toFixed(2)})`,
        },
        action_id: "otto_reroute",
        value: s.repoId,
      })),
    });
  }

  return blocks;
}
