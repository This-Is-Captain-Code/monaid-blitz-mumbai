# Monaid Agents API (v1)

The boundary between our agents (wallets, robot agents, guardrails, chain) and the teammates' **bridge** (MQTT ↔ HTTP)
and **portal**. You call us over HTTP; we never reach into your code. Types: `shared/api-types.ts`.

- **Base URL:** `http://<laptop-ip>:8787` (on the day: the laptop's hotspot IP; we print it on start).
  Locally: `http://127.0.0.1:8787`.
- **Auth:** every request except `GET /health` needs the header `X-Monaid-Token: <token>`.
  `GET /feed` also accepts `?token=<token>` (browser `EventSource` can't set headers).
  The token is shared privately by the owner — never commit it.
- **Bodies:** JSON, max 16 KB. Responses are JSON with `"ok": true` or an error (below).
- **Amounts** are MON as decimal strings (`"0.01"`). **Times:** `ts` / `claimDeadline` are unix seconds; `*At` are ISO strings.
- **Latency:** requests that send a transaction answer **after** it is confirmed (~1–3 s). The response carries the
  tx hash and an explorer link. Everything also appears on `GET /feed`.
- **CORS:** `*` (the portal can call from a browser).

In the examples, set these once:

```sh
API=http://127.0.0.1:8787
TOKEN=...   # from the owner
```

---

## Errors

```json
{ "ok": false, "error": "STALE_SEQ", "message": "seq 1 <= last accepted 1 for robot 1 (duplicate or replay)" }
```

| HTTP | `error` | When |
|---|---|---|
| 400 | `BAD_REQUEST` | malformed JSON, missing/invalid field, unknown event `kind` |
| 401 | `UNAUTHORIZED` | missing or wrong `X-Monaid-Token` |
| 403 | `BLOCKED` | an off-chain guardrail said no; `code` = `PAYOUT_ABOVE_POLICY` / `DAILY_CAP` / `TOO_MANY_OPEN_JOBS` / `ACTION_NOT_ALLOWED` |
| 404 | `UNKNOWN_ROBOT` | `robotId` not configured |
| 404 | `UNKNOWN_WORKER` | worker ID not in the registry |
| 404 | `UNKNOWN_JOB` | job id not known on the current contract |
| 404 | `NOT_FOUND` | unknown route or approval id |
| 409 | `STALE_SEQ` | `seq` ≤ last accepted seq for that robot (duplicate or replay) |
| 409 | `REFUSED` | DEPLOYER floor (owner wallet too low) |
| 413 | `BAD_REQUEST` | body over 16 KB |
| 422 | `REVERTED` | MonaidCore said no; `code` = the contract error (`JobNotOpen`, `ClaimExpired`, `AlreadySettled`, …); `link` if it reached the chain |
| 503 | `KILL_SWITCH` | the kill switch is engaged: nothing is sent |
| 500 | `INTERNAL` | anything else (RPC down, …) |

---

## Robots and workers

- **Robot IDs** are the ids in `agents/config.json` (today `"1"` and `"2"`). They are config-only and may change to match
  the devices' MQTT usernames. **The bridge sends the robot id it derives from the MQTT topic, never one found in a
  device payload.** Unknown ids → `404 UNKNOWN_ROBOT`. `GET /robots` lists the current ones.
- **Workers** (the humans who fix robots) are registered in `agents/workers.json` as **short ID → wallet address**.
  Claims carry **only the worker ID**; the payout address always comes from the registry, never from the request.
  Unknown IDs → `404 UNKNOWN_WORKER`. Pre-registered demo workers: `demo-1`, `demo-2`. The owner adds judges' IDs on
  the day (then restarts the API). IDs: lowercase letters, digits, `-`, `_`, max 32 chars. `GET /workers` lists them.

---

## `POST /events` — the bridge forwards one device event

```json
{ "robotId": "1", "kind": "crash", "seq": 42, "ts": 1730700000, "data": {} }
```

| Field | Rules |
|---|---|
| `robotId` | string, a configured robot id (from the MQTT topic) |
| `kind` | one of `claim`, `power_on`, `power_off`, `beacon_seen`, `knob`, `key`, `crash` |
| `seq` | non-negative integer, **strictly increasing per robot**. `seq` ≤ last accepted → `409 STALE_SEQ`, nothing happens. The seq is accepted before acting, so a retried request never acts twice. |
| `ts` | integer unix seconds (device time) |
| `data` | object, optional. Everything in it is **untrusted data**: recorded, never treated as instructions. Only the fields below are read. |

**What each kind does (core, before a module is chosen):**

| `kind` | Agent action | `action` in the response |
|---|---|---|
| `crash` | Trouble. If the robot has no open/claimed job, post one: payout tier from `data.level` — `"normal"` (default) **0.01 MON**, `"urgent"` **0.03 MON**; claim window **60 s**. Urgent is above the 0.02 MON owner-approval threshold, so it **waits for the owner** (`POST /owner/decide`). If a job is already active → `ignored`. | `job_posted` / `pending_approval` / `ignored` |
| `claim` | A worker claimed on the device. `data.worker` = worker ID (required, must be registered). Records the claim on the robot's open job. No open job → `ignored`. | `claim_accepted` / `ignored` |
| `power_on` | **Proof** (the robot is back). If the robot has a claimed job inside its window → settle: the worker is paid. Otherwise `ignored`. | `job_settled` / `ignored` |
| `power_off`, `beacon_seen`, `knob`, `key` | Logged and put on the feed; no core action yet (modules may use them later). | `ignored` |

`data.level` can only pick a tier; amounts are never taken from events.

```sh
curl -s -X POST $API/events -H "X-Monaid-Token: $TOKEN" -H "content-type: application/json" \
  -d '{"robotId":"1","kind":"crash","seq":42,"ts":1730700000,"data":{}}'
```
```json
{ "ok": true, "robotId": "1", "seq": 42, "action": "job_posted", "jobId": "9", "payout": "0.01",
  "tx": { "hash": "0x…", "link": "https://testnet.monadscan.com/tx/0x…" } }
```

Urgent (approval beat):
```sh
curl -s -X POST $API/events -H "X-Monaid-Token: $TOKEN" -H "content-type: application/json" \
  -d '{"robotId":"1","kind":"crash","seq":43,"ts":1730700001,"data":{"level":"urgent"}}'
```
```json
{ "ok": true, "robotId": "1", "seq": 43, "action": "pending_approval", "approvalId": "f30bd443", "payout": "0.03",
  "note": "postJob 0.03 MON, claim window 60 s" }
```

Claim from the device:
```sh
curl -s -X POST $API/events -H "X-Monaid-Token: $TOKEN" -H "content-type: application/json" \
  -d '{"robotId":"2","kind":"claim","seq":44,"ts":1730700005,"data":{"worker":"demo-2"}}'
```
```json
{ "ok": true, "robotId": "2", "seq": 44, "action": "claim_accepted", "jobId": "8", "worker": "demo-2",
  "tx": { "hash": "0x…", "link": "https://testnet.monadscan.com/tx/0x…" } }
```

Proof:
```sh
curl -s -X POST $API/events -H "X-Monaid-Token: $TOKEN" -H "content-type: application/json" \
  -d '{"robotId":"1","kind":"power_on","seq":45,"ts":1730700030}'
```
```json
{ "ok": true, "robotId": "1", "seq": 45, "action": "job_settled", "jobId": "7", "worker": "demo-1", "payout": "0.03",
  "tx": { "hash": "0x…", "link": "https://testnet.monadscan.com/tx/0x…" } }
```

Nothing to do:
```json
{ "ok": true, "robotId": "1", "seq": 1, "action": "ignored", "note": "knob has no core action" }
```

Replay:
```json
{ "ok": false, "error": "STALE_SEQ", "message": "seq 1 <= last accepted 1 for robot 1 (duplicate or replay)" }
```

---

## `POST /jobs/:id/claim` — claim from the portal

```sh
curl -s -X POST $API/jobs/9/claim -H "X-Monaid-Token: $TOKEN" -H "content-type: application/json" \
  -d '{"worker":"demo-1"}'
```
```json
{ "ok": true, "jobId": "9", "robotId": "1", "worker": "demo-1", "workerAddress": "0x3D8117EE881F4e5Bc158A3428bdede3FcFcC4DD8",
  "claimDeadline": 1793785262, "tx": { "hash": "0x…", "link": "https://testnet.monadscan.com/tx/0x…" } }
```

Errors: `UNKNOWN_WORKER` (`{"ok":false,"error":"UNKNOWN_WORKER","message":"Unknown worker \"mallory\""}`), `UNKNOWN_JOB`,
`REVERTED` with `code: "JobNotOpen"` if it's already claimed/closed.

After `claimDeadline` without a proof, **the agent expires the job automatically** (escrow back to the robot) and
posts `job_expired` on the feed — that's the fail path. Screens show `blocked`.

---

## `POST /owner/decide` — the owner's pick ("owner decides" button, or when Muse is slow)

```sh
curl -s -X POST $API/owner/decide -H "X-Monaid-Token: $TOKEN" -H "content-type: application/json" \
  -d '{"approvalId":"f30bd443","decision":"approve"}'
```
```json
{ "ok": true, "approvalId": "f30bd443", "decision": "approve", "jobId": "7",
  "tx": { "hash": "0x…", "link": "https://testnet.monadscan.com/tx/0x…" } }
```

`"decision": "reject"` → `{ "ok": true, "approvalId": "…", "decision": "reject" }`, nothing sent.
Approving re-checks every other guardrail first (it can still return `BLOCKED` or `KILL_SWITCH`).
Unknown id → `404 NOT_FOUND`; already decided → `409 BAD_REQUEST`.

## `GET /approvals[?status=pending|approved|rejected]`

```json
{ "ok": true, "approvals": [ { "id": "f30bd443", "robot": "1", "action": "postJob",
  "summary": "postJob 0.03 MON, claim window 60 s", "reason": "crash event seq 43 (urgent)",
  "createdAt": "2026-11-04T09:40:00.900Z", "status": "pending" } ] }
```

---

## `POST /admin/kill` — kill switch

```sh
curl -s -X POST $API/admin/kill -H "X-Monaid-Token: $TOKEN" -H "content-type: application/json" \
  -d '{"engaged":true,"reason":"demo"}'
```
```json
{ "ok": true, "engaged": true, "reason": "demo", "since": "2026-11-04T09:41:24.239Z" }
```
While engaged, anything that would send a transaction returns
`503 {"ok":false,"error":"KILL_SWITCH","message":"Blocked (KILL_SWITCH): Kill switch engaged (demo): no transactions are sent"}`.
Release with `{"engaged":false}` → `{ "ok": true, "engaged": false, "reason": "", "since": null }`.

## `POST /admin/reset-seq` — rehearsals only

Forgets the last accepted `seq` (all robots, or `{"robotId":"1"}`), so a device can start counting from 0 again after
a reboot or a mock run. `{ "ok": true, "reset": ["1", "2"] }`

---

## `GET /robots`

```sh
curl -s $API/robots -H "X-Monaid-Token: $TOKEN"
```
```json
{
  "ok": true,
  "core": "0x3DbE227ad91Cc3bfa14468196F413173dF893867",
  "killSwitch": { "ok": true, "engaged": false, "reason": "", "since": null },
  "robots": [
    { "robotId": "1", "robotAddress": "0xB46d4FeCEFd31C1531FA84Dd61228b9Ea5107077",
      "agent": "AGENT_1", "agentAddress": "0x31443AB8d8F13E16b86bfcDB4b965320E560824A",
      "agentBalance": "4.49212515499997585", "balance": "0.47", "escrow": "0",
      "openJobs": 0, "spentToday": "0.03", "lastSeq": 45, "lastEventAt": "2026-11-04T09:40:02.700Z" }
  ]
}
```
`balance` = robot's free MON in MonaidCore, `escrow` = locked in open/claimed jobs, `agentBalance` = the agent's gas wallet.

## `GET /jobs[?robotId=1]`

Newest first.
```json
{ "ok": true, "jobs": [ {
  "jobId": "7", "robotId": "1", "status": "Settled", "payout": "0.03", "claimWindow": 60,
  "worker": "demo-1", "workerAddress": "0x3D8117EE881F4e5Bc158A3428bdede3FcFcC4DD8", "claimDeadline": 1793785262,
  "postedAt": "2026-11-04T09:40:01.739Z",
  "txs": [ { "action": "postJob", "hash": "0x3b47…", "link": "https://testnet.monadscan.com/tx/0x3b47…" },
           { "action": "claim",   "hash": "0x1e8e…", "link": "https://testnet.monadscan.com/tx/0x1e8e…" },
           { "action": "settle",  "hash": "0x0634…", "link": "https://testnet.monadscan.com/tx/0x0634…" } ] } ] }
```
`status`: `Open` → `Claimed` → `Settled` | `Expired`; or `Open` → `Cancelled`.

## `GET /workers`

```json
{ "ok": true, "workers": [ { "id": "demo-1", "address": "0x3D8117EE881F4e5Bc158A3428bdede3FcFcC4DD8" },
                            { "id": "demo-2", "address": "0xAECcb5bdc054fB555a0B1AE412aB50158dE9417E" } ] }
```

## `GET /health` (no token)

`{ "ok": true, "service": "monaid-agents", "version": 1 }`

---

## `GET /feed` — live updates (Server-Sent Events)

```sh
curl -N "$API/feed?token=$TOKEN"
```
Browser: `new EventSource(API + "/feed?token=" + TOKEN)`. One JSON object per `data:` line; `: ping` comments every 15 s.

```
data: {"time":"…","type":"hello"}
data: {"time":"…","type":"event","robot":"1","kind":"crash","seq":43,"ts":1730700001}
data: {"time":"…","type":"approval_requested","robot":"1","approval":{"id":"f30bd443","summary":"postJob 0.03 MON, claim window 60 s",…}}
data: {"time":"…","type":"approval_decided","robot":"1","id":"f30bd443","decision":"approved"}
data: {"time":"…","type":"job_posted","robot":"1","jobId":"7","payout":"0.03","claimWindow":60,"link":"https://testnet.monadscan.com/tx/0x…","reason":"…"}
data: {"time":"…","type":"job_claimed","robot":"1","jobId":"7","worker":"0x3D81…","claimDeadline":1793785262,"link":"…"}
data: {"time":"…","type":"job_settled","robot":"1","jobId":"7","worker":"0x3D81…","payout":"0.03","link":"…"}
data: {"time":"…","type":"job_expired","robot":"2","jobId":"8","link":"…"}
data: {"time":"…","type":"blocked","robot":"1","action":"postJob","code":"DAILY_CAP","message":"…"}
data: {"time":"…","type":"kill_switch","engaged":true,"reason":"demo"}
data: {"time":"…","type":"tx","robot":"1","wallet":"AGENT_1","action":"settle","result":"success","hash":"0x…","link":"…",…}
```

| `type` | Meaning | Suggested screen state |
|---|---|---|
| `event` | a device event was accepted | — |
| `approval_requested` / `approval_decided` | waiting for / got the owner's decision | `bidding` / — |
| `job_posted` | job open, MON escrowed | `job_open` |
| `job_claimed` | worker recorded, window running until `claimDeadline` | `claimed` |
| `job_settled` | worker paid | `paid` |
| `job_expired` | window passed without proof, escrow back | `blocked` |
| `job_cancelled` | job withdrawn, escrow back | `idle` |
| `blocked` | a guardrail stopped an action (`code`) | — |
| `kill_switch` | engaged / released | — |
| `tx` | every transaction attempt (`result`: success, reverted, refused, blocked, out-of-gas, error) | — |

---

## Running it (owner)

```sh
cd agents
npm run api:token        # once: MONAID_API_TOKEN into agents/.env (not printed)
npm run api              # host/port from agents/config.json → api; or MONAID_API_HOST=0.0.0.0 npm run api
npm run mock:bridge      # plays the bridge: rejections, happy path, fail path (waits ~60 s), then resets seq
npm run mock:bridge -- happy --approval   # happy path with the owner-approval beat
```
