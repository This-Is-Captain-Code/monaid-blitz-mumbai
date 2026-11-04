// In-process event bus. Robot agents and guardrails emit "feed" events (job/tx updates, blocks, approvals);
// the Agents API (P6) streams them to teammates' screens/portal over SSE.
import { EventEmitter } from "node:events";

export type FeedEvent = { type: string; robot?: string; [k: string]: unknown };

class Bus extends EventEmitter {
  emit(event: "feed", payload: FeedEvent): boolean {
    return super.emit(event, { time: new Date().toISOString(), ...payload });
  }
}

export const bus = new Bus();
bus.setMaxListeners(100);
