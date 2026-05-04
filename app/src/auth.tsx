import { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Authenticated, Unauthenticated, AuthLoading } from "convex/react";
import { OttoHero, OttoSprite } from "./Otto";

export function AuthGate({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AuthLoading>
        <div className="shell">
          <p className="muted" style={{ padding: "var(--otto-space-6)" }}>
            <OttoSprite size={24} state="thinking" /> waking up…
          </p>
        </div>
      </AuthLoading>
      <Unauthenticated>
        <SignInScreen />
      </Unauthenticated>
      <Authenticated>{children}</Authenticated>
    </>
  );
}

export function SignOutButton() {
  const { signOut } = useAuthActions();
  return (
    <button
      onClick={() => void signOut()}
      style={{ fontSize: "var(--otto-text-xs)" }}
    >
      sign out
    </button>
  );
}

function SignInScreen() {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <div
      className="shell"
      style={{
        maxWidth: 460,
        padding: "var(--otto-space-12) var(--otto-space-6)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
      }}
    >
      <OttoHero
        size={120}
        caption={flow === "signIn" ? "welcome back" : "hi there"}
      />
      <div
        className="card"
        style={{
          width: "100%",
          textAlign: "left",
          marginTop: "var(--otto-space-6)",
        }}
      >
        <h2 style={{ marginTop: 0 }}>
          {flow === "signIn" ? "sign in" : "create account"}
        </h2>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy) return;
            setBusy(true);
            setErr(null);
            const formData = new FormData(event.currentTarget);
            try {
              await signIn("password", formData);
            } catch (e) {
              setErr(prettyError(e, flow));
            } finally {
              setBusy(false);
            }
          }}
        >
          <input
            name="email"
            placeholder="email"
            type="email"
            autoComplete="email"
            required
            style={{ width: "100%", marginBottom: 8 }}
          />
          <input
            name="password"
            placeholder="password"
            type="password"
            autoComplete={flow === "signIn" ? "current-password" : "new-password"}
            required
            minLength={8}
            style={{ width: "100%" }}
          />
          <input name="flow" type="hidden" value={flow} />
          <div className="row" style={{ marginTop: 14 }}>
            <button className="primary" type="submit" disabled={busy}>
              {busy
                ? "working…"
                : flow === "signIn"
                  ? "sign in"
                  : "create account"}
            </button>
            <button
              type="button"
              onClick={() => {
                setFlow(flow === "signIn" ? "signUp" : "signIn");
                setErr(null);
              }}
            >
              {flow === "signIn" ? "sign up instead" : "sign in instead"}
            </button>
          </div>
          {err && (
            <p
              className="otto-eyebrow"
              style={{
                color: "var(--otto-red)",
                marginTop: 10,
              }}
            >
              {err}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}

function prettyError(_e: unknown, flow: "signIn" | "signUp"): string {
  if (flow === "signIn") return "couldn't sign in. check email and password.";
  return "couldn't create account. the email may already be registered.";
}
