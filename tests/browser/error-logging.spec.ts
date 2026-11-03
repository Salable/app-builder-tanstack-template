import { expect } from "@playwright/test";
import { test } from "./auth.fixture.ts";

test("installed browser handlers retain safe diagnostics for an unexpected failure", async ({
  page,
  authApplication,
}) => {
  const records: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      message.text().includes('"event":"application_error"')
    )
      records.push(message.text());
  });
  await page.goto(`${authApplication.origin}/auth/sign-in`);
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => {
    setTimeout(() => {
      throw new TypeError("private runtime details");
    }, 0);
    void Promise.reject(new Error("private rejected promise"));
  });
  await expect.poll(() => records.length).toBe(2);
  expect(records.map((record) => JSON.parse(record).code).sort()).toEqual([
    "UNHANDLED_BROWSER_ERROR",
    "UNHANDLED_REJECTION",
  ]);
  expect(records.join("\n")).not.toContain("private");
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeEnabled();
});
