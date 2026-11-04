# Monaid Agents API (v1)

The boundary between our agents (wallets, robot agents, guardrails, chain) and the teammates' **bridge** (MQTT ↔ HTTP,
`server/bridge` on `step/firmware-net`) and **portal**. Types: `shared/api-types.ts`.

- **Base URL:** `http://<laptop-ip>:4000` (the bridge's default `AGENTS_API=http://localhost:4000` works when it runs on
  the same laptop). Start with `npm run api` in `agents/` (`MONAID_API_HOST=0.0.0.0` to accept other machines).
- **Auth:** every request except `GET /health` needs header `x-monaid-token: <token>`. The owner shares the token value
  privately (it is `MONAID_API_TOKEN` in our `agents/.env`; the bridge calls it `MONAID_TOKEN`). `GET /feed` also accepts
  `?token=`.
- **Bodies:** JSON, max 16 KB. Responses: `{"ok": true, …}` or an error (below). Amounts are MON strings.
- **Latency:** an event that sends a transaction answers after it is confirmed (~1–5 s), with the tx link.

```sh
API=http://127.0.0.1:4000
TOKEN=...   # from the owner, never commit it
```

## Robots and workers

| Device (MQTT username) | robotId the bridge sends | Our robot id |
|---|---|---|
| tdeck-01 (T-Deck) | `1` | `tdeck-01` |
| watcher-01 (Watcher) | `2` | `watcher-01` |

`robotId` may be the number (`1`), the string (`"1"`), or our id (`"tdeck-01"`). Unknown → `404 UNKNOWN_ROBOT`.

**Workers** are identified by a short ID typed on the T-Deck (`claim` with `data.text`), matched case-insensitively.
Registered now: **`RAJ-7`, `DEMO-1`, `DEMO-2`** (all pay the demo-1 wallet `0x3D8117EE881F4e5Bc158A3428bdede3FcFcC4DD8` for
now). A Watcher `click` claims as `DEMO-1`. An unknown ID is ignored (200) and the device that sent it shows
`UNKNOWN WORKER`. The payout address always comes from our registry (`agents/workers.json`), never from the event.

## Errors

`{ "ok": false, "error": "<CODE>", "message": "…" }`

| HTTP | `error` | When |
|---|---|---|
| 400 | `BAD_REQUEST` | bad JSON / field, unknown `kind` |
| 401 | `UNAUTHORIZED` | missing or wrong token |
| 403 | `BLOCKED` | a guardrail said no (`code`: `PAYOUT_ABOVE_POLICY`, `DAILY_CAP`, `TOO_MANY_OPEN_JOBS`, `ACTION_NOT_ALLOWED`) |
| 404 | `UNKNOWN_ROBOT` / `UNKNOWN_WORKER` / `UNKNOWN_JOB` / `NOT_FOUND` | as named (`UNKNOWN_WORKER` only on `POST /jobs/:id/claim`) |
| 409 | `REFUSED` | DEPLOYER below its floor |
| 422 | `REVERTED` | MonaidCore said no (`code` = contract error, `link` if on-chain) |
| 503 | `KILL_SWITCH` | kill switch engaged: nothing is sent |
| 500 | `INTERNAL` | anything else (both RPCs down, …) |

## `POST /events` — one device event from the bridge

Exactly what the bridge posts:
```json
{ "robotId": 2, "kind": "crash", "seq": 71, "ts": 1793782787, "data": { "sim": true } }
```
- `seq`: per boot (resets on reboot); the bridge sends `0` for broker `up`/`down`. **Exact repeats** (same robot, kind,
  seq and data within 60 s — QoS 1 redelivery) are dropped: `200 {"action":"ignored","note":"duplicate …"}`.
- `ts`: integer unix seconds. `data`: object, untrusted input (only the fields below are read).
- **Every kind below returns 200**; ones with nothing to do return `"action": "ignored"` with a `note`.

| `kind` | Agent action (Down module) | `action` |
|---|---|---|
| `crash` (Watcher long-press) or `down` (broker LWT: power cut) | Trouble: if the robot has no open/claimed job, post a **0.01 MON** job, claim window **60 s** (`data.level: "urgent"` → 0.03 MON, which waits for the owner). Otherwise ignored. | `job_posted` / `pending_approval` / `ignored` |
| `claim` (T-Deck, `data.text` = worker ID; `data.worker` also accepted) or `click` (Watcher → `DEMO-1`) | Claims the **oldest open job on any robot** for that worker. Unknown worker → ignored + `UNKNOWN WORKER` on that device. | `claim_accepted` / `ignored` |
| `recover`, `power` with `data.on: true`, `power_on` | **Proof** for a claimed `crash` job on that robot → settle, worker paid. | `job_settled` / `ignored` |
| `heartbeat`, `up`, `power` (on), `power_on` | **Proof** for a claimed `down` job on that robot (first heartbeat after the device comes back). A heartbeat is *not* a proof for a `crash` job (the device never went offline). | `job_settled` / `ignored` |
| `knob`, `power` (off), `power_off`, `beacon_seen`, `key` | Logged; no action. | `ignored` |

No proof within the 60 s window → the agent **expires** the job (escrow back to the robot) → screens show `BLOCKED`.

```sh
curl -s -X POST $API/events -H "x-monaid-token: $TOKEN" -H "content-type: application/json" \
  -d '{"robotId":2,"kind":"crash","seq":71,"ts":1793782787,"data":{"sim":true}}'
```
```json
{ "ok": true, "robotId": "watcher-01", "seq": 71, "action": "job_posted", "jobId": "19", "payout": "0.01",
  "tx": { "hash": "0x…", "link": "https://testnet.monadscan.com/tx/0x…" } }
```
```sh
curl -s -X POST $API/events -H "x-monaid-token: $TOKEN" -H "content-type: application/json" \
  -d '{"robotId":1,"kind":"claim","seq":44,"ts":1793782790,"data":{"text":"RAJ-7"}}'
```
```json
{ "ok": true, "robotId": "tdeck-01", "seq": 44, "action": "claim_accepted", "jobId": "19", "worker": "raj-7",
  "tx": { "hash": "0x…", "link": "…" }, "note": "claimed robot watcher-01's job" }
```
```sh
curl -s -X POST $API/events -H "x-monaid-token: $TOKEN" -H "content-type: application/json" \
  -d '{"robotId":2,"kind":"recover","seq":72,"ts":1793782800,"data":{"sim":true}}'
```
```json
{ "ok": true, "robotId": "watcher-01", "seq": 72, "action": "job_settled", "jobId": "19", "worker": "demo-1", "payout": "0.01",
  "tx": { "hash": "0x…", "link": "…" } }
```
Ignored examples: `{"ok":true,"robotId":"tdeck-01","seq":12,"action":"ignored","note":"heartbeat: nothing to do"}`,
`{"ok":true,"robotId":"tdeck-01","seq":45,"action":"ignored","note":"unknown worker \"MALLORY\""}`.

## `GET /feed` — Server-Sent Events (screens + portal)

`curl -N -H "x-monaid-token: $TOKEN" $API/feed`. One JSON object per `data:` line; `: ping` comments every 15 s.

**Screen lines, in the bridge's format, sent to BOTH devices** for every job change:
```
data: {"type":"screen","robot":"watcher-01","robotId":1,"screen":{"state":"JOB OPEN"}}
data: {"type":"screen","robot":"watcher-01","robotId":2,"screen":{"state":"JOB OPEN"}}
data: {"type":"screen","robot":"watcher-01","robotId":1,"screen":{"cmd":"job","id":19,"payout":"0.01 MON","worker":""}}
data: {"type":"screen","robot":"watcher-01","robotId":1,"screen":{"state":"CLAIMED"}}
data: {"type":"screen","robot":"watcher-01","robotId":1,"screen":{"cmd":"job","id":19,"payout":"0.01 MON","worker":"DEMO-1"}}
data: {"type":"screen","robot":"watcher-01","robotId":1,"screen":{"state":"PAID"}}
data: {"type":"screen","robot":"watcher-01","robotId":1,"screen":{"say":"paid 0.01 MON to DEMO-1"}}
data: {"type":"screen","robot":"watcher-01","robotId":2,"screen":{"state":"BLOCKED"}}
data: {"type":"screen","robot":"watcher-01","robotId":2,"screen":{"say":"no fix in time"}}
data: {"type":"screen","robot":"tdeck-01","robotId":1,"screen":{"say":"UNKNOWN WORKER"}}
```
`robotId` is the bridge number; `robot` is the robot the job belongs to. States: `JOB OPEN`, `BIDDING` (waiting for the
owner), `CLAIMED`, `PAID`, `BLOCKED`, `IDLE` (cancelled). The job card's `worker` shows the worker's wallet as its registry
ID. Today's bridge forwards `screen.state` and `screen.say`; the job card needs a `cmd:"job"` branch in the bridge.

Other feed lines (for the portal): `event`, `job_posted`, `job_claimed`, `job_settled`, `job_expired`, `job_cancelled`,
`approval_requested`, `approval_decided`, `agent_decision` (with `by` and the agent's `reason`), `blocked`, `kill_switch`, `tx` (every transaction attempt
with `result` and explorer `link`). Job lines carry `robot` (our id) and `jobId`.

## `POST /jobs/:id/claim` — portal claim

```sh
curl -s -X POST $API/jobs/19/claim -H "x-monaid-token: $TOKEN" -H "content-type: application/json" -d '{"worker":"demo-2"}'
```
`{ "ok": true, "jobId": "19", "robotId": "watcher-01", "worker": "demo-2", "workerAddress": "0x3D81…4DD8", "claimDeadline": 1793782850, "tx": {…} }`
Worker IDs are case-insensitive (`DEMO-2` = `demo-2`); unknown → `404 UNKNOWN_WORKER`.

## Owner decisions

An urgent job (0.03 MON, above the 0.02 MON owner-approval threshold) waits as `pending_approval` (feed `approval_requested`).

- **`POST /owner/decide`** `{"approvalId":"…","decision":"approve"|"reject"}` — the portal's "owner decides" button, any time.
  → `{ "ok": true, "approvalId": "…", "decision": "approve", "jobId": "…", "tx": {…} }`
- **`POST /agent/decide`** (alias `/muse/decide`) — the **decision agent** decides: a model via OpenRouter
  (`anthropic/claude-haiku-5.5`, set in `agents/config.json` → `muse.model`). Its `by` label is **"Claude"** for a Claude
  model, otherwise **"AI agent"**. It only chooses, never sends a transaction; its pick then goes through every guardrail:
  - `{"approvalId":"…"}` → Claude picks approve/reject and we apply it:
    `{ "ok": true, "mode": "approval", "approvalId": "…", "agent": { "source": "agent", "by": "Claude", "choice": "approve", "reason": "…", "ms": 2100, "model": "anthropic/claude-haiku-5.5" }, "applied": { "ok": true, … } }`
  - `{"question":"…","options":[{"id":"robot-1","label":"…"},…]}` (2–8 options) → answer only: `{ "ok": true, "mode": "advice", "agent": {…} }`
  - If the agent is unavailable, slow (> 8 s), refuses, or answers invalidly (anything but one of the option ids as JSON): `"agent": { "source": "owner_decides", "by": "Claude", "fallback": "no_api_key" | "timeout" | "invalid_output" | "refusal" | "api_error", "detail": "…", "ms": 1 }`, `"applied": null` — the approval stays pending for `POST /owner/decide`.
- `GET /approvals[?status=pending]` → `{ "ok": true, "approvals": [ { "id", "robot", "action", "summary", "reason", "createdAt", "status" } ] }`

## Admin and reads

- `POST /admin/kill` `{"engaged":true,"reason":"…"}` / `{"engaged":false}` → `{ "ok": true, "engaged": …, "reason": …, "since": … }`. While engaged, anything that would send a transaction returns `503 KILL_SWITCH`.
- `POST /admin/reset-seq` `{}` (or `{"robotId":…}`) → clears the duplicate cache: `{ "ok": true, "reset": ["tdeck-01","watcher-01"] }`.
- `GET /robots` → `{ "ok": true, "core": "0x3DbE…3867", "killSwitch": {…}, "robots": [ { "robotId": "tdeck-01", "robotAddress", "agent", "agentAddress", "agentBalance", "balance", "escrow", "openJobs", "spentToday", "lastSeq", "lastEventAt" } ] }`
- `GET /jobs[?robotId=2]` → newest first: `{ "ok": true, "jobs": [ { "jobId", "robotId", "status", "payout", "claimWindow", "worker", "workerAddress", "claimDeadline", "postedAt", "txs": [ { "action", "hash", "link" } ] } ] }`
- `GET /workers` → `{ "ok": true, "workers": [ { "id": "demo-1", "address": "0x3D81…4DD8" }, … ] }`
- `GET /health` (no token) → `{ "ok": true, "service": "monaid-agents", "version": 1 }`

## Running it (owner)

```sh
cd agents
npm run api              # port 4000 (agents/config.json → api)
npm run reset:demo       # close jobs, robots to 0.5 MON, agents above floor, kill switch off, balances + links
npm run preflight        # RPC, wallets/floors, robots, contract = shared/, API on 4000, token, kill switch
npm run mock:bridge      # plays the bridge exactly: all kinds, happy path, fail path (~85 s)
npm run check:agent-decision   # one real decision via OpenRouter (needs OPENROUTER_API_KEY in agents/.env)
```
