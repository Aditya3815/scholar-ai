// The switch registry (apps/api/src/platform/switches.ts) loads in Node as it is, with the types stripped and nothing of the Worker: a script that needs the names and positions of the
// switches (the integration runner, the suites that read INTEGRATION_VARS) imports them from there instead of writing its own list (docs/design/untangle.md, F6 and F24).
import { test } from "node:test";
import assert from "node:assert/strict";
import { SWITCHES, SWITCH_NAMES, flag, kvKeyOf, killSwitch } from "../../src/platform/switches.ts";

test("the registry loads in Node and lists every switch with its kind and positions", () => {
  assert.ok(SWITCH_NAMES.length >= 15);
  assert.deepEqual(SWITCH_NAMES, Object.keys(SWITCHES));
  for (const name of SWITCH_NAMES) {
    const s = SWITCHES[name];
    assert.ok(s.kind === "gate" || s.kind === "kill", name);
    assert.ok(s.positions.includes("off") && s.positions.includes("on"), name);
  }
  assert.deepEqual(SWITCHES.CHAT_SAFETY.positions, ["off", "shadow", "core", "on"]);
  assert.deepEqual(SWITCHES.TRENDING.positions, ["off", "dark", "on"]);
});

test("its readers run in Node too", async () => {
  assert.equal(kvKeyOf("CHAT_FLOOR"), "flag:CHAT_FLOOR");
  assert.equal(kvKeyOf("TRENDING"), "trending:v1:off");
  assert.equal(kvKeyOf("CHAT_JUDGE"), null);
  assert.equal(killSwitch({ TRENDING: " Dark " }, "TRENDING"), "dark");
  assert.equal(killSwitch({ CHAT_JUDGE: "OFF" }, "CHAT_JUDGE"), "on");
  assert.equal((await flag({ CHAT_FLOOR: "writer" }, "CHAT_FLOOR")).position, "writer");
  assert.equal((await flag({ CHAT_COUNTERS: "writer" }, "CHAT_COUNTERS")).position, "off");
});
