import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convexApi";
import { useTeam } from "../teamContext";
import type { Doc, Id } from "../../../convex/_generated/dataModel";

// projects.list returns the stored project shape plus two joined
// fields the query computes: primaryRepoName + repoCount.
type ProjectRow = Doc<"projects"> & {
  primaryRepoName: string | null;
  repoCount: number;
};

const BLANK_DRAFT = {
  name: "",
  slug: "",
  description: "",
  urlPatterns: "",
  primaryRepoId: "",
  enabled: true,
};

export function ProjectsTab() {
  const { teamId } = useTeam();
  const projects = useQuery(
    api.projects.list,
    teamId ? { teamId } : "skip",
  ) as ProjectRow[] | undefined;
  const repos = useQuery(
    api.reposDb.list,
    teamId ? { teamId } : "skip",
  ) as Doc<"repos">[] | undefined;
  const upsert = useMutation(api.projects.upsert);
  const remove = useMutation(api.projects.remove);
  const setRepoProject = useMutation(api.projects.setRepoProject);

  const [draft, setDraft] = useState(BLANK_DRAFT);
  const [editing, setEditing] = useState<Id<"projects"> | null>(null);

  const onSave = async () => {
    if (!teamId) return;
    const patterns = draft.urlPatterns
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);
    await upsert({
      teamId,
      id: editing ?? undefined,
      name: draft.name,
      slug: draft.slug || draft.name.toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
      description: draft.description,
      urlPatterns: patterns,
      primaryRepoId: draft.primaryRepoId
        ? (draft.primaryRepoId as Id<"repos">)
        : null,
      enabled: draft.enabled,
    });
    setDraft(BLANK_DRAFT);
    setEditing(null);
  };

  const onEdit = (p: ProjectRow) => {
    setEditing(p._id);
    setDraft({
      name: p.name,
      slug: p.slug,
      description: p.description,
      urlPatterns: p.urlPatterns.join("\n"),
      primaryRepoId: p.primaryRepoId ?? "",
      enabled: p.enabled,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>
          {editing ? "edit project" : "add project"}
        </h2>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          projects group repos by what they are for the team — orders,
          customers, refunds. otto routes widget feedback to a project by
          matching the page URL against its patterns.
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            marginTop: 12,
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
        <label className="otto-eyebrow" style={{ marginTop: 12, display: "block" }}>
          description
        </label>
        <textarea
          rows={2}
          placeholder="checkout, payments, refund flow on the orders dashboard"
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          style={{ width: "100%" }}
        />
        <label className="otto-eyebrow" style={{ marginTop: 12, display: "block" }}>
          url patterns · one per line
        </label>
        <textarea
          rows={3}
          placeholder={"internal.acme.com/orders*\n*.acme.com/checkout/*"}
          value={draft.urlPatterns}
          onChange={(e) => setDraft({ ...draft, urlPatterns: e.target.value })}
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
            style={{ gap: 6, fontSize: 12, color: "var(--otto-pencil)" }}
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
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 16, gap: 8 }}>
          {editing && (
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setDraft(BLANK_DRAFT);
              }}
            >
              cancel
            </button>
          )}
          <button
            className="primary"
            disabled={!draft.name.trim()}
            onClick={onSave}
          >
            {editing ? "save" : "create"}
          </button>
        </div>
      </div>

      <h2>projects</h2>
      {!projects ? (
        <p className="muted">loading…</p>
      ) : projects.length === 0 ? (
        <div className="empty">
          <p>no projects yet.</p>
          <p className="muted">
            add one above. each project owns url patterns + a primary
            repo so otto can route widget feedback without asking.
          </p>
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>name</th>
              <th>slug</th>
              <th>url patterns</th>
              <th>primary repo</th>
              <th>repos</th>
              <th>enabled</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p._id}>
                <td>{p.name}</td>
                <td className="muted">{p.slug}</td>
                <td
                  style={{
                    fontFamily: "var(--otto-font-mono)",
                    fontSize: 11,
                    maxWidth: 260,
                  }}
                >
                  {p.urlPatterns.length === 0 ? (
                    <span className="subtle">—</span>
                  ) : (
                    p.urlPatterns.join(", ")
                  )}
                </td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {p.primaryRepoName ?? <span className="subtle">—</span>}
                </td>
                <td className="muted">{p.repoCount}</td>
                <td>{p.enabled ? "✓" : "—"}</td>
                <td>
                  <div className="row">
                    <button onClick={() => onEdit(p)}>edit</button>
                    <button
                      className="danger"
                      onClick={() => {
                        if (
                          teamId &&
                          confirm(`delete project "${p.name}"?`)
                        ) {
                          void remove({
                            teamId,
                            id: p._id,
                          });
                        }
                      }}
                    >
                      delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {projects && projects.length > 0 && repos && repos.length > 0 && (
        <>
          <h2>repo → project assignments</h2>
          <table>
            <thead>
              <tr>
                <th>repo</th>
                <th>project</th>
              </tr>
            </thead>
            <tbody>
              {repos.map((r) => (
                <tr key={r._id}>
                  <td>
                    {r.name}{" "}
                    <span className="muted" style={{ fontSize: 11 }}>
                      ({r.githubFullName})
                    </span>
                  </td>
                  <td>
                    <select
                      value={r.projectId ?? ""}
                      onChange={(e) =>
                        teamId &&
                        void setRepoProject({
                          teamId,
                          repoId: r._id,
                          projectId: e.target.value
                            ? (e.target.value as Id<"projects">)
                            : null,
                        })
                      }
                    >
                      <option value="">— unassigned —</option>
                      {projects.map((p) => (
                        <option key={p._id} value={p._id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
