import { randomUUID } from "node:crypto";
import { devices, expect, type Page } from "@playwright/test";
import { test } from "./auth.fixture.ts";

const password = "Isolated-browser-password-2026!";

for (const authMode of ["SELF_HOSTED_BETTER_AUTH", "NEON_AUTH"] as const) {
  test.describe(authMode, () => {
    test.use({ authMode });
    test("waits for hydration before accepting credentials and shows a rejected sign-in", async ({
      page,
      authApplication,
    }) => {
      const { origin } = authApplication;
      let releaseScripts!: () => void;
      const scriptsReady = new Promise<void>((resolve) => {
        releaseScripts = resolve;
      });
      await page.route("**/*", async (route) => {
        if (route.request().resourceType() === "script") await scriptsReady;
        await route.continue();
      });
      try {
        await page.goto(`${origin}/auth/sign-in`, { waitUntil: "commit" });
        const email = page.getByLabel("Email", { exact: true });
        const secret = page.getByLabel("Password", { exact: true });
        const submit = page.getByRole("button", { name: "Sign in", exact: true });
        await expect(submit).toBeVisible();
        await expect(submit).toBeDisabled();
        await expect(email).toBeDisabled();
        await expect(secret).toBeDisabled();
        await expect(page.locator("form")).toHaveAttribute("method", "post");

        releaseScripts();
        await expect(email).toBeEnabled();
        await email.fill("unknown@example.test");
        await secret.fill("wrong-password");
        const response = page.waitForResponse(
          (candidate) =>
            new URL(candidate.url()).pathname === "/api/auth/sign-in/email" &&
            candidate.request().method() === "POST",
        );
        await submit.click();
        expect((await response).status()).toBe(401);
        await expect(page.getByRole("alert")).toHaveText(
          /invalid email or password\.?/i,
        );
        await expect(submit).toBeEnabled();
        await expect(page).toHaveURL(`${origin}/auth/sign-in`);
      } finally {
        releaseScripts();
      }
    });
    test("registers, refreshes, signs in and out, and rejects revoked sessions without mixing users", async ({
      page,
      context,
      browser,
      authApplication,
    }, testInfo) => {
      test.setTimeout(60_000);
      const { origin } = authApplication;
      const aliceEmail = `alice-${randomUUID()}@example.test`;
      const bobEmail = `bob-${randomUUID()}@example.test`;
      const bobContext = await browser.newContext(
        devices[
          testInfo.project.name.includes("mobile") ? "Pixel 7" : "Desktop Chrome"
        ],
      );
      const bob = await bobContext.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      bob.on("pageerror", (error) => errors.push(error.message));
      try {
        await page.goto(`${origin}/protected`);
        await expect(
          page.getByRole("heading", { name: "Authentication required" }),
        ).toBeVisible();
        await Promise.all([
          register(page, origin, "Alice", aliceEmail),
          register(bob, origin, "Bob", bobEmail),
        ]);
        await Promise.all([page.reload(), bob.reload()]);
        await expectIdentity(page, "Alice", aliceEmail);
        await expectIdentity(bob, "Bob", bobEmail);
        await expect(page.getByText(bobEmail, { exact: false })).toHaveCount(0);
        await expect(bob.getByText(aliceEmail, { exact: false })).toHaveCount(0);

        // Chromium accepts Secure cookies on loopback. Inspect its full jar:
        // Playwright's URL filter omits those cookies for an http:// URL.
        const cookies = await context.cookies();
        expect(cookies).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              name: expect.stringContaining("session_token"),
              domain: "127.0.0.1",
              path: "/",
              httpOnly: true,
            }),
          ]),
        );
        await testInfo.attach("authenticated-account", {
          body: await page.screenshot({ fullPage: true }),
          contentType: "image/png",
        });
        await page.getByRole("button", { name: "Sign out", exact: true }).click();
        await expect(
          page.getByRole("heading", { name: "Authentication required" }),
        ).toBeVisible();
        await page.reload();
        await expect(
          page.getByRole("heading", { name: "Authentication required" }),
        ).toBeVisible();
        await bob.reload();
        await expectIdentity(bob, "Bob", bobEmail);

        await page.getByRole("link", { name: "Sign in", exact: true }).click();
        await page.getByLabel("Email", { exact: true }).fill(aliceEmail);
        await page.getByLabel("Password", { exact: true }).fill("wrong-password");
        await page.getByRole("button", { name: "Sign in", exact: true }).click();
        await expect(page.getByRole("alert")).toBeVisible();
        await expect(page).toHaveURL(`${origin}/auth/sign-in`);
        await page.getByLabel("Password", { exact: true }).fill(password);
        await page.getByRole("button", { name: "Sign in", exact: true }).click();
        await expect(page).toHaveURL(`${origin}/protected`);
        await expectIdentity(page, "Alice", aliceEmail);

        await authApplication.revokeSessions(aliceEmail);
        await page.reload();
        await expect(
          page.getByRole("heading", { name: "Authentication required" }),
        ).toBeVisible();
        const privateApi = await context.request.get(
          `${origin}/api/v1/projects/550e8400-e29b-41d4-a716-446655440000/protected-feature`,
          { headers: { "API-Version": "1" } },
        );
        expect(privateApi.status()).toBe(401);
        await bob.reload();
        await expectIdentity(bob, "Bob", bobEmail);
        await bob.getByRole("button", { name: "Sign out", exact: true }).click();
        await expect(
          bob.getByRole("heading", { name: "Authentication required" }),
        ).toBeVisible();
        expect(errors).toEqual([]);
      } finally {
        await bobContext.close();
      }
    });
  });
}

async function register(page: Page, origin: string, name: string, email: string) {
  await page.goto(`${origin}/auth/sign-up`);
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create your account", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/protected`);
  await expectIdentity(page, name, email);
}

async function expectIdentity(page: Page, name: string, email: string) {
  await expect(
    page.getByText(`Signed in as ${name} (${email}).`, { exact: true }),
  ).toBeVisible();
}
