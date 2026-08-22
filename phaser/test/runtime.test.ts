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
        deform: [],
        drawOrder: [],
        ik: [],
        transform: [],
        events: [{ time: 0.25, name: "step" }, { time: 0.75, name: "step" }],
      },
      idle: {
        duration: 1,
        looping: true,
        bones: [{ name: "child", translate: [{ time: 0, x: -10, y: 0, curve: "linear" }] }],
        slots: [],
        deform: [],
        drawOrder: [],
        ik: [],
        transform: [],
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

test("an exported curve belongs to the segment leaving its key", () => {
  const rig = fixture();
  rig.animations.walk!.bones[0]!.translate = [
    { time: 0, x: 0, y: 0, curve: "stepped" },
    { time: 1, x: 10, y: 0, curve: "linear" },
  ];
  assert.equal(evaluate(rig, [{ animation: "walk", time: 0.5, alpha: 1 }]).bones[1]!.x, 10);
});

test("single-bone IK aims at its target", () => {
  const rig = fixture();
  rig.bones[0] = { ...rig.bones[0]!, x: 0, y: 0, scaleX: 1, scaleY: 1 };
  rig.bones[1] = { ...rig.bones[1]!, x: 0, y: 0, scaleX: 1, scaleY: 1 };
  rig.bones.push({ name: "target", parent: -1, length: 0, x: 0, y: 10, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0, inheritRotation: true, inheritScale: true, inheritReflect: true });
  rig.constraints = [{ name: "aim", type: "ik", target: "target", bones: ["child"], mix: 1, bend_direction: 1, softness: 0, stretch: false, stretch_limit: 1.1, stiffness: 0 }];
  rig.constraintOrder = ["aim"];
  const pose = evaluate(rig);
  assert.ok(Math.abs(pose.bones[1]!.world.a) < 1e-6);
  assert.ok(pose.bones[1]!.world.b > 0.999);
});

test("deform offsets blend and sequences advance", () => {
  const rig = fixture();
  rig.defaultSkin = "default";
  rig.skins = [{
    name: "default", bones: [], constraints: [], attachments: [{
      slot: "part", name: "part", attachment: {
        type: "region", texture: "one", x: 0, y: 0, rotation: 0, scale_x: 1, scale_y: 1,
        width: 10, height: 10, source_width: 10, source_height: 10, pivot_x: 0.5, pivot_y: 0.5,
        uv: [0, 0, 1, 1], sequence: { frames: ["one", "two", "three"], fps: 2, mode: "loop", setup_index: 0 },
      },
    }],
  }];
  rig.animations.walk!.deform = [{ slot: "part", attachment: "part", keys: [
    { time: 0, offsets: [0, 0], curve: "linear" },
    { time: 1, offsets: [10, 20], curve: "linear" },
  ] }];
  const pose = evaluate(rig, [{ animation: "walk", time: 0.5, alpha: 1 }]);
  assert.deepEqual(pose.deforms["part\0part"], [5, 10]);
  assert.equal(pose.slots[0]!.sequenceFrame, 1);
});

test("physics state is deterministic for the same delta sequence", () => {
  const run = () => {
    const rig = fixture();
    rig.constraints = [{ name: "spring", type: "physics", target: "", bones: ["child"], mix: 1,
      physics: { inertia: 0.5, strength: 20, damping: 0.3, mass: 1 },
      forces: { wind_x: 10, wind_y: 0, gravity_x: 0, gravity_y: -9.8 }, channels: { rotate: true, translate: true } }];
    rig.constraintOrder = ["spring"];
    const player = new RigPlayer(rig).play("walk");
    for (const delta of [0.016, 0.02, 0.01, 0.033]) player.update(delta);
    return player.pose().bones[1]!.world;
  };
  assert.deepEqual(run(), run());
});

test("transform constraints copy driven channels", () => {
  const rig = fixture();
  rig.bones.push({ name: "target", parent: -1, length: 0, x: 50, y: 20, rotation: 0, scaleX: 1, scaleY: 1, shearX: 0, shearY: 0, inheritRotation: true, inheritScale: true, inheritReflect: true });
  rig.constraints = [{ name: "follow", type: "transform", target: "target", bones: ["child"], mix: 1, local: false, relative: false,
    mixes: { rotate: 0, translate_x: 1, translate_y: 1, scale_x: 0, scale_y: 0, shear_x: 0, shear_y: 0 },
    offsets: { x: 0, y: 0, rotation: 0, scale_x: 1, scale_y: 1, shear_x: 0, shear_y: 0 } }];
  rig.constraintOrder = ["follow"];
  const world = evaluate(rig).bones[1]!.world;
  assert.ok(Math.abs(world.tx - 50) < 1e-6);
  assert.ok(Math.abs(world.ty - 20) < 1e-6);
});

test("path constraints place bones along the selected skin path", () => {
  const rig = fixture();
  rig.defaultSkin = "default";
  rig.slots[0] = { ...rig.slots[0]!, bone: "root", attachment: "route" };
  rig.skins = [{ name: "default", bones: [], constraints: [], attachments: [{ slot: "part", name: "route", attachment: {
    type: "path", vertices: [0, 0, 100, 0], vertex_count: 2, closed: false, constant_speed: true,
  } }] }];
  rig.constraints = [{ name: "route", type: "path", target: "", bones: ["child"], mix: 1, slot: "part",
    path: { position: 0, spacing: 1, mix_rotate: 1, mix_translate: 1 } }];
  rig.constraintOrder = ["route"];
  const world = evaluate(rig).bones[1]!.world;
  assert.equal(world.tx, 2);
  assert.equal(world.ty, 3);
});
