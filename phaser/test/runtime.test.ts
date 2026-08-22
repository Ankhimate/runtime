import assert from "node:assert/strict";
import test from "node:test";
import { evaluate } from "../src/evaluate.js";
import { RigPlayer } from "../src/player.js";
import { parseRig, RigFormatError } from "../src/rig.js";
import type { RuntimeRigData } from "../src/types.js";

function fixture(): RuntimeRigData {
  return {
    format: "ankhimate-runtime",
    context_version: 1,
    name: "test",
    fps: 30,
    bones: [
      { name: "root", parent: -1, length: 10, x: 2, y: 3, rotation: 0, scaleX: 2, scaleY: 2, shearX: 0, shearY: 0, inheritRotation: true, inheritScale: true, inheritReflect: true },
      { name: "child", parent: 0, length: 5, x: 10, y: 0, rotation: 0, scaleX: 3, scaleY: 1, shearX: 0, shearY: 0, inheritRotation: true, inheritScale: true, inheritReflect: true },
    ],
    slots: [{ name: "part", bone: "child", attachment: "part", color: "804020ff", blend: "normal" }],
    drawOrder: ["part"],
    defaultSkin: null,
    skins: [],
    constraints: [],
    constraintOrder: [],
    animations: {
      walk: {
        duration: 1,
        looping: true,
        bones: [{
          name: "child",
          translate: [
            { time: 0, x: 0, y: 0, curve: "linear" },
            { time: 1, x: 10, y: 0, curve: "linear" },
          ],
          rotate: [
            { time: 0, value: 170, curve: "linear" },
            { time: 1, value: -170, curve: "linear" },
          ],
          scale: [{ time: 0, x: 2, y: 0.5, curve: "linear" }],
        }],
        slots: [],
        drawOrder: [],
        events: [{ time: 0.25, name: "step" }, { time: 0.75, name: "step" }],
      },
      idle: {
        duration: 1,
        looping: true,
        bones: [{ name: "child", translate: [{ time: 0, x: -10, y: 0, curve: "linear" }] }],
        slots: [],
        drawOrder: [],
        events: [],
      },
    },
    atlas: null,
  };
}

test("parseRig rejects forward parent references", () => {
  const data = fixture() as unknown as { bones: Array<{ parent: number }> };
  data.bones[0]!.parent = 1;
  assert.throws(() => parseRig(data), RigFormatError);
});

test("setup pose composes parent transforms exactly once", () => {
  const pose = evaluate(fixture());
  assert.equal(pose.bones[1]!.world.tx, 22);
  assert.equal(pose.bones[1]!.world.ty, 3);
  assert.deepEqual(pose.slots[0]!.color, [128 / 255, 64 / 255, 32 / 255, 1]);
});

test("animation uses additive translation, shortest rotation, and multiplicative scale", () => {
  const pose = evaluate(fixture(), [{ animation: "walk", time: 0.5, alpha: 1 }]);
  const child = pose.bones[1]!;
  assert.equal(child.x, 15);
  assert.ok(Math.abs(Math.abs(child.rotation) - Math.PI) < 1e-6);
  assert.equal(child.scaleX, 6);
  assert.equal(child.scaleY, 0.5);
});

test("looping update emits every crossed event once", () => {
  const player = new RigPlayer(fixture()).play("walk").seek(0.6);
  player.update(0.8);
  assert.deepEqual(player.events.map((event) => event.time), [0.75, 0.25]);
  player.update(0);
  assert.deepEqual(player.events, []);
});

test("crossfade advances both tracks and reaches the incoming pose", () => {
  const player = new RigPlayer(fixture()).play("idle");
  player.crossFade("walk", 0.5);
  const halfway = player.update(0.25);
  assert.equal(halfway.bones[1]!.x, 6.25);
  const finished = player.update(0.25);
  assert.equal(finished.bones[1]!.x, 15);
});
