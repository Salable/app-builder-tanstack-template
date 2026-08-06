import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("selectable theme contrast", () => {
  it.each([
    ["light", "#6d28d9", "#f8fafc"],
    ["dark main", "#c4b5fd", "#020617"],
    ["dark section", "#c4b5fd", "#0f172a"],
  ])(
    "keeps violet text readable in the %s theme",
    async (theme, foreground, background) => {
      const css = await readFile(new URL("./styles.css", import.meta.url), "utf8");
      if (theme !== "light") expect(css).toContain(foreground);
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each([
    ["unpressed", "#f8fafc", "#334155"],
    ["pressed", "#0f172a", "#f8fafc"],
  ])(
    "keeps every dark theme selector control readable when %s",
    async (_state, foreground, background) => {
      const css = await readFile(new URL("./styles.css", import.meta.url), "utf8");
      expect(css).toContain(
        ':root[data-theme="dark"] .theme-selector-button[aria-pressed="true"]',
      );
      expect(css).toContain(foreground);
      expect(css).toContain(background);
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
    },
  );
});

function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const channels = hex
      .match(/[\da-f]{2}/gi)
      ?.map((value) => Number.parseInt(value, 16) / 255);
    if (channels === undefined) throw new Error(`Invalid color: ${hex}`);
    const [red, green, blue] = channels.map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
  };
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}
