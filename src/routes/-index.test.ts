import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ThemeSelector, healthStatusText } from "./index";

describe("runtime health proof", () => {
  it("never presents a failed API request as healthy", () => {
    expect(healthStatusText({ data: undefined, isError: true, isPending: false })).toBe(
      "Foundation status: unavailable",
    );
  });

  it("renders an explicit loading state", () => {
    expect(healthStatusText({ data: undefined, isError: false, isPending: true })).toBe(
      "Foundation status: checking…",
    );
  });

  it("reports a healthy foundation without exposing internal proof terminology", () => {
    expect(
      healthStatusText({
        data: { status: "ok", version: 1 },
        isError: false,
        isPending: false,
      }),
    ).toBe("Foundation status: ready");
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
