import { useState, type FormEvent } from "react";
import { authClient } from "./auth-client";

type AuthMode = "sign-in" | "sign-up";

export function AuthForm({ mode }: { mode: AuthMode }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signingUp = mode === "sign-up";
  const title = signingUp ? "Create your account" : "Sign in";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const values = new FormData(event.currentTarget);
    const email = String(values.get("email") ?? "").trim();
    const password = String(values.get("password") ?? "");
    const name = String(values.get("name") ?? "").trim();
    if (signingUp && !name) {
      setError("Enter your name.");
      return;
    }
    setError(null);
    setPending(true);
    try {
      const result = signingUp
        ? await authClient.signUp.email({ email, password, name })
        : await authClient.signIn.email({ email, password });
      if (result.error) {
        setError(
          result.error.message || "We could not complete sign-in. Please try again.",
        );
        return;
      }
      // Reload the protected server route with the cookie just set by our origin.
      window.location.assign("/protected");
    } catch {
      setError("We could not reach the identity service. Please try again.");
    } finally {
      setPending(false);
    }
  }

  const inputClass =
    "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-950";
  return (
    <main className="min-h-screen bg-slate-50 px-5 py-10 text-slate-950">
      <section className="mx-auto w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <form
          className="mt-6 space-y-5"
          onSubmit={(event) => {
            void submit(event);
          }}
          aria-busy={pending}
        >
          {signingUp && (
            <label className="block font-medium">
              Name
              <input
                className={inputClass}
                name="name"
                autoComplete="name"
                maxLength={200}
                required
                disabled={pending}
              />
            </label>
          )}
          <label className="block font-medium">
            Email
            <input
              className={inputClass}
              type="email"
              name="email"
              autoComplete="email"
              required
              disabled={pending}
            />
          </label>
          <label className="block font-medium">
            Password
            <input
              className={inputClass}
              type="password"
              name="password"
              autoComplete={signingUp ? "new-password" : "current-password"}
              minLength={signingUp ? 8 : undefined}
              required
              disabled={pending}
            />
          </label>
          {error && (
            <p className="text-red-700" role="alert">
              {error}
            </p>
          )}
          <button
            className="w-full rounded-xl bg-slate-900 px-5 py-3 font-semibold text-white disabled:opacity-60"
            type="submit"
            disabled={pending}
          >
            {pending ? "Please wait…" : title}
          </button>
        </form>
        <p className="mt-6 text-slate-700">
          {signingUp ? "Already have an account? " : "Need an account? "}
          <a
            className="font-semibold text-violet-700 underline"
            href={signingUp ? "/auth/sign-in" : "/auth/sign-up"}
          >
            {signingUp ? "Sign in" : "Create an account"}
          </a>
        </p>
        <a className="mt-4 inline-block text-violet-700 underline" href="/">
          Return home
        </a>
      </section>
    </main>
  );
}
