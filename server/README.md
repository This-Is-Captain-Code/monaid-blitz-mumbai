# Server (B)

Node + ethers. The only place keys live.

- `src/mqtt/` — broker client: maps topic → device (per-device credentials + ACLs),
  validates events, publishes commands (show job / show state / say / simulate).
- `src/agents/` — one agent per robot, each with its own wallet; decides nothing
  the devices should, everything they shouldn't.
- `src/chain/` — contract bindings; turns verified device events into proofs on Monad.
- `src/muse/` — WhatsApp-link bridge: owner forwards to Muse, Muse's pick comes back.
- `src/portal/` — jobs, claims, the "owner decides" button for when Muse is slow.

Broker config (mosquitto passwd/ACL files) lives in `broker/`.
