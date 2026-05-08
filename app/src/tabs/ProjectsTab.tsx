import { useEffect, useMemo, useState } from "react";
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
        <button className="primary" onClick={() => setCreating(true)}>
          + new project
        </button>
      </div>

      {creating && (
        <CreateProjectModal
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            onOpen(id);
          }}
        />
      )}

      {!projects ? (
        <p className="muted">loading…</p>
      ) : projects.length === 0 ? (
        <div className="empty">
          <OttoHero size={120} caption="no projects yet" />
          <p style={{ marginTop: 12 }}>
            create a project to start collecting widget feedback.
          </p>
        </div>
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
          fontSize: 11,
          marginBottom: 12,
          minHeight: 14,
        }}
      >
        {project.primaryRepoName ? (
          <span style={{ fontFamily: "var(--otto-font-mono)" }}>
            → {project.primaryRepoName}
          </span>
        ) : (
          <span className="subtle">no repo connected</span>
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
  const { teamId } = useTeam();
  const [editing, setEditing] = useState(false);
  const projectItems =
    items?.filter((it) => it.projectId === project._id) ?? [];
  const noEventsYet = items && projectItems.length === 0;

  const rotateSecret = useMutation(api.projects.rotateWidgetSecret);
  const cursorStatus = useQuery(
    api.cursorDb.status,
    teamId ? { teamId } : "skip",
  ) as { configured: boolean } | undefined;
  const githubStatus = useQuery(
    api.githubDb.status,
    teamId ? { teamId } : "skip",
  ) as { configured: boolean } | undefined;

  // Per-project widget snippet: the project's own secret tells the
  // server which project (and team) the event belongs to.
  const convexUrl = (import.meta.env.VITE_CONVEX_URL as string | undefined) ?? "";
  const siteUrl = convexUrl.replace(".convex.cloud", ".convex.site");
  const widgetSecret = project.widgetSecret;
  const snippet = `<script
  src="https://YOUR-STATIC-HOST/otto.js"
  data-endpoint="${siteUrl || "https://YOUR-CONVEX.convex.site"}/ingest/widget"
  data-secret="${widgetSecret ?? "<rotate to generate a secret>"}"
  defer
></script>`;

  // Checklist of what's still needed before this project can ship a
  // draft pr from a widget event. Drives the empty-state "next step"
  // card. Order is the order we want users to tackle them.
  const missingRepo = !project.primaryRepoId;
  const missingCursor = cursorStatus !== undefined && !cursorStatus.configured;
  const missingGithub = githubStatus !== undefined && !githubStatus.configured;
  const teamSetupReady =
    cursorStatus !== undefined &&
    githubStatus !== undefined &&
    cursorStatus.configured &&
    githubStatus.configured;

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
            style={{ fontSize: 11, marginTop: 4 }}
          >
            {project.primaryRepoName ? (
              <span style={{ fontFamily: "var(--otto-font-mono)" }}>
                → {project.primaryRepoName}
              </span>
            ) : (
              <span className="subtle">no repo connected</span>
            )}
          </div>
        </div>
        {!editing && (
          <button onClick={() => setEditing(true)}>edit project</button>
        )}
      </div>

      {editing && (
        <ProjectEditForm
          existing={project}
          onCancel={() => setEditing(false)}
          onSaved={() => setEditing(false)}
          onDeleted={onBack}
        />
      )}

      {noEventsYet && (
        <ProjectGettingStarted
          missingRepo={missingRepo}
          missingCursor={missingCursor}
          missingGithub={missingGithub}
          teamSetupReady={teamSetupReady}
          snippet={snippet}
          widgetSecret={widgetSecret}
          onRotate={() => {
            if (!teamId) return;
            if (
              confirm(
                "rotate this project's widget secret? pages still using the old one will stop sending feedback.",
              )
            ) {
              void rotateSecret({ teamId, id: project._id });
            }
          }}
          onEditProject={() => setEditing(true)}
        />
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

/* ─────────────────────── getting-started ─────────────────────── */

// Empty-state guidance when a project has no events yet. Walks the
// user through whatever's still missing — connect a repo, set up
// team integrations, drop the widget snippet — in a single card.
function ProjectGettingStarted({
  missingRepo,
  missingCursor,
  missingGithub,
  teamSetupReady,
  snippet,
  widgetSecret,
  onRotate,
  onEditProject,
}: {
  missingRepo: boolean;
  missingCursor: boolean;
  missingGithub: boolean;
  teamSetupReady: boolean;
  snippet: string;
  widgetSecret: string | undefined;
  onRotate: () => void;
  onEditProject: () => void;
}) {
  const items: { label: string; done: boolean; action?: React.ReactNode }[] = [
    {
      label: "connect a repo to this project",
      done: !missingRepo,
      action: missingRepo && (
        <button onClick={onEditProject}>set primary repo</button>
      ),
    },
    {
      label: "add a cursor api key",
      done: !missingCursor,
      action: missingCursor && (
        <a href="#" onClick={(e) => e.preventDefault()} style={{ fontSize: 12 }}>
          go to settings →
        </a>
      ),
    },
    {
      label: "install the github app",
      done: !missingGithub,
      action: missingGithub && (
        <a href="#" onClick={(e) => e.preventDefault()} style={{ fontSize: 12 }}>
          go to settings →
        </a>
      ),
    },
  ];

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3 style={{ marginTop: 0 }}>get this project running</h3>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: "8px 0 16px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {items.map((it) => (
          <li
            key={it.label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 13,
              opacity: it.done ? 0.5 : 1,
            }}
          >
            <span
              style={{
                width: 18,
                height: 18,
                border: "1px solid var(--otto-ink, #1c1a16)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "var(--otto-font-mono)",
                fontSize: 11,
                background: it.done ? "var(--otto-ink, #1c1a16)" : "transparent",
                color: it.done ? "var(--otto-cream, #f6efde)" : "inherit",
              }}
              aria-hidden
            >
              {it.done ? "✓" : ""}
            </span>
            <span style={{ textDecoration: it.done ? "line-through" : "none" }}>
              {it.label}
            </span>
            {it.action && <span style={{ marginLeft: "auto" }}>{it.action}</span>}
          </li>
        ))}
      </ul>

      {teamSetupReady ? (
        <>
          <h4 style={{ margin: "16px 0 6px", fontSize: 13 }}>
            drop the widget snippet
          </h4>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            paste this on staging or prod. feedback from anyone using
            the widget lands in this project.
          </p>
          <SnippetBlock code={snippet} />
          {widgetSecret && (
            <div
              className="row"
              style={{ gap: 8, marginTop: 10, alignItems: "center" }}
            >
              <button type="button" onClick={onRotate}>
                rotate secret
              </button>
              <span className="muted" style={{ fontSize: 11 }}>
                rotating invalidates pages still using the old one
              </span>
            </div>
          )}
        </>
      ) : (
        <p className="muted" style={{ fontSize: 12 }}>
          finish team setup above, then come back to grab the widget
          snippet.
        </p>
      )}
    </div>
  );
}

/* ─────────────────────── create modal ─────────────────────── */

// Minimal create flow: just the project name. URL patterns, description,
// primary repo, and enabled-toggle are all configurable inside the
// project once it exists. Slug auto-derives from name.
function CreateProjectModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: Id<"projects">) => void;
}) {
  const { teamId } = useTeam();
  const upsert = useMutation(api.projects.upsert);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onCreate = async () => {
    if (!teamId || !name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const id = await upsert({
        teamId,
        name: name.trim(),
        slug: name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
        primaryRepoId: null,
        enabled: true,
      });
      onCreated(id as Id<"projects">);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed to create");
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="modal-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ marginTop: 0 }}>new project</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          give it a name. you can wire up a repo and url patterns once
          it's created.
        </p>
        <label className="otto-eyebrow">name</label>
        <input
          autoFocus
          placeholder="orders"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim() && !busy) onCreate();
          }}
          style={{ width: "100%" }}
        />
        {err && (
          <p
            className="muted"
            style={{ color: "var(--otto-red, #a04a2c)", fontSize: 12 }}
          >
            {err}
          </p>
        )}
        <div
          className="row"
          style={{ justifyContent: "flex-end", gap: 8, marginTop: 16 }}
        >
          <button onClick={onClose} disabled={busy}>
            cancel
          </button>
          <button
            className="primary"
            disabled={!name.trim() || busy}
            onClick={onCreate}
          >
            {busy ? "creating…" : "create"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────── edit form ─────────────────────── */

// The full project form, shown inline inside ProjectDetail. Lets you
// rename, edit url patterns, swap primary repo, toggle enabled, delete.
function ProjectEditForm({
  existing,
  onCancel,
  onSaved,
  onDeleted,
}: {
  existing: ProjectRow;
  onCancel: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const { teamId } = useTeam();
  const repos = useQuery(
    api.reposDb.list,
    teamId ? { teamId } : "skip",
  ) as Doc<"repos">[] | undefined;
  const upsert = useMutation(api.projects.upsert);
  const remove = useMutation(api.projects.remove);

  const [draft, setDraft] = useState({
    name: existing.name,
    primaryRepoId: existing.primaryRepoId ?? "",
    enabled: existing.enabled,
  });

  const onSave = async () => {
    if (!teamId) return;
    await upsert({
      teamId,
      id: existing._id,
      name: draft.name,
      // Slug auto-derives; users never see or set it themselves.
      slug: draft.name.toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
      primaryRepoId: draft.primaryRepoId
        ? (draft.primaryRepoId as Id<"repos">)
        : null,
      enabled: draft.enabled,
    });
    onSaved();
  };

  const onDelete = async () => {
    if (!teamId) return;
    if (!confirm(`delete project "${existing.name}"?`)) return;
    await remove({ teamId, id: existing._id });
    onDeleted();
  };

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>edit project</h3>
      <label className="otto-eyebrow">name</label>
      <input
        value={draft.name}
        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        style={{ width: "100%" }}
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
        <button className="danger" onClick={onDelete}>
          delete
        </button>
        <div className="row" style={{ gap: 8 }}>
          <button onClick={onCancel}>cancel</button>
          <button
            className="primary"
            disabled={!draft.name.trim()}
            onClick={onSave}
          >
            save
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

function SnippetBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <pre
        style={{
          fontFamily: "var(--otto-font-mono)",
          fontSize: 11,
          background: "var(--otto-bg)",
          border: "1px solid var(--otto-rule, rgba(28,26,22,0.18))",
          padding: 12,
          margin: "8px 0 0",
          overflowX: "auto",
        }}
      >
        {code}
      </pre>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          } catch {
            /* clipboard blocked */
          }
        }}
        style={{
          position: "absolute",
          top: 4,
          right: 4,
          fontSize: 11,
          padding: "2px 8px",
        }}
      >
        {copied ? "copied" : "copy"}
      </button>
    </div>
  );
}
