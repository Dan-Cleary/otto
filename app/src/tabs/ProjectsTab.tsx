import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convexApi";
import { useTeam } from "../teamContext";
import { OttoHero, StatCard } from "../Otto";
import type { Doc, Id } from "../../../convex/_generated/dataModel";

// projects.list returns the stored project shape plus two joined fields
// the query computes: primaryRepoName + repoCount.
type ProjectRow = Doc<"projects"> & {
  primaryRepoName: string | null;
  repoCount: number;
};

type Item = Doc<"items">;

const BLANK_DRAFT = {
  name: "",
  slug: "",
  description: "",
  urlPatterns: "",
  primaryRepoId: "",
  enabled: true,
};

// Tab-internal "view" — grid (everyone) or detail (one project zoomed in).
// We keep this as component state rather than wiring real URL routing;
// when we want shareable links we'll bolt on a router.
type View = { kind: "grid" } | { kind: "detail"; projectId: Id<"projects"> };

export function ProjectsTab() {
  const { teamId } = useTeam();
  const projects = useQuery(
    api.projects.list,
    teamId ? { teamId } : "skip",
  ) as ProjectRow[] | undefined;
  const items = useQuery(
    api.admin.recentItems,
    teamId ? { teamId, limit: 200 } : "skip",
  ) as Item[] | undefined;

  const [view, setView] = useState<View>({ kind: "grid" });

  if (view.kind === "detail") {
    const project = projects?.find((p) => p._id === view.projectId);
    if (!project) {
      // Project deleted out from under us, or still loading.
      return (
        <p className="muted">
          {projects ? "project not found." : "loading…"}
        </p>
      );
    }
    return (
      <ProjectDetail
        project={project}
        items={items}
        onBack={() => setView({ kind: "grid" })}
      />
    );
  }

  return (
    <ProjectsGrid
      projects={projects}
      items={items}
      onOpen={(id) => setView({ kind: "detail", projectId: id })}
    />
  );
}

/* ─────────────────────── grid view ─────────────────────── */

function ProjectsGrid({
  projects,
  items,
  onOpen,
}: {
  projects: ProjectRow[] | undefined;
  items: Item[] | undefined;
  onOpen: (id: Id<"projects">) => void;
}) {
  const stats = useMemo(() => (items ? computeStats(items) : null), [items]);
  const [creating, setCreating] = useState(false);

  return (
    <>
      {stats && (
        <div className="stat-grid">
          <StatCard
            label={
              <>
                ITEMS <span className="sep">//</span> ALL TIME
              </>
            }
            value={stats.total}
            caption={`${stats.last7d} in the last 7 days`}
          />
          <StatCard
            label={
              <>
                PRS DRAFTED <span className="sep">//</span> ALL TIME
              </>
            }
            value={stats.prsOpened}
            caption={`${stats.prsLast7d} in the last 7 days`}
            accent
          />
          <StatCard
            label={
              <>
                AWAITING <span className="sep">//</span> SLACK QUEUE
              </>
            }
            value={stats.queued}
            caption={stats.queued === 0 ? "all clear" : "needs review"}
          />
        </div>
      )}

      <div
        className="row"
        style={{ justifyContent: "space-between", alignItems: "baseline" }}
      >
        <h2 style={{ margin: 0 }}>projects</h2>
        {!creating && (
          <button className="primary" onClick={() => setCreating(true)}>
            + new project
          </button>
        )}
      </div>

      {creating && (
        <ProjectForm
          onCancel={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false);
            onOpen(id);
          }}
        />
      )}

      {!projects ? (
        <p className="muted">loading…</p>
      ) : projects.length === 0 ? (
        !creating && (
          <div className="empty">
            <OttoHero size={120} caption="no projects yet" />
            <p style={{ marginTop: 12 }}>
              create a project to start collecting widget feedback.
            </p>
            <p className="muted" style={{ fontSize: 12 }}>
              each project owns url patterns + a primary repo so otto can
              route feedback without asking.
            </p>
          </div>
        )
      ) : (
        <div className="project-grid">
          {projects.map((p) => (
            <ProjectCard
              key={p._id}
              project={p}
              items={items?.filter((it) => it.projectId === p._id) ?? []}
              loading={!items}
              onClick={() => onOpen(p._id)}
            />
          ))}
        </div>
      )}
    </>
  );
}

function ProjectCard({
  project,
  items,
  loading,
  onClick,
}: {
  project: ProjectRow;
  items: Item[];
  loading: boolean;
  onClick: () => void;
}) {
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  const recent = items.filter((i) => Date.now() - i.createdAt < sevenDays);
  const drafts = items.filter((i) => i.status === "pr_opened").length;
  const installed = items.length > 0 || loading;

  return (
    <button type="button" className="project-card" onClick={onClick}>
      <div
        className="row"
        style={{
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 8,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 16 }}>{project.name}</h3>
        {!installed && (
          <span
            className="otto-eyebrow"
            style={{
              fontSize: 10,
              padding: "2px 6px",
              border: "1px solid var(--otto-amber, #c89045)",
              color: "var(--otto-amber, #c89045)",
            }}
          >
            no widget yet
          </span>
        )}
      </div>
      <div
        className="muted"
        style={{
          fontFamily: "var(--otto-font-mono)",
          fontSize: 11,
          marginBottom: 12,
          minHeight: 14,
        }}
      >
        {project.urlPatterns.length === 0 ? (
          <span className="subtle">no url patterns</span>
        ) : (
          project.urlPatterns.slice(0, 2).join(" · ")
        )}
      </div>
      <div className="row" style={{ gap: 18, fontSize: 12 }}>
        <span>
          <strong>{items.length}</strong>{" "}
          <span className="muted">items</span>
        </span>
        <span>
          <strong>{recent.length}</strong>{" "}
          <span className="muted">7d</span>
        </span>
        <span>
          <strong>{drafts}</strong>{" "}
          <span className="muted">drafts</span>
        </span>
      </div>
    </button>
  );
}

/* ─────────────────────── detail view ─────────────────────── */

function ProjectDetail({
  project,
  items,
  onBack,
}: {
  project: ProjectRow;
  items: Item[] | undefined;
  onBack: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const projectItems =
    items?.filter((it) => it.projectId === project._id) ?? [];
  const projectStats = items ? computeStats(projectItems) : null;
  const noEventsYet = items && projectItems.length === 0;

  return (
    <>
      <div
        className="row"
        style={{
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 4,
        }}
      >
        <div>
          <button onClick={onBack} style={{ marginBottom: 4 }}>
            ← all projects
          </button>
          <h2 style={{ margin: 0 }}>{project.name}</h2>
          <div
            className="muted"
            style={{
              fontFamily: "var(--otto-font-mono)",
              fontSize: 11,
              marginTop: 4,
            }}
          >
            {project.urlPatterns.length === 0 ? (
              <span className="subtle">no url patterns</span>
            ) : (
              project.urlPatterns.join(" · ")
            )}
          </div>
        </div>
        {!editing && (
          <button onClick={() => setEditing(true)}>edit project</button>
        )}
      </div>

      {editing && (
        <ProjectForm
          existing={project}
          onCancel={() => setEditing(false)}
          onSaved={() => setEditing(false)}
          onDeleted={onBack}
        />
      )}

      {projectStats && (
        <div className="stat-grid">
          <StatCard
            label={
              <>
                ITEMS <span className="sep">//</span> ALL TIME
              </>
            }
            value={projectStats.total}
            caption={`${projectStats.last7d} in the last 7 days`}
          />
          <StatCard
            label={
              <>
                PRS DRAFTED <span className="sep">//</span> ALL TIME
              </>
            }
            value={projectStats.prsOpened}
            caption={`${projectStats.prsLast7d} in the last 7 days`}
            accent
          />
          <StatCard
            label={
              <>
                AWAITING <span className="sep">//</span> SLACK QUEUE
              </>
            }
            value={projectStats.queued}
            caption={
              projectStats.queued === 0 ? "all clear" : "needs review"
            }
          />
        </div>
      )}

      {noEventsYet && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>install the widget</h3>
          <p className="muted" style={{ fontSize: 12 }}>
            otto isn't seeing events for this project yet. drop the snippet
            below into your app and otto will route feedback here whenever
            the page url matches one of your patterns.
          </p>
          <p style={{ fontSize: 12 }}>
            grab the snippet (with your team secret baked in) from{" "}
            <strong>settings → drop the widget</strong>.
          </p>
        </div>
      )}

      <div className="section-label">
        ACTIVITY <span className="sep">//</span> RECENT ITEMS
      </div>
      {!items ? (
        <p className="muted">loading…</p>
      ) : projectItems.length === 0 ? (
        <div className="empty">
          <p className="muted">no items yet for this project.</p>
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th style={{ width: 130 }}>status</th>
              <th>what otto's doing</th>
              <th style={{ width: 200 }}>source</th>
              <th style={{ width: 60 }}>pr</th>
            </tr>
          </thead>
          <tbody>
            {projectItems.slice(0, 50).map((it) => (
              <tr key={it._id}>
                <td>
                  <span className={`status s-${it.status}`}>
                    {statusLabel(it.status)}
                  </span>
                </td>
                <td>{it.description}</td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {shortSource(it.sourceRef)}
                </td>
                <td>
                  {it.prUrl ? (
                    <a href={it.prUrl} target="_blank" rel="noreferrer">
                      open
                    </a>
                  ) : (
                    <span className="subtle">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/* ─────────────────────── shared form ─────────────────────── */

function ProjectForm({
  existing,
  onCancel,
  onSaved,
  onDeleted,
}: {
  existing?: ProjectRow;
  onCancel: () => void;
  onSaved: (id: Id<"projects">) => void;
  onDeleted?: () => void;
}) {
  const { teamId } = useTeam();
  const repos = useQuery(
    api.reposDb.list,
    teamId ? { teamId } : "skip",
  ) as Doc<"repos">[] | undefined;
  const upsert = useMutation(api.projects.upsert);
  const remove = useMutation(api.projects.remove);

  const [draft, setDraft] = useState(
    existing
      ? {
          name: existing.name,
          slug: existing.slug,
          description: existing.description,
          urlPatterns: existing.urlPatterns.join("\n"),
          primaryRepoId: existing.primaryRepoId ?? "",
          enabled: existing.enabled,
        }
      : BLANK_DRAFT,
  );

  const onSave = async () => {
    if (!teamId) return;
    const patterns = draft.urlPatterns
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);
    const id = await upsert({
      teamId,
      id: existing?._id,
      name: draft.name,
      slug:
        draft.slug ||
        draft.name.toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
      description: draft.description,
      urlPatterns: patterns,
      primaryRepoId: draft.primaryRepoId
        ? (draft.primaryRepoId as Id<"repos">)
        : null,
      enabled: draft.enabled,
    });
    onSaved((existing?._id ?? id) as Id<"projects">);
  };

  const onDelete = async () => {
    if (!teamId || !existing) return;
    if (!confirm(`delete project "${existing.name}"?`)) return;
    await remove({ teamId, id: existing._id });
    onDeleted?.();
  };

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>
        {existing ? "edit project" : "new project"}
      </h3>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
        }}
      >
        <div>
          <label className="otto-eyebrow">name</label>
          <input
            placeholder="orders"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            style={{ width: "100%" }}
          />
        </div>
        <div>
          <label className="otto-eyebrow">slug</label>
          <input
            placeholder="orders"
            value={draft.slug}
            onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
            style={{ width: "100%" }}
          />
        </div>
      </div>
      <label
        className="otto-eyebrow"
        style={{ marginTop: 12, display: "block" }}
      >
        description
      </label>
      <textarea
        rows={2}
        placeholder="checkout, payments, refund flow on the orders dashboard"
        value={draft.description}
        onChange={(e) =>
          setDraft({ ...draft, description: e.target.value })
        }
        style={{ width: "100%" }}
      />
      <label
        className="otto-eyebrow"
        style={{ marginTop: 12, display: "block" }}
      >
        url patterns · one per line
      </label>
      <textarea
        rows={3}
        placeholder={"internal.acme.com/orders*\n*.acme.com/checkout/*"}
        value={draft.urlPatterns}
        onChange={(e) =>
          setDraft({ ...draft, urlPatterns: e.target.value })
        }
        style={{ width: "100%", fontFamily: "var(--otto-font-mono)" }}
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: 12,
          marginTop: 12,
          alignItems: "end",
        }}
      >
        <div>
          <label className="otto-eyebrow">primary repo</label>
          <select
            value={draft.primaryRepoId}
            onChange={(e) =>
              setDraft({ ...draft, primaryRepoId: e.target.value })
            }
            style={{ width: "100%" }}
          >
            <option value="">— none yet —</option>
            {(repos ?? []).map((r) => (
              <option key={r._id} value={r._id}>
                {r.name} ({r.githubFullName})
              </option>
            ))}
          </select>
        </div>
        <label
          className="row"
          style={{
            gap: 6,
            fontSize: 12,
            color: "var(--otto-pencil)",
          }}
        >
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) =>
              setDraft({ ...draft, enabled: e.target.checked })
            }
            style={{ width: "auto" }}
          />{" "}
          enabled
        </label>
      </div>
      <div
        className="row"
        style={{ justifyContent: "space-between", marginTop: 16 }}
      >
        {existing ? (
          <button className="danger" onClick={onDelete}>
            delete
          </button>
        ) : (
          <span />
        )}
        <div className="row" style={{ gap: 8 }}>
          <button onClick={onCancel}>cancel</button>
          <button
            className="primary"
            disabled={!draft.name.trim()}
            onClick={onSave}
          >
            {existing ? "save" : "create"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────── helpers ─────────────────────── */

function computeStats(items: { createdAt: number; status: string }[]) {
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  const recent = items.filter((i) => now - i.createdAt < sevenDays);
  return {
    total: items.length,
    last7d: recent.length,
    prsOpened: items.filter((i) => i.status === "pr_opened").length,
    prsLast7d: recent.filter((i) => i.status === "pr_opened").length,
    queued: items.filter((i) => i.status === "queued").length,
  };
}

function statusLabel(status: string): string {
  switch (status) {
    case "parsed":
      return "parsed";
    case "queued":
      return "awaiting review";
    case "approved":
      return "approved";
    case "fired":
      return "working";
    case "pr_opened":
      return "pr open";
    case "failed":
      return "failed";
    case "rejected":
      return "rejected";
    default:
      return status;
  }
}

function shortSource(ref: string): string {
  try {
    const u = new URL(ref);
    return `${u.host}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return ref;
  }
}
