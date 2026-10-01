const channelName = "application-session-changed";
const listeners = new Set<() => void>();
let sharedChannel: BroadcastChannel | undefined;

function notifyThisDocument(): void {
  for (const listener of listeners) listener();
}

/** Notifications contain no identity or credentials; the server must recheck them. */
export function announceSessionChange(): void {
  notifyThisDocument();
  const channel = sharedChannel ?? new BroadcastChannel(channelName);
  channel.postMessage("changed");
  if (channel !== sharedChannel) channel.close();
}

export function subscribeToSessionChanges(listener: () => void): () => void {
  if (!sharedChannel) {
    sharedChannel = new BroadcastChannel(channelName);
    sharedChannel.onmessage = ({ data }) => {
      if (data === "changed") notifyThisDocument();
    };
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      sharedChannel?.close();
      sharedChannel = undefined;
    }
  };
}
