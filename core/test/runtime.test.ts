import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync } from "fflate";
import { AnkhFormatError, assetRootFor, expandCompact, loadAnkh, parseAnkh, safeAssetPath } from "../src/index.js";

const project = {
  version: 1, name: "hero", fps: 24,
  assets: [{ name: "atlas", file: "atlas.png", width: 64, height: 32 }],
  bones: [], slots: [], draw_order: [], skins: [], constraints: [], constraint_order: [], animations: [],
};

function msgpack(value: unknown): number[] {
  if (value === null) return [0xc0];
  if (typeof value === "boolean") return [value ? 0xc3 : 0xc2];
  if (typeof value === "number") {
    if (Number.isInteger(value) && value >= 0 && value < 128) return [value];
    const buffer = new ArrayBuffer(8), view = new DataView(buffer); view.setFloat64(0, value, false);
    return [0xcb, ...new Uint8Array(buffer)];
  }
  if (typeof value === "string") {
    const bytes = [...new TextEncoder().encode(value)];
    return bytes.length < 32 ? [0xa0 | bytes.length, ...bytes] : [0xd9, bytes.length, ...bytes];
  }
  if (Array.isArray(value)) return [0x90 | value.length, ...value.flatMap(msgpack)];
  const entries = Object.entries(value as Record<string, unknown>);
  return [0x80 | entries.length, ...entries.flatMap(([key, child]) => [...msgpack(key), ...msgpack(child)])];
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc ^ byte) >>> 0;
    for (let bit = 0; bit < 8; bit++) crc = ((crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function container(value: unknown, compressed = true): Uint8Array {
  const payload = new Uint8Array(msgpack(value));
  const body = compressed ? deflateSync(payload) : payload;
  const bytes = new Uint8Array(16 + body.length), view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("ANKH"));
  view.setUint16(4, 1, true); bytes[6] = 1; bytes[7] = compressed ? 1 : 0;
  view.setUint32(8, payload.length, true); view.setUint32(12, crc32(payload), true);
  bytes.set(body, 16);
  return bytes;
}

test("binary, JSON, and object profiles parse to the same project", () => {
  assert.deepEqual(parseAnkh(container(project)), project);
  assert.deepEqual(parseAnkh(JSON.stringify(project)), project);
  assert.deepEqual(parseAnkh(project), project);
});

test("compact keys expand recursively and preserve explicit extension keys", () => {
  assert.deepEqual(expandCompact({ a: 1, e: [{ b: "root", "~game_tag": "avatar" }] }), {
    version: 1, bones: [{ name: "root", game_tag: "avatar" }],
  });
});

test("corrupt envelopes fail before returning a project", () => {
  const bytes = container(project); bytes[12] = bytes[12]! ^ 1;
  assert.throws(() => parseAnkh(bytes), /checksum mismatch/);
  assert.throws(() => parseAnkh(container(project), { maxDecodedBytes: 8 }), /exceeds 8 bytes/);
});

test("external assets are caller-loaded and name keyed", async () => {
  const requested: string[] = [];
  const loaded = await loadAnkh(container(project), {
    async loadAsset(file) { requested.push(file); return new Uint8Array([1, 2, 3]); },
  });
  assert.deepEqual(requested, ["atlas.png"]);
  assert.deepEqual([...loaded.assets.get("atlas")!], [1, 2, 3]);
});

test("asset paths and roots are deterministic", () => {
  assert.equal(assetRootFor("/hero/animations.ankh"), "/hero/animations.assets/");
  assert.equal(assetRootFor("hero.ankh.min.json"), "hero.assets/");
  assert.equal(safeAssetPath("pages/atlas.png"), true);
  for (const path of ["../atlas.png", "/atlas.png", "C:\\atlas.png", "a//b.png"])
    assert.equal(safeAssetPath(path), false, path);
  assert.throws(() => parseAnkh({ ...project, assets: [{ ...project.assets[0]!, file: "../bad.png" }] }), AnkhFormatError);
});
