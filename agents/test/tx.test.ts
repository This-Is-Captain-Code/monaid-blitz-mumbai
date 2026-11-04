// Offline checks for sendTx's error handling (no RPC, no gas).  npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { BaseError, HttpRequestError, encodeErrorResult, RawContractError, TimeoutError } from "viem";
import { CORE_ABI } from "../src/chain.js";
import { decodeRevert, isNetworkError } from "../src/tx.js";

const revertWith = (errorName: string, args: readonly unknown[] = []) =>
  new BaseError("Execution reverted", {
    cause: new RawContractError({ data: encodeErrorResult({ abi: CORE_ABI, errorName, args }) }),
  });

test("custom errors decode to readable names with args", () => {
  assert.deepEqual(decodeRevert(revertWith("NotAgent")), { name: "NotAgent", args: [] });
  assert.deepEqual(decodeRevert(revertWith("InsufficientBalance", [5n, 7n])), { name: "InsufficientBalance", args: [5n, 7n] });
  assert.deepEqual(decodeRevert(revertWith("ContractPaused")), { name: "ContractPaused", args: [] });
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
  assert.equal(isNetworkError(revertWith("NotAgent")), false);
  assert.equal(isNetworkError(new Error("execution reverted")), false);
});
