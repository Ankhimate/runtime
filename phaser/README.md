# Ankhimate Phaser runtime

Phaser 3 playback for the `ankhimate-runtime` JSON and baked atlas produced by
Ankhimate's **Ankhimate runtime** export preset.

## Install

```sh
npm install @ankhimate/phaser-runtime phaser
```

Load the exported JSON and every atlas page in Phaser's preload step, then
construct the rig in `create`:

```ts
import { parseRig, PhaserRig } from "@ankhimate/phaser-runtime";

preload() {
  this.load.json("hero-rig", "hero/skeleton.json");
  this.load.image("hero-atlas-0", "hero/atlas.png");
}

create() {
  const data = parseRig(this.cache.json.get("hero-rig"));
  this.hero = new PhaserRig(this, data, {
    pageTextureKeys: ["hero-atlas-0"],
  });
  this.hero.root.setPosition(400, 500);
  this.hero.play("idle");
}

update(_time: number, delta: number) {
  this.hero.update(delta);
  for (const event of this.hero.player.events) {
    if (event.name === "footstep") this.sound.play("step");
  }
}
```

`RigPlayer` and `evaluate` are exported separately for headless gameplay and
tests. Times accepted by those APIs are seconds; `PhaserRig.update` accepts the
millisecond delta supplied by Phaser.

## Runtime coverage

- setup poses and parented affine bone transforms;
- linear, stepped, and cubic-bezier keys;
- translation, shortest-arc rotation, multiplicative scale, and shear tracks;
- looping, non-looping playback, crossfades, and events;
- slot visibility, color, attachment, and draw-order tracks;
- IK, transform, path, and deterministic fixed-step physics constraints in
  authored order, including their animation timelines;
- exact affine region quads, weighted and rigid meshes, linked meshes, and
  per-influence deform timelines;
- clipping polygons, trimmed and rotated atlas frames, attachment sequences,
  and normal/additive/multiply/screen slot blending;
- world-space bounding-box, path, clipping, and point queries through
  `attachmentWorldVertices` and `attachmentWorldPoint`.

Rendering uses Phaser WebGL Mesh objects because Phaser Images cannot represent
general affine shear or weighted geometry. Constructing `PhaserRig` under the
Canvas renderer therefore throws a clear error; headless `RigPlayer` and
`evaluate` remain renderer-independent.

Phaser 4 is intentionally outside the 0.1 peer range; its renderer API is a
separate integration target.

## Development

```sh
npm install
npm test
npm run typecheck
```

Licensed under either MIT or Apache-2.0, at your option.
