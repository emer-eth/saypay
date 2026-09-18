import assert from "node:assert/strict";
import test from "node:test";
import { formatNimiqAddress, isValidNimiqAddress, lunasToNim, nimToLunas } from "../app/_lib/units";

test("NIM to Lunas is 1e5 and never uses floats for the multiplier", () => {
  assert.equal(nimToLunas(20), 2_000_000);
  assert.equal(lunasToNim(2_000_000), 20);
  assert.throws(() => nimToLunas(-1));
});

test("Nimiq address checksum pattern", () => {
  assert.equal(isValidNimiqAddress("NQ07 0000 0000 0000 0000 0000 0000 0000 0000"), true);
  assert.equal(isValidNimiqAddress("NQ07 0000"), false);
  assert.equal(isValidNimiqAddress("0xabc"), false);
  assert.match(formatNimiqAddress("NQ0700000000000000000000000000000000"), / /);
});
