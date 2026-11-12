import { useState } from "react";
import { Check, Circle, CircleCheck, Eye, EyeOff, GraduationCap, TriangleAlert } from "lucide-react";
import { authClient } from "../lib/api";
import { boot, useApp } from "../store/app";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui";

const RULES: { label: string; test: (p: string) => boolean }[] = [
  { label: "At least 8 characters", test: (p) => p.length >= 8 },
  { label: "Contains a number", test: (p) => /\d/.test(p) },
  { label: "Contains a symbol, such as ! or #", test: (p) => /[^A-Za-z0-9\s]/.test(p) },
];

function Logo({ light }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="grid place-items-center rounded-[9px] font-bold t16"
        style={{ width: 32, height: 32, background: light ? "#fff" : "var(--brand)", color: light ? "#2d6a5f" : "var(--brand-ink)" }}
      >
        M
      </span>
      <span className="t19 font-bold tracking-[-0.2px]" style={{ color: light ? "#fff" : "var(--ink)" }}>
        Margin
      </span>
    </div>
  );
}

function BrandPanel() {
  return (
    <div className="hidden lg:flex flex-col relative overflow-hidden" style={{ width: "40%", maxWidth: 640, background: "#2d6a5f", color: "#fff", padding: "56px 64px" }}>
      <Logo light />
      <h1 className="font-bold m-0" style={{ fontSize: 40, lineHeight: 1.2, marginTop: 110, maxWidth: 500, letterSpacing: "-0.4px" }}>
        A calm canvas for all your study notes.
      </h1>
      <p className="m-0" style={{ fontSize: 17, lineHeight: 1.6, marginTop: 22, maxWidth: 460, color: "rgba(255,255,255,0.88)" }}>
        Notes, sketches, links and group tasks in one place, with focus tools that protect your attention.
      </p>
      <div className="relative mt-auto" style={{ height: 250 }} aria-hidden="true">
        <div className="absolute rounded-[10px] bg-white overflow-hidden" style={{ left: 0, top: 36, width: 230, height: 148, boxShadow: "0 8px 14px rgba(0,0,0,0.18)" }}>
          <div style={{ height: 7, background: "#5fa88c" }} />
          <div style={{ padding: "18px 16px", color: "#1d2321", fontSize: 14, fontWeight: 600 }}>Lecture 6 · Sampling</div>
          <div style={{ margin: "0 16px", height: 6, width: 180, borderRadius: 3, background: "#e6ebe9" }} />
          <div style={{ margin: "10px 16px 0", height: 6, width: 150, borderRadius: 3, background: "#e6ebe9" }} />
          <div style={{ margin: "10px 16px 0", height: 6, width: 166, borderRadius: 3, background: "#e6ebe9" }} />
        </div>
        <div className="absolute rounded-[10px] bg-white overflow-hidden" style={{ left: 260, top: 4, width: 240, height: 110, boxShadow: "0 8px 14px rgba(0,0,0,0.18)" }}>
          <div style={{ height: 7, background: "#5b8fd0" }} />
          <div style={{ padding: "18px 16px 12px", color: "#1d2321", fontSize: 14, fontWeight: 600 }}>Group poster board</div>
          <div className="flex gap-2" style={{ padding: "0 16px" }}>
            <span style={{ width: 60, height: 34, borderRadius: 6, background: "#eef2f0" }} />
            <span style={{ width: 60, height: 34, borderRadius: 6, background: "#eef2f0" }} />
            <span style={{ width: 60, height: 34, borderRadius: 6, background: "#e2efeb" }} />
          </div>
        </div>
        <div className="absolute rounded-[10px] bg-white overflow-hidden" style={{ left: 290, top: 136, width: 210, height: 100, boxShadow: "0 8px 14px rgba(0,0,0,0.18)" }}>
          <div style={{ height: 7, background: "#8e75cc" }} />
          <div style={{ padding: "22px 18px", color: "#1d2321", fontSize: 18, fontStyle: "italic", fontFamily: "'Segoe Print', 'Bradley Hand', cursive" }}>study design ↓</div>
        </div>
      </div>
    </div>
  );
}

export function AuthScreen() {
  const config = useApp((s) => s.config);
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signup = mode === "signup";
  const providers = [
    ...(config?.providers.microsoft ? [{ id: "microsoft" as const, label: "Microsoft" }] : []),
    ...(config?.providers.google ? [{ id: "google" as const, label: "Google" }] : []),
  ];
  const rulesOk = RULES.every((r) => r.test(password));
  const canSubmit = !!email.trim() && !!password && (!signup || (!!name.trim() && rulesOk)) && !busy;

  const social = async (provider: "microsoft" | "google") => {
    setError(null);
    const res = await authClient.signIn.social({ provider, callbackURL: window.location.origin + "/" + window.location.search });
    if (res.error) setError(res.error.message ?? "Could not start sign-in");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const res = signup
      ? await authClient.signUp.email({ name: name.trim(), email: email.trim(), password, rememberMe: remember } as Parameters<typeof authClient.signUp.email>[0])
      : await authClient.signIn.email({ email: email.trim(), password, rememberMe: remember });
    setBusy(false);
    if (res.error) {
      setError(
        res.error.message ??
          (signup ? "Could not create the account. Check the details and try again." : "That email and password do not match an account."),
      );
      return;
    }
    await boot();
  };

  const ssoButton = (
    <button type="button" className="btn btn-lg w-full" onClick={providers.length === 1 ? () => social(providers[0].id) : undefined}>
      <GraduationCap size={18} />
      Continue with university account
    </button>
  );

  return (
    <div className="flex h-full bg-surface overflow-auto">
      <BrandPanel />
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-10 min-w-0">
        <div className="lg:hidden mb-8 self-center">
          <Logo />
        </div>
        <form onSubmit={submit} className="w-full" style={{ maxWidth: 460 }} noValidate>
          <div role="tablist" aria-label="Log in or sign up" className="flex gap-7 border-b border-line mb-9">
            {(["login", "signup"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                className="t15 font-medium pb-3 -mb-px bg-transparent border-0 border-b-2"
                style={{ color: mode === m ? "var(--brand)" : "var(--muted)", borderBottomColor: mode === m ? "var(--brand)" : "transparent", borderBottomStyle: "solid" }}
                onClick={() => {
                  setMode(m);
                  setError(null);
                }}
              >
                {m === "login" ? "Log in" : "Sign up"}
              </button>
            ))}
          </div>

          <h2 className="font-bold m-0 mb-6" style={{ fontSize: "calc(28px * var(--ts))", letterSpacing: "-0.3px" }}>
            {signup ? "Create your account" : "Welcome back"}
          </h2>

          {providers.length > 0 ? (
            <>
              {providers.length === 1 ? (
                ssoButton
              ) : (
                <Popover>
                  <PopoverTrigger asChild>{ssoButton}</PopoverTrigger>
                  <PopoverContent align="center" width={300}>
                    <div className="menu-note">Your university signs you in with one of these.</div>
                    {providers.map((p) => (
                      <button key={p.id} type="button" className="menu-item" onClick={() => social(p.id)}>
                        Continue with {p.label}
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>
              )}
              <div className="flex items-center gap-3 my-6 t12 text-muted">
                <span className="h-px flex-1 bg-line" />
                {signup ? "or sign up with email" : "or log in with email"}
                <span className="h-px flex-1 bg-line" />
              </div>
            </>
          ) : null}

          {signup ? (
            <div className="mb-4">
              <label className="field-label" htmlFor="auth-name">
                Full name
              </label>
              <input id="auth-name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          ) : null}

          <div className="mb-4">
            <label className="field-label" htmlFor="auth-email">
              University email
            </label>
            <input id="auth-email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>

          <div className="mb-2">
            <label className="field-label" htmlFor="auth-password">
              Password
            </label>
            <div className="relative">
              <input
                id="auth-password"
                className="input"
                style={{ paddingRight: 86 }}
                type={show ? "text" : "password"}
                autoComplete={signup ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => setCaps(e.getModifierState("CapsLock"))}
                onKeyUp={(e) => setCaps(e.getModifierState("CapsLock"))}
                aria-describedby="auth-rules"
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5 t12 font-semibold text-brand bg-transparent border-0 px-2 py-1 rounded-md"
                onClick={() => setShow((v) => !v)}
                aria-pressed={show}
              >
                {show ? <EyeOff size={15} /> : <Eye size={15} />}
                {show ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <div id="auth-rules" className="t12 mb-4" style={{ minHeight: signup ? 78 : 0 }}>
            {caps ? (
              <div className="flex items-center gap-2 mb-1.5" style={{ color: "var(--warn-ink)" }} role="status">
                <TriangleAlert size={14} /> Caps Lock is on
              </div>
            ) : null}
            {signup
              ? RULES.map((r) => {
                  const ok = r.test(password);
                  return (
                    <div key={r.label} className="flex items-center gap-2 mb-1" style={{ color: ok ? "var(--brand)" : "var(--muted)" }}>
                      {ok ? <CircleCheck size={14} /> : <Circle size={14} />}
                      {r.label}
                      <span className="sr-only">{ok ? "(met)" : "(not met yet)"}</span>
                    </div>
                  );
                })
              : null}
          </div>

          <label className="flex items-center gap-2.5 t13 mb-5 cursor-pointer select-none">
            <span
              className="grid place-items-center rounded-[5px]"
              style={{ width: 18, height: 18, background: remember ? "var(--brand)" : "var(--surface)", border: `1.5px solid ${remember ? "var(--brand)" : "var(--line)"}` }}
            >
              {remember ? <Check size={13} color="var(--brand-ink)" strokeWidth={3} /> : null}
            </span>
            <input type="checkbox" className="sr-only" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Keep me signed in on this device
          </label>

          {error ? (
            <div className="t13 mb-4 px-3 py-2.5 rounded-lg bg-danger-bg text-danger" role="alert">
              {error}
            </div>
          ) : null}

          <button type="submit" className="btn btn-primary btn-lg w-full" disabled={!canSubmit}>
            {busy ? "One moment…" : signup ? "Create account" : "Log in"}
          </button>

          <p className="t13 text-muted mt-5 mb-0">
            {signup ? "Already have an account? " : "New to Margin? "}
            <button type="button" className="font-semibold text-brand bg-transparent border-0 p-0" onClick={() => setMode(signup ? "login" : "signup")}>
              {signup ? "Log in" : "Sign up"}
            </button>
          </p>
          {signup && config && !config.allowSignup ? <p className="t12 text-muted mt-3">New sign-ups are switched off on this server. Ask whoever runs it for an account.</p> : null}
        </form>
      </main>
    </div>
  );
}
