import { installExternalNetworkDeny } from "./network-deny";

if (process.env.NODE_ENV !== "test") {
  throw new Error("The network-deny preload may only run in tests.");
}

installExternalNetworkDeny();
