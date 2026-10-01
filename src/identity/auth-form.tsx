import { useEffect, useState, type FormEvent } from "react";
import { authClient } from "./auth-client";

type AuthMode = "sign-in" | "sign-up";

export function AuthForm({
  mode,
  onAuthenticated,
  className,
}: {
  mode: AuthMode;
  onAuthenticated: () => void;
  className?: string;
}) {
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setReady(true), []);
  const disabled = !ready || pending;
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
      // Navigation belongs to the product; session establishment stays shared.
      onAuthenticated();
    } catch {
      setError("We could not reach the identity service. Please try again.");
    } finally {
      setPending(false);
    }
  }

  const inputClass =
    "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-950";
  return (
    <form
      className={className}
      method="post"
      onSubmit={(event) => {
        void submit(event);
      }}
      aria-busy={disabled}
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
            disabled={disabled}
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
          disabled={disabled}
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
          disabled={disabled}
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
        disabled={disabled}
      >
        {pending ? "Please wait…" : title}
      </button>
    </form>
  );
}
