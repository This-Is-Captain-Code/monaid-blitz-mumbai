# Server (B)

Node + ethers. The only place keys live.

- `src/mqtt/` — broker client: maps topic → device (per-device credentials + ACLs),
  validates events, publishes commands (show job / show state / say / simulate).
- `src/agents/` — one agent per robot, each with its own wallet; decides nothing
  the devices should, everything they shouldn't.
- `src/chain/` — contract bindings; turns verified device events into proofs on Monad.
- `src/portal/` — jobs, claims, the "owner decides" button (fallback when the AI pick is slow).
  Worker selection itself is a Claude API call inside the teammate's agents service, not here.

Broker config (mosquitto passwd/ACL files) lives in `broker/`.
