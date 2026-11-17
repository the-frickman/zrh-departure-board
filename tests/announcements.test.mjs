import test from "node:test";
import assert from "node:assert/strict";
import { openingCall, changedCalls } from "../site/announcements.js";

const flight = (gate, status) => ["LX  736", "AMSTERDAM", "", "20:45", "", "B", "", "", gate, status];
test("enabling sound reads the current board", () => {
  assert.match(openingCall([flight("", "SCHEDULED")]), /20:45/);
  assert.match(openingCall([flight("B41", "BOARDING")]), /boarding.*gate B 4 1/);
});
test("gate calls are based on a change for the same flight", () => {
  const call = flight("B41", "BOARDING");
  assert.equal(changedCalls([], [call]).length, 1);
  assert.deepEqual(changedCalls([call], [call]), []);
  assert.match(changedCalls([call], [flight("B43", "FINAL CALL")])[0], /final call.*4 3/);
  assert.deepEqual(changedCalls([call], [flight("B41", "CLOSED")]), []);
  assert.match(changedCalls([flight("B41", "SCHEDULED")], [flight("B43", "SCHEDULED")])[0], /Gate change/);
});
