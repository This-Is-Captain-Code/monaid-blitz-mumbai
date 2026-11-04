// Global kill switch: when engaged, sendTx refuses every send (robot agents, funding scripts, everything).
// Engage via env (MONAID_KILL=1 at startup) or engageKillSwitch() (the API's POST /admin/kill in P6).
// Note: this stops OUR sends. MonaidCore's on-chain pause() is the separate on-chain kill switch.
import { bus } from "./bus.js";

let state: { engaged: boolean; reason: string; since: string | null } = {
  engaged: process.env.MONAID_KILL === "1",
  reason: process.env.MONAID_KILL === "1" ? "MONAID_KILL=1 at startup" : "",
  since: process.env.MONAID_KILL === "1" ? new Date().toISOString() : null,
};

export class KillSwitchError extends Error {
  constructor(public readonly reason: string) {
    super(`Kill switch engaged (${reason}): no transactions are sent`);
    this.name = "KillSwitchError";
  }
}

export const killSwitch = () => ({ ...state });

export function engageKillSwitch(reason = "engaged by owner") {
  state = { engaged: true, reason, since: new Date().toISOString() };
  bus.emit("feed", { type: "kill_switch", engaged: true, reason });
}

export function releaseKillSwitch() {
  state = { engaged: false, reason: "", since: null };
  bus.emit("feed", { type: "kill_switch", engaged: false });
}

export function assertNotKilled() {
  if (state.engaged) throw new KillSwitchError(state.reason);
}
