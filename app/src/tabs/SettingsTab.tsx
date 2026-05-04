import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convexApi";
import { useTeam } from "../teamContext";

export function SettingsTab() {
  const { teamId } = useTeam();
  const threshold = useQuery(
    api.admin.getThreshold,
    teamId ? { teamId } : "skip",
  );
  const setThreshold = useMutation(api.routerDb.setThreshold);
  const [draft, setDraft] = useState<string>("");

  useEffect(() => {
    if (typeof threshold === "number") setDraft(threshold.toString());
  }, [threshold]);

  return (
    <div className="card" style={{ maxWidth: 480 }}>
      <h2 style={{ marginTop: 0 }}>confidence threshold</h2>
      <p className="muted" style={{ fontSize: 12 }}>
        items with parser × router confidence below this go to the slack
        review queue instead of firing automatically.
      </p>
      <div className="row">
        <input
          type="number"
          step="0.05"
          min="0"
          max="1"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          className="primary"
          disabled={
            !draft ||
            Number.isNaN(Number(draft)) ||
            Number(draft) < 0 ||
            Number(draft) > 1
          }
          onClick={() =>
            teamId &&
            setThreshold({ teamId, value: Number(draft) })
          }
        >
          save
        </button>
      </div>
    </div>
  );
}
