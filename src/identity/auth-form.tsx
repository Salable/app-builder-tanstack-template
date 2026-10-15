import { useEffect, useState, type FormEvent } from "react";
import { authClient } from "./auth-client";
import { announceSessionChange } from "./session-changes";

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
      announceSessionChange();
      onAuthenticated();
    } catch {
      setError("We could not reach the identity service. Please try again.");
    } finally {
      setPending(false);
    }
  }

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
        <label>
          Name
          <input
            name="name"
            autoComplete="name"
            maxLength={200}
            required
            disabled={disabled}
          />
        </label>
      )}
      <label>
        Email
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          disabled={disabled}
        />
      </label>
      <label>
        Password
        <input
          type="password"
          name="password"
          autoComplete={signingUp ? "new-password" : "current-password"}
          minLength={signingUp ? 8 : undefined}
          required
          disabled={disabled}
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={disabled}>
        {pending ? "Please wait…" : title}
      </button>
    </form>
  );
}
