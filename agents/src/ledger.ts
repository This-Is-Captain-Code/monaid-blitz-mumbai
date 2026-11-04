// Local state for robot agents, persisted under agents/logs/ (git-ignored):
//   spend.jsonl — per-robot daily spend (+payout at post, −payout when cancelled/expired)
//   jobs.json   — jobs our agents posted, with their last known status
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AGENTS_DIR } from "./env.js";
import { CORE_ADDRESS } from "./chain.js";
import { utcDay } from "./funding.js";

const LOGS = join(AGENTS_DIR, "logs");
const SPEND = join(LOGS, "spend.jsonl");
const JOBS = join(LOGS, "jobs.json");

export type JobStatus = "Open" | "Claimed" | "Settled" | "Expired" | "Cancelled";
export type JobRecord = {
  jobId: string;
  robot: string;
  core: string; // MonaidCore address the job lives on
  payout: string; // wei
  claimWindow: number;
  status: JobStatus;
  worker?: string;
  claimDeadline?: number; // unix seconds
  postedAt: string;
  reason?: string;
  txs: { action: string; hash: string; link: string }[];
};

// ---- daily spend ----
export function recordSpend(robot: string, jobId: string, deltaWei: bigint, kind: string) {
  mkdirSync(LOGS, { recursive: true });
  appendFileSync(SPEND, JSON.stringify({ ts: new Date().toISOString(), day: utcDay(), robot, jobId, deltaWei: deltaWei.toString(), kind }) + "\n");
}

export function spentToday(robot: string): bigint {
  if (!existsSync(SPEND)) return 0n;
  const day = utcDay();
  let sum = 0n;
  for (const l of readFileSync(SPEND, "utf8").split("\n")) {
    if (!l) continue;
    const e = JSON.parse(l);
    if (e.day === day && e.robot === robot) sum += BigInt(e.deltaWei);
  }
  return sum > 0n ? sum : 0n;
}

// ---- jobs ----
function readJobs(): Record<string, JobRecord> {
  return existsSync(JOBS) ? JSON.parse(readFileSync(JOBS, "utf8")) : {};
}
const key = (jobId: string) => `${CORE_ADDRESS}:${jobId}`;

export function saveJob(job: JobRecord) {
  mkdirSync(LOGS, { recursive: true });
  const all = readJobs();
  all[key(job.jobId)] = job;
  writeFileSync(JOBS, JSON.stringify(all, null, 2));
}

export function getJobRecord(jobId: string): JobRecord | undefined {
  return readJobs()[key(jobId)];
}

/** Jobs on the current MonaidCore, optionally for one robot. */
export function listJobs(robot?: string): JobRecord[] {
  return Object.values(readJobs()).filter((j) => j.core === CORE_ADDRESS && (!robot || j.robot === robot));
}

export const openJobCount = (robot: string) => listJobs(robot).filter((j) => j.status === "Open" || j.status === "Claimed").length;
