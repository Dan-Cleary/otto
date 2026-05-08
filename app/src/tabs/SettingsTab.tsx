import { OnboardingTab } from "./OnboardingTab";
import { MembersTab } from "./MembersTab";

// Settings bundles everything you configure for a team: the integration
// wizard (widget + cursor + github + repos + slack) and team membership.
export function SettingsTab() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      <OnboardingTab />
      <section>
        <h2 style={{ marginTop: 0 }}>team</h2>
        <MembersTab />
      </section>
    </div>
  );
}
