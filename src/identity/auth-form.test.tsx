// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { AuthForm } from "./auth-form";
const mocks = vi.hoisted(() => ({ signIn: vi.fn(), signUp: vi.fn() }));
vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    signIn: { email: mocks.signIn },
    signUp: { email: mocks.signUp },
  }),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
describe("standard authentication forms", () => {
  it.each(["sign-in", "sign-up"] as const)(
    "hands successful %s back to the product's navigation",
    async (mode) => {
      const onAuthenticated = vi.fn();
      mocks.signIn.mockResolvedValue({ error: null });
      mocks.signUp.mockResolvedValue({ error: null });
      render(<AuthForm mode={mode} onAuthenticated={onAuthenticated} />);
      if (mode === "sign-up")
        fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Alex" } });
      fireEvent.change(screen.getByLabelText("Email"), {
        target: { value: "alex@example.test" },
      });
      fireEvent.change(screen.getByLabelText("Password"), {
        target: { value: "password-for-test" },
      });
      fireEvent.click(screen.getByRole("button"));
      await waitFor(() => expect(onAuthenticated).toHaveBeenCalledExactlyOnceWith());
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );
  it("rejects blank names before contacting the provider", () => {
    const onAuthenticated = vi.fn();
    const { container } = render(
      <AuthForm mode="sign-up" onAuthenticated={onAuthenticated} />,
    );
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "   " } });
    fireEvent.submit(container.querySelector("form")!);
    expect(screen.getByRole("alert").textContent).toBe("Enter your name.");
    expect(mocks.signUp).not.toHaveBeenCalled();
    expect(onAuthenticated).not.toHaveBeenCalled();
  });
  it("clears a rejected attempt on retry, prevents duplicate submission and supplies a safe missing-message error", async () => {
    const onAuthenticated = vi.fn();
    mocks.signIn.mockResolvedValueOnce({ error: {} });
    const { container } = render(
      <AuthForm mode="sign-in" onAuthenticated={onAuthenticated} />,
    );
    const form = container.querySelector("form")!;
    fireEvent.submit(form);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Please try again"),
    );
    let finish!: (value: unknown) => void;
    mocks.signIn.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(mocks.signIn).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
    finish({ error: null });
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledOnce());
  });
  it.each(["sign-in", "sign-up"] as const)(
    "keeps %s credentials disabled before hydration and out of URL submissions",
    (mode) => {
      const container = document.createElement("div");
      container.innerHTML = renderToString(
        <AuthForm mode={mode} onAuthenticated={vi.fn()} />,
      );
      const form = container.querySelector("form")!;
      expect(form.method).toBe("post");
      expect(form.querySelector<HTMLInputElement>('[name="email"]')!.disabled).toBe(
        true,
      );
      expect(form.querySelector<HTMLInputElement>('[name="password"]')!.disabled).toBe(
        true,
      );
      expect(
        form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled,
      ).toBe(true);
    },
  );
  it("submits one registration, keeps pending feedback visible, and explains provider rejection", async () => {
    let finish!: (value: unknown) => void;
    mocks.signUp.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<AuthForm mode="sign-up" onAuthenticated={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  Alex  " } });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "alex@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "password-for-test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create your account" }));
    expect(mocks.signUp).toHaveBeenCalledExactlyOnceWith({
      name: "Alex",
      email: "alex@example.test",
      password: "password-for-test",
    });
    expect(
      screen.getByRole("button", { name: "Please wait…" }).hasAttribute("disabled"),
    ).toBe(true);
    finish({ error: { message: "An account already exists for this email." } });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("already exists"),
    );
    expect(
      screen
        .getByRole("button", { name: "Create your account" })
        .hasAttribute("disabled"),
    ).toBe(false);
  });
  it("uses the existing account sign-in operation and preserves retry after a connection failure", async () => {
    mocks.signIn.mockRejectedValue(new Error("provider transport detail"));
    render(<AuthForm mode="sign-in" onAuthenticated={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "alex@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "password-for-test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Please try again"),
    );
    expect(mocks.signIn).toHaveBeenCalledExactlyOnceWith({
      email: "alex@example.test",
      password: "password-for-test",
    });
    expect(screen.queryByText("provider transport detail")).toBeNull();
  });
});
