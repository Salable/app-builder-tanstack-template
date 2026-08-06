import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ThemeSelector, healthStatusText, projectFormSchema } from "./index";

describe("runtime health proof", () => {
  it("never presents a failed API request as healthy", () => {
    expect(healthStatusText({ data: undefined, isError: true, isPending: false })).toBe(
      "Public API: unavailable",
    );
  });

  it("renders an explicit loading state", () => {
    expect(healthStatusText({ data: undefined, isError: false, isPending: true })).toBe(
      "Public API: checking…",
    );
  });
});

describe("theme selector", () => {
  it.each(["light", "dark", "system"] as const)(
    "renders all controls and exposes the selected %s state",
    (theme) => {
      const markup = renderToStaticMarkup(
        createElement(ThemeSelector, { setTheme: () => undefined, theme }),
      );
      expect(markup).toContain('aria-label="Theme"');
      expect(markup).toContain('role="group"');
      expect(markup.match(/<button/g)).toHaveLength(3);
      expect(markup).toMatch(new RegExp(`aria-pressed="true"[^>]*>${theme}</button>`));
      expect(markup.match(/class="theme-selector-button/g)).toHaveLength(3);
    },
  );
});

describe("project form boundary", () => {
  it("rejects names longer than the API maximum", () => {
    const result = projectFormSchema.safeParse({ name: "a".repeat(101) });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Use no more than 100 characters.");
  });
});
