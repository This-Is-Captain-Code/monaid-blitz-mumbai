# Monaid — Project Brief for Claude Code

**First aid for robots, paid in MON.** A robot in trouble posts a job, a human fixes it, and payment
releases on a physical proof that the device itself signs. Hackathon: Monad Blitz. ~7 hours total.

## Team split

- **Firmware (A)** — teammate. ESP32 boards: LilyGo T-Deck + Watcher.
- **Server (B) and Contracts (C)** — me, with you (Claude Code). This repo's work is B and C.

## Non-negotiable rules

1. **Devices never think.** They sense, sign, show, obey. No logic or decisions on devices.
2. **All agents live on the server.** One agent per robot, each with its own wallet. Muse is the owner's agent.
3. **The chain gates money. It is not a log.** Only things that move or lock money go on-chain.
   Heartbeats and chatter stay off-chain unless a module needs them as proof.
4. **Everything in MON** (native token). No ERC-20s, no USDC.
5. **One network:** a phone hotspot. Devices, laptop, phone all on it.
6. **Every revert is a demo beat.** Revert messages must be short and human-readable
   (custom errors with clear names, e.g. `JobNotClaimed`, `StaleNonce`, `ProofTooLate`).

## Modules (one core, one module chosen for the demo; core first)

- **Charger** — two robots auction one charger; human paid to swap cable; proof = winner sees USB power.
- **Lost** — lost robot posts a bounty rising per block; proof = both devices see each other over BLE (two signatures).
- **Down** — robots heartbeat and watch each other; technician revives one; proof = first heartbeat after the fix.

Do not build any module until the core is deployed and tested.

## Repo layout

```
contracts/   Hardhat 2 + viem (already set up). Solidity + TypeScript tests.
server/      TypeScript + viem: broker, signature checks, agents, Muse bridge, portal.
firmware/    Teammate's ESP32 code. Do not edit unless I ask.
shared/      Message spec, ABIs, deployed addresses (addresses.json). Single source of truth.
docs/        Notes, demo script.
```

Toolchain notes: Node 20 (so Hardhat 2, not 3). TypeScript pinned to 5.8.

## Git rules

- **One folder per commit.** A commit touches only one top-level folder (`contracts/`, `server/`, `shared/`, `docs/`).
  Exception: root config files (`.gitignore`, `CLAUDE.md`, root README) go in their own `chore:` commit.
- Message format: `<folder>: <what changed>` e.g. `contracts: add MonaidCore v0 with fund and pay`.
- Small commits, each one leaving the build and tests passing.
- Work on a branch per step; never commit to main directly. Ask me before opening PRs or merging.
- Never commit `.env`, keys, or keystores. Check `git status` before every commit.

## Network facts (Monad testnet)

- Chain ID `10143`, gas token MON (18 decimals). RPC `https://testnet-rpc.monad.xyz`
  (≈50 rps, only 25 rps for `eth_call`/`eth_estimateGas`). Backup RPC: `https://rpc.ankr.com/monad_testnet`.
- Explorers: `https://testnet.monadscan.com`, `https://testnet.monadvision.com`.
- Faucet: `https://faucet.monad.xyz` (web page; I claim manually).
- **Gas is charged on the gas LIMIT, not gas used.** Always estimate and add a small margin (~15%).
  Never set big fixed gas limits.
- **Reserve balance:** Monad has a reserve-balance rule (docs mention 10 MON). Before funding agent wallets,
  check docs.monad.xyz on how it affects spending, and keep server wallets generously funded.
  If a tx fails strangely on a low balance, check this first.
- Testnet was reset on 2025-12-16. Only trust addresses from docs.monad.xyz or ones we deploy.
- Finality is sub-second; treat a receipt as final for demo purposes.

## Signed message (draft — finalized at the hour-2 signing gate)

One canonical message for every module. Device signs the **raw keccak256 digest, no "\x19Ethereum Signed Message" prefix**.

```
digest = keccak256(abi.encodePacked(
  uint256 chainId,        // 10143 — domain separation
  address core,           // MonaidCore address — domain separation
  uint8   module,         // 0 core, 1 charger, 2 lost, 3 down
  uint8   kind,           // event type (claim, power_on, beacon_seen, heartbeat, ...)
  address robot,          // device address (signer)
  uint256 jobId,
  uint64  nonce,          // strictly increasing per device, survives reboot
  uint64  timestamp,      // device time, synced before signing
  bytes32 payload         // module-specific data
))
```

- Contract recovers with OpenZeppelin `ECDSA.recover(digest, sig)` (rejects malleable high-s signatures). Do NOT use
  `toEthSignedMessageHash`.
- Contract rejects any nonce ≤ last accepted nonce for that robot (gaps allowed, reuse not).
- Server builds the identical digest in TypeScript (viem `encodePacked` + `keccak256`) and verifies before submitting.
- Keep a fixed test vector in `shared/` (known key, fields, expected digest and signature) that contracts, server,
  and firmware all test against.
- **Fallback:** if on-device signing doesn't pass the gate by end of hour 2, the server signs with a per-robot key it
  holds. Same message, same contract — only the signer location changes.

## Contracts plan

Core (`MonaidCore`): register robot, fund robot (payable), post job, claim (time-locked), settle on proof, reject old nonces.
Guardrails on-chain: per-job max payout, robot balance must cover payout (escrowed at post time),
only the robot's registered agent can post/cancel, claim expires after a timeout, owner can pause.

Modules later:
- Charger: bid, settle second-price, attest charging, release.
- Lost: post bounty rising per block, set cap, attest home with both signatures, cancel.
- Down: heartbeat, flag down, set price, settle on first heartbeat after claim.

## Reporting rules (always)

Tell me clearly, every time:
- Every **address** you create (and what it is for). Never the private key.
- Every **on-chain transaction**: what it does, the tx hash, and an explorer link.
- **MON spent** per step and remaining balances of our wallets.
- Any change to `.env`, `.gitignore`, or anything touching keys.
- Anything you install, upgrade or pin, and why.
- Any **deviation** from this brief, before you do it, not after.
- When you need me to do something by hand (faucet, phone, hardware), stop and say so plainly.

## Gates and plan (for context)

- Hour 1: link layer, broker, core contract, funding → both boards online, heartbeats flowing, wallets funded.
- Hour 2: signing gate → one device-signed message verifies on server AND chain, else server-side signing.
- Hour 3: events, commands, screens; agents, watcher; portal.
- Hour 4: module sensor; Muse bridge; module contract.
- Hour 5: end to end → one full happy path and one full fail path.
- Hour 6: buffer. Hour 7: rehearse three times.
