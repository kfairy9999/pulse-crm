import { useEffect, useState } from "react";
import { LoaderCircle, ShieldCheck } from "lucide-react";
import { api, isDemo } from "./api.js";
import { deriveCredential } from "../auth/password.js";

export function canEnterWorkspace(session) {
  return Boolean(session?.user || (session?.authenticated && !session?.setupRequired));
}

export default function AuthGate({ children }) {
  const [state, setState] = useState({
    loading: true,
    user: null,
    setup: false,
    authenticated: false,
  });
  const [fields, setFields] = useState({
    email: "",
    password: "",
    confirm: "",
    setupToken: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    try {
      const result = await api("/auth/session");
      setState({
        loading: false,
        user: result.user,
        setup: result.setupRequired,
        authenticated: Boolean(result.authenticated || result.user),
        passwordProtocol: result.passwordProtocol || "legacy-scrypt",
      });
    } catch (err) {
      setState((current) => ({
        ...current,
        loading: false,
        user: null,
        setup: false,
        authenticated: false,
      }));
      setError(err.message);
    }
  };
  useEffect(() => {
    load();
  }, []);
  const submit = async (event) => {
    event.preventDefault();
    setError("");
    if (state.setup && fields.password !== fields.confirm)
      return setError("Those two passwords don’t match yet. Please type them again.");
    setBusy(true);
    try {
      const legacy = state.passwordProtocol === "legacy-scrypt";
      const challenge =
        state.setup || legacy
          ? null
          : await api(
              `/auth/challenge?email=${encodeURIComponent(fields.email)}`,
            );
      const credential = legacy
        ? { password: fields.password }
        : await deriveCredential(fields.password, challenge?.salt);
      setFields({ ...fields, password: "", confirm: "" });
      const result = await api(`/auth/${state.setup ? "setup" : "login"}`, {
        method: "POST",
        body: JSON.stringify({
          email: fields.email,
          ...credential,
          setupToken: fields.setupToken || undefined,
        }),
      });
      window.history.replaceState(null, "", "/");
      window.dispatchEvent(new Event("pulse-session"));
      setState((current) => ({
        ...current,
        loading: false,
        user: result.user,
        setup: false,
        authenticated: true,
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setFields((current) => ({
        ...current,
        password: "",
        confirm: "",
        setupToken: "",
      }));
      setBusy(false);
    }
  };
  if (state.loading)
    return (
      <main className="auth-screen">
        <LoaderCircle className="spin" />
        <p>Opening your workspace…</p>
      </main>
    );
  if (canEnterWorkspace({ user: state.user, authenticated: state.authenticated, setupRequired: state.setup }))
    return children({
      owner: state.user,
      onLogout: async () => {
        if (isDemo()) {
          window.location.assign("/signin");
          return;
        }
        try {
          await api("/auth/logout", { method: "POST" });
        } catch {
          /* Expired sessions cannot access data. */
        }
        setState((current) => ({
          ...current,
          loading: false,
          user: null,
          setup: false,
          authenticated: false,
        }));
      },
    });
  return (
    <main className="auth-screen">
      <section className="auth-card">
        <div className="auth-brand">
          <span className="brand-symbol">
            <ShieldCheck size={22} />
          </span>
          <span className="brand-name">
            pulse<span>.</span>
          </span>
        </div>
        <span className="eyebrow">
          {state.setup ? "One-time owner setup" : "Your private workspace"}
        </span>
        <h1>{state.setup ? "Make this workspace yours." : "Welcome back."}</h1>
        <p>
          {state.setup
            ? "Choose the email and password only you will use. This is the one owner account."
            : "Your people, pipeline, and follow-ups are right where you left them."}
        </p>
        <form onSubmit={submit}>
          {error && (
            <div className="form-alert" role="alert">
              {error}
            </div>
          )}
          <div className="field">
            <label className="field-label" htmlFor="auth-email">
              Email address
            </label>
            <input
              id="auth-email"
              type="email"
              name="username"
              autoComplete="username"
              required
              maxLength="254"
              autoFocus
              value={fields.email}
              onChange={(e) => setFields({ ...fields, email: e.target.value })}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="auth-password">
              Password
            </label>
            <input
              id="auth-password"
              type="password"
              name={state.setup ? "new-password" : "current-password"}
              autoComplete={state.setup ? "new-password" : "current-password"}
              required
              minLength={12}
              maxLength={256}
              value={fields.password}
              onChange={(e) =>
                setFields({ ...fields, password: e.target.value })
              }
            />
            <span className="field-hint">
              At least 12 characters. Use a unique password from your password
              manager.
            </span>
          </div>
          {state.setup && (
            <>
              <div className="field">
                <label className="field-label" htmlFor="auth-confirm">
                  Confirm password
                </label>
                <input
                  id="auth-confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={256}
                  value={fields.confirm}
                  onChange={(e) =>
                    setFields({ ...fields, confirm: e.target.value })
                  }
                />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="auth-setup-token">
                  One-time setup key
                </label>
                <input
                  id="auth-setup-token"
                  type="password"
                  autoComplete="off"
                  required
                  maxLength={256}
                  value={fields.setupToken}
                  onChange={(e) =>
                    setFields({ ...fields, setupToken: e.target.value })
                  }
                />
                <span className="field-hint">
                  Copy this directly from the hosting provider’s generated
                  SETUP_TOKEN variable. It is not your workspace password.
                </span>
              </div>
            </>
          )}
          <button className="button button-primary auth-submit" disabled={busy}>
            {busy ? (
              <>
                <LoaderCircle size={16} className="spin" /> Processing securely…
              </>
            ) : state.setup ? (
              "Create my private workspace"
            ) : (
              "Sign in"
            )}{" "}
          </button>
        </form>
        <div className="auth-privacy">
          <ShieldCheck size={15} />
          <span>
            Protected by encrypted HTTPS, secure sessions, and request
            verification.
          </span>
        </div>
        <a className="auth-demo-link" href="/demo">
          <span>
            <strong>Just looking around?</strong>
            Open the demo with sample data. It runs in your browser and
            never touches this workspace.
          </span>
          <span aria-hidden="true">→</span>
        </a>
      </section>
    </main>
  );
}
