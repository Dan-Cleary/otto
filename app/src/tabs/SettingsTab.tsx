import { OnboardingTab } from "./OnboardingTab";
import { MembersTab } from "./MembersTab";
import { ReposTab } from "./ReposTab";
import { SignOutButton } from "../auth";

// Settings bundles everything that's team-wide: the cursor + github
// integrations, repos, members, and sign out.
export function SettingsTab() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
      <OnboardingTab />
      <section>
        <h2 style={{ marginTop: 0 }}>repos</h2>
        <ReposTab />
      </section>
      <section>
        <h2 style={{ marginTop: 0 }}>team</h2>
        <MembersTab />
      </section>
      <section
        style={{
          paddingTop: 24,
          borderTop: "1px solid var(--otto-rule, rgba(28,26,22,0.18))",
          display: "flex",
          justifyContent: "flex-end",
        }}
      >
        <SignOutButton />
      </section>
    </div>
  );
}
