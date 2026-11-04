// Offline checks for sendTx's error handling (no RPC, no gas).  npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { BaseError, HttpRequestError, encodeErrorResult, RawContractError, TimeoutError } from "viem";
import { CORE_ABI } from "../src/chain.js";
import { decodeRevert, isNetworkError, isOutOfGas } from "../src/tx.js";

const revertWith = (errorName: string, args: readonly unknown[] = []) =>
  new BaseError("Execution reverted", {
    cause: new RawContractError({ data: encodeErrorResult({ abi: CORE_ABI, errorName, args }) }),
  });

test("custom errors decode to readable names with args", () => {
  assert.deepEqual(decodeRevert(revertWith("NotRobotAgent")), { name: "NotRobotAgent", args: [] });
  assert.deepEqual(decodeRevert(revertWith("InsufficientBalance", [5n, 7n])), { name: "InsufficientBalance", args: [5n, 7n] });
  assert.deepEqual(decodeRevert(revertWith("Paused")), { name: "Paused", args: [] });
});

test("unknown selectors still produce a label, plain errors produce nothing", () => {
  const unknown = new BaseError("x", { cause: new RawContractError({ data: "0xdeadbeef" }) });
  assert.equal(decodeRevert(unknown)?.name, "UnknownError(0xdeadbeef)");
  assert.equal(decodeRevert(new Error("boom")), undefined);
});

test("network errors are retryable; reverts are not", () => {
  assert.equal(isNetworkError(new HttpRequestError({ url: "https://rpc", status: 503 })), true);
  assert.equal(isNetworkError(new TimeoutError({ body: {}, url: "https://rpc" })), true);
  assert.equal(isNetworkError(new Error("fetch failed")), true);
  assert.equal(isNetworkError(new Error("429 Too Many Requests")), true);
  assert.equal(isNetworkError(revertWith("NotRobotAgent")), false);
  assert.equal(isNetworkError(new Error("execution reverted")), false);
});

test("out-of-gas is told apart from a revert (triggers one retry with estimation)", () => {
  assert.equal(isOutOfGas(new Error("out of gas")), true);
  assert.equal(isOutOfGas(new Error("gas required exceeds allowance (30000)")), true);
  assert.equal(isOutOfGas(new Error("intrinsic gas too low")), true);
  assert.equal(isOutOfGas(revertWith("ClaimExpired")), false);
  assert.equal(isOutOfGas(new Error("execution reverted")), false);
  assert.equal(isOutOfGas(undefined), false);
});
