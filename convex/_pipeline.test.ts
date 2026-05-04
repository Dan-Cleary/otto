import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";

// One canned parser response, one canned embedding shared across tests.
const PARSER_OUTPUT = {
  items: [
    {
      description: "Rename foo to bar in README",
      quotedContext: "the README still says foo",
      repoCandidate: null,
      confidence: 0.95,
    },
  ],
};

const EMBED_VEC = new Array(1536).fill(0).map((_, i) =>
  Math.sin(i / 50) * 0.1,
);

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: vi.fn(async () => ({
          choices: [{ message: { content: JSON.stringify(PARSER_OUTPUT) } }],
        })),
      },
    };
    embeddings = {
      create: vi.fn(async () => ({ data: [{ embedding: EMBED_VEC }] })),
    };
  },
}));

const RUN_STATE: { status: "running" | "finished" | "error" } = {
  status: "running",
};
const MOCK_PR_URL = "https://github.com/anthropics/test/pull/42";

vi.mock("@cursor/sdk", () => {
  return {
    Agent: {
      create: vi.fn(async () => ({
        agentId: "bc-agent_test",
        send: vi.fn(async () => ({
          id: "run_test",
          agentId: "bc-agent_test",
          status: "running" as const,
        })),
      })),
      getRun: vi.fn(async () => ({
        id: "run_test",
        agentId: "bc-agent_test",
        status: RUN_STATE.status,
        git:
          RUN_STATE.status === "finished"
            ? { branches: [{ repoUrl: "x", branch: "y", prUrl: MOCK_PR_URL }] }
            : undefined,
      })),
    },
  };
});

let fetchMock: ReturnType<typeof vi.fn>;

function defaultFetch() {
  return vi.fn(async (input: any) => {
    const url = String(input);
    if (url.includes("api.github.com") && url.includes("/pulls/")) {
      return new Response(JSON.stringify({ draft: true }), { status: 200 });
    }
    if (url.includes("slack.com/api/chat.postMessage")) {
      return new Response(
        JSON.stringify({ ok: true, channel: "C123", ts: "1234.5678" }),
        { status: 200 },
      );
    }
    return new Response("{}", { status: 200 });
  });
}

beforeEach(() => {
  fetchMock = defaultFetch();
  vi.stubGlobal("fetch", fetchMock);
  RUN_STATE.status = "running";
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.CURSOR_API_KEY = "cu-test";
  process.env.GITHUB_TOKEN = "gh-test";
  process.env.SLACK_BOT_TOKEN = "xoxb-test";
  process.env.SLACK_REVIEW_CHANNEL = "C123";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Set up a team and a per-team widget secret for tests. Returns
// (teamId, secret). Every fixture that touches admin-scoped tables
// needs a teamId now that the platform is multi-tenant.
async function setupTeam(t: any, secret = "widget-test-secret") {
  const teamId = await t.run(async (ctx: any) =>
    ctx.db.insert("teams", {
      name: "Test team",
      slug: "test",
      createdAt: Date.now(),
      createdBy: "test@otto.dev",
    }),
  );
  await t.run(async (ctx: any) =>
    ctx.db.insert("settings", {
      key: "widget.secret",
      value: secret,
      teamId,
      updatedAt: Date.now(),
      updatedBy: "test@otto.dev",
    }),
  );
  return { teamId, secret };
}

async function insertRepo(
  t: any,
  teamId: any,
  overrides: Partial<{
    name: string;
    githubFullName: string;
    description: string;
    enabled: boolean;
  }> = {},
) {
  return t.run(async (ctx: any) =>
    ctx.db.insert("repos", {
      name: overrides.name ?? "Test repo",
      githubFullName: overrides.githubFullName ?? "anthropics/test",
      githubUrl: `https://github.com/${overrides.githubFullName ?? "anthropics/test"}`,
      description: overrides.description ?? "test",
      metadataBlob: "test repo",
      embedding: EMBED_VEC,
      enabled: overrides.enabled ?? true,
      teamId,
    }),
  );
}

async function insertItem(
  t: any,
  teamId: any,
  fields: Partial<any>,
) {
  return t.run(async (ctx: any) => {
    const ingestEventId = await ctx.db.insert("ingestEvents", {
      sourceType: "widget" as const,
      sourceRef: "x",
      payload: {},
      receivedAt: Date.now(),
      teamId,
    });
    return ctx.db.insert("items", {
      ingestEventId,
      sourceType: "widget" as const,
      sourceRef: "x",
      description: "rename",
      quotedContext: "ctx",
      repoCandidate: null,
      parserConfidence: 0.5,
      routerConfidence: 0.5,
      status: "parsed" as const,
      createdAt: Date.now(),
      teamId,
      ...fields,
    });
  });
}

// Drive the pipeline by hand: convex-test has issues running scheduled
// "use node" actions through the scheduler queue, so we kick each step
// explicitly.
async function drivePipeline(t: any, ingestEventId: any) {
  await t.action(internal.parser.parse, { ingestEventId });
  await t.finishInProgressScheduledFunctions();

  const item = (await t.run(async (ctx: any) =>
    (await ctx.db.query("items").collect())[0],
  )) as any;
  return item;
}

describe("core pipeline", () => {
  it("widget submission → parser → router → fire → poll → pr_opened", async () => {
    const t = convexTest(schema);
    const { teamId, secret } = await setupTeam(t);
    const repoId = await insertRepo(t, teamId);

    // 1) HTTP ingest endpoint records ingestEvent + schedules parser.
    const res = await t.fetch("/ingest/widget", {
      method: "POST",
      headers: {
        "x-otto-secret": secret,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        url: "https://app.example/dashboard",
        description: "the README still says foo",
      }),
    });
    expect(res.status).toBe(200);
    const trackingBody = (await res.json()) as { trackingId: string };
    expect(trackingBody.trackingId).toBeTruthy();

    const ingestEventId = (
      (await t.run(async (ctx) =>
        ctx.db.query("ingestEvents").collect(),
      )) as any[]
    )[0]._id;

    // 2) Parser runs → creates an item, schedules the router.
    let item = await drivePipeline(t, ingestEventId);
    expect(item.description).toBe("Rename foo to bar in README");
    expect(item.parserConfidence).toBe(0.95);
    expect(item.status).toBe("parsed");
    expect(item.teamId).toBe(teamId);

    // 3) Router → applies vector search → patches repoId + routerConfidence.
    await t.action(internal.router.route, { itemId: item._id });
    item = (await t.run(async (ctx) => ctx.db.get(item._id))) as any;
    expect(item.repoId).toBe(repoId);
    expect(item.routerConfidence).toBeGreaterThan(0);

    // 4) Gate decides fire vs queue. With matching embedding + default
    //    threshold of 0.6, this should fire.
    await t.mutation(internal.routerDb.runGate, { itemId: item._id });
    item = (await t.run(async (ctx) => ctx.db.get(item._id))) as any;
    expect(item.status).toBe("fired");

    // 5) Cursor.fire posts to the SDK → run.id stored.
    await t.action(internal.cursor.fire, { itemId: item._id });
    item = (await t.run(async (ctx) => ctx.db.get(item._id))) as any;
    expect(item.cursorRunId).toBe("run_test");
    expect(item.cursorAgentId).toBe("bc-agent_test");

    // 6) First poll sees "running" — should reschedule, not change status.
    await t.action(internal.cursor.poll, {
      itemId: item._id,
      runId: "run_test",
      agentId: "bc-agent_test",
      attempt: 0,
    });
    item = (await t.run(async (ctx) => ctx.db.get(item._id))) as any;
    expect(item.status).toBe("fired");

    // 7) Flip the run to finished. Next poll should mark pr_opened.
    RUN_STATE.status = "finished";
    await t.action(internal.cursor.poll, {
      itemId: item._id,
      runId: "run_test",
      agentId: "bc-agent_test",
      attempt: 1,
    });
    item = (await t.run(async (ctx) => ctx.db.get(item._id))) as any;
    expect(item.status).toBe("pr_opened");
    expect(item.prUrl).toBe(MOCK_PR_URL);

    // 8) Audit log captured every transition.
    const events = (
      await t.run(async (ctx) => ctx.db.query("auditLog").collect())
    ).map((r: any) => r.event);
    expect(events).toContain("ingest.widget");
    expect(events).toContain("parser.item");
    expect(events).toContain("router.decided");
    expect(events).toContain("cursor.fired");
    expect(events).toContain("cursor.pr_opened");
  });

  it("rejects widget submission without the shared secret", async () => {
    const t = convexTest(schema);
    await setupTeam(t);
    const res = await t.fetch("/ingest/widget", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "x", description: "y" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects widget submission with an unknown secret", async () => {
    const t = convexTest(schema);
    await setupTeam(t);
    const res = await t.fetch("/ingest/widget", {
      method: "POST",
      headers: {
        "x-otto-secret": "not-the-real-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({ url: "x", description: "y" }),
    });
    expect(res.status).toBe(401);
  });

  it("trust contract: fails closed when the cursor PR is not draft", async () => {
    const t = convexTest(schema);
    const { teamId } = await setupTeam(t);
    const repoId = await insertRepo(t, teamId);

    fetchMock.mockImplementation(async (input: any) => {
      const url = String(input);
      if (url.includes("api.github.com") && url.includes("/pulls/")) {
        return new Response(JSON.stringify({ draft: false }), { status: 200 });
      }
      if (url.includes("slack.com/api/chat.postMessage")) {
        return new Response(
          JSON.stringify({ ok: true, channel: "C123", ts: "9.9" }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    });

    const itemId = await insertItem(t, teamId, {
      repoId,
      parserConfidence: 0.9,
      routerConfidence: 0.9,
      status: "fired" as const,
    });

    await t.action(internal.cursor.fire, { itemId });
    RUN_STATE.status = "finished";
    await t.action(internal.cursor.poll, {
      itemId,
      runId: "run_test",
      agentId: "bc-agent_test",
      attempt: 0,
    });

    const item = (await t.run(async (ctx) => ctx.db.get(itemId))) as any;
    expect(item.status).toBe("failed");
    expect(item.failureReason).toMatch(/non-draft PR/);
  });

  it("low parser×router confidence routes to the Slack queue, not Cursor", async () => {
    const t = convexTest(schema);
    const { teamId } = await setupTeam(t);
    const repoId = await insertRepo(t, teamId);

    const itemId = await insertItem(t, teamId, {
      description: "rename foo to bar",
      quotedContext: "the README still says foo",
      repoId,
      parserConfidence: 0.4,
      routerConfidence: 0.3, // 0.12 combined, well below 0.6
      status: "parsed" as const,
    });

    await t.mutation(internal.routerDb.runGate, { itemId });
    await t.finishInProgressScheduledFunctions();

    const item = (await t.run(async (ctx) => ctx.db.get(itemId))) as any;
    expect(item.status).toBe("queued");
  });

  it("Slack approve → fires the cursor agent on a previously queued item", async () => {
    const t = convexTest(schema);
    const { teamId } = await setupTeam(t);
    const repoId = await insertRepo(t, teamId);

    const itemId = await insertItem(t, teamId, {
      repoId,
      parserConfidence: 0.5,
      routerConfidence: 0.5,
      status: "queued" as const,
    });

    await t.mutation(internal.routerDb.approve, {
      itemId,
      actor: "slack:U123",
    });
    const after = (await t.run(async (ctx) => ctx.db.get(itemId))) as any;
    expect(after.status).toBe("fired");

    const events = (
      await t.run(async (ctx) =>
        ctx.db
          .query("auditLog")
          .withIndex("by_item", (q) => q.eq("itemId", itemId))
          .collect(),
      )
    ).map((r: any) => r.event);
    expect(events).toContain("review.approved");
  });

  it("Slack reroute → writes routingMemory and fires the cursor agent", async () => {
    const t = convexTest(schema);
    const { teamId } = await setupTeam(t);
    const wrongRepoId = await insertRepo(t, teamId, {
      name: "Wrong",
      githubFullName: "x/wrong",
    });
    const rightRepoId = await insertRepo(t, teamId, {
      name: "Right",
      githubFullName: "x/right",
    });

    const itemId = await insertItem(t, teamId, {
      description: "fix x in y",
      repoId: wrongRepoId,
      parserConfidence: 0.5,
      routerConfidence: 0.5,
      status: "queued" as const,
    });

    await t.mutation(internal.routerDb.reroute, {
      itemId,
      repoId: rightRepoId,
      actor: "slack:U123",
      embedding: EMBED_VEC,
    });

    const after = (await t.run(async (ctx) => ctx.db.get(itemId))) as any;
    expect(after.status).toBe("fired");
    expect(after.repoId).toBe(rightRepoId);

    // routingMemory should be scoped to this team only.
    const memory = await t.run(async (ctx) =>
      ctx.db
        .query("routingMemory")
        .withIndex("by_team", (q) => q.eq("teamId", teamId))
        .collect(),
    );
    expect(memory).toHaveLength(1);
    expect((memory[0] as any).correctedRepoId).toBe(rightRepoId);
    expect((memory[0] as any).correctedBy).toBe("slack:U123");
    expect((memory[0] as any).teamId).toBe(teamId);
  });
});
