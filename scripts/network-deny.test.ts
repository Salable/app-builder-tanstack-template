import https from "node:https";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { installExternalNetworkDeny } from "./network-deny";

let restore: (() => void) | undefined;

afterEach(() => restore?.());

describe("external network deny", () => {
  it("rejects https.get before opening an external connection", () => {
    restore = installExternalNetworkDeny();
    expect(() => https.get("https://example.com")).toThrow(
      "External network access denied during integration tests: example.com",
    );
  });

  it("rejects a direct external socket connection", () => {
    restore = installExternalNetworkDeny();
    expect(() => net.connect(443, "example.com")).toThrow(
      "External network access denied during integration tests: example.com",
    );
  });
});
