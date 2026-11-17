import test from "node:test";
import assert from "node:assert/strict";
import { openingCall, changedCalls } from "../site/announcements.js";

const flight = (gate, status) => ["LH 2222", "MUNICH", "", "20:45", "", "B", "", "", gate, status];
const names = { "LH 2222|MUNICH|20:45": { airline: "Lufthansa", de: "München", en: "Munich" } };
test("calls name the carrier and flight in German, then English", () => {
  for (const status of ["BOARDING", "SCHEDULED", "FINAL CALL", "GATE OPEN", "LAST CALL"]) {
    const [de, en] = openingCall([flight("B41", status)], names);
    assert.equal(de.lang, "de-CH");
    assert.equal(en.lang, "en-GB");
    assert.match(de.text, /Lufthansa Flug LH 2222 nach München/);
    assert.match(en.text, /Lufthansa flight LH 2222 to Munich/);
    assert.match(en.text, status === "SCHEDULED" ? /20:45/ : /gate B 41/i);
  }
});
test("changed calls use current names and gates and skip repeats", () => {
  const boarded = flight("B41", "BOARDING");
  assert.deepEqual(changedCalls([boarded], [boarded], names), []);
  const [final] = changedCalls([boarded], [flight("B43", "FINAL CALL")], names);
  assert.match(final[1].text, /Final call for Lufthansa flight LH 2222.*gate B 43/);
  assert.deepEqual(changedCalls([boarded], [flight("B41", "CLOSED")], names), []);
  const [move] = changedCalls([flight("B41", "SCHEDULED")], [flight("B43", "SCHEDULED")], names);
  assert.match(move[0].text, /Gateänderung für Lufthansa Flug/);
  assert.match(move[1].text, /Gate change for Lufthansa flight/);
});
test("older snapshots still produce an intelligible call", () => {
  assert.match(openingCall([flight("", "SCHEDULED")])[1].text, /^Flight LH 2222/);
  assert.equal(openingCall([]), null);
});
