// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { announceSessionChange, subscribeToSessionChanges } from "./session-changes";

it("notifies this document and other documents without sharing account data, then unsubscribes", async () => {
  const local = vi.fn();
  const unsubscribe = subscribeToSessionChanges(local);
  const other = new BroadcastChannel("application-session-changed");
  try {
    const message = new Promise<unknown>((resolve) => {
      other.onmessage = ({ data }) => resolve(data);
    });
    announceSessionChange();
    expect(local).toHaveBeenCalledOnce();
    expect(await message).toBe("changed");
    other.postMessage("unrelated");
    other.postMessage("changed");
    await vi.waitFor(() => expect(local).toHaveBeenCalledTimes(2));
    unsubscribe();
    announceSessionChange();
    expect(local).toHaveBeenCalledTimes(2);
  } finally {
    unsubscribe();
    other.close();
  }
});
