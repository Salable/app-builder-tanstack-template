// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProjectNameForm } from "./index";

describe("project name validation accessibility", () => {
  it("associates the error and exposes the input as invalid", async () => {
    render(<ProjectNameForm />);

    fireEvent.change(screen.getByLabelText("Project name"), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Validate" }));

    const input = screen.getByLabelText("Project name");
    const error = await screen.findByRole("alert");
    expect(error.textContent).toBe("Use at least three characters.");
    expect(input.getAttribute("aria-describedby")).toBe(error.id);
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });
});
