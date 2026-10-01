// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignOutButton } from "./sign-out-button";

const signOut = vi.hoisted(() => vi.fn());
vi.mock("better-auth/react", () => ({ createAuthClient: () => ({ signOut }) }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("shared sign-out control", () => {
  it("waits for provider completion before invoking the product's navigation", async () => {
    let finish!: (value: unknown) => void;
    signOut.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const onSignedOut = vi.fn();
    render(<SignOutButton onSignedOut={onSignedOut} className="product-button" />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    fireEvent.click(screen.getByRole("button", { name: "Signing out…" }));
    expect(signOut).toHaveBeenCalledOnce();
    expect(onSignedOut).not.toHaveBeenCalled();
    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
    finish({ error: null });
    await waitFor(() => expect(onSignedOut).toHaveBeenCalledExactlyOnceWith());
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it.each(["rejection", "transport", "navigation"])(
    "allows retry after a %s failure without exposing internal details",
    async (failure) => {
      const onSignedOut = vi.fn();
      if (failure === "transport")
        signOut.mockRejectedValueOnce(new Error("private provider detail"));
      else
        signOut.mockResolvedValueOnce({
          error:
            failure === "rejection" ? { message: "private provider detail" } : null,
        });
      if (failure === "navigation")
        onSignedOut.mockRejectedValueOnce(new Error("private navigation detail"));
      render(<SignOutButton onSignedOut={onSignedOut} />);
      fireEvent.click(screen.getByRole("button"));
      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toBe(
          "Sign-out failed. Please try again.",
        ),
      );
      expect(screen.getByRole("button").hasAttribute("disabled")).toBe(false);
      if (failure !== "navigation") expect(onSignedOut).not.toHaveBeenCalled();
      signOut.mockResolvedValueOnce({ error: null });
      fireEvent.click(screen.getByRole("button"));
      await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
      await waitFor(() =>
        expect(onSignedOut).toHaveBeenCalledTimes(failure === "navigation" ? 2 : 1),
      );
    },
  );
});
