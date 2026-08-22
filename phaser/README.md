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

## Supported in 0.1

- setup poses and parented affine bone transforms;
- linear, stepped, and cubic-bezier keys;
- translation, shortest-arc rotation, multiplicative scale, and shear tracks in
  the headless evaluator;
- looping, non-looping playback, crossfades, and events;
- slot visibility, color, attachment, and draw-order tracks;
- atlas-backed region attachments and trimmed atlas frames.

`PhaserRig.unsupported` reports features present in a rig that this version does
not evaluate: constraints, mesh/path attachments, deform timelines, and
constraint timelines. Rotated atlas regions are hidden. These cases are kept
explicit because drawing an incorrect pose is harder to diagnose than a clear
capability report.

Phaser Images have no skew transform. `PhaserRig` therefore projects a sheared
world affine to position, rotation, and scale when drawing a region; use the
headless pose matrices for exact shear-aware custom rendering. This limitation
does not affect rigs whose evaluated world transforms have no shear.

Phaser 4 is intentionally outside the 0.1 peer range; its renderer API is a
separate integration target.

## Development

```sh
npm install
npm test
npm run typecheck
```

Licensed under either MIT or Apache-2.0, at your option.
