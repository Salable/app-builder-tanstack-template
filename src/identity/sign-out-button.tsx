import { useState } from "react";
import { authClient } from "./auth-client";
import { announceSessionChange } from "./session-changes";
import { reportBrowserError } from "../runtime/browser-errors";

export function SignOutButton({
  onSignedOut,
  className,
}: {
  onSignedOut?: () => void | Promise<void>;
  className?: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    setPending(true);
    setError(null);
    try {
      const result = await authClient.signOut();
      if (result.error) {
        reportBrowserError(result.error, {
          operation: "identity.sign_out",
          code: "SIGN_OUT_FAILED",
          status: result.error.status,
        });
        setError("Sign-out failed. Please try again.");
        return;
      }
      announceSessionChange();
      await onSignedOut?.();
    } catch (error) {
      reportBrowserError(error, {
        operation: "identity.sign_out",
        code: "SIGN_OUT_FAILED",
      });
      setError("Sign-out failed. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        className={className}
        disabled={pending}
        onClick={() => void signOut()}
        type="button"
      >
        {pending ? "Signing out…" : "Sign out"}
      </button>
      {error && (
        <p role="alert" className="mt-3 text-red-700">
          {error}
        </p>
      )}
    </>
  );
}
