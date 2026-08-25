# `@ankhimate/runtime`

Framework-independent TypeScript support for Ankhimate data and animation.
It has no renderer, DOM, Canvas, WebGL, WebGPU, Phaser, or editor dependency.

## Install

```sh
npm install @ankhimate/runtime
```

## Native `.ankh`

```ts
import { assetRootFor, loadAnkh } from "@ankhimate/runtime";

const projectUrl = "/avatar/animations.ankh";
const bytes = new Uint8Array(await (await fetch(projectUrl)).arrayBuffer());
const root = assetRootFor(projectUrl);
const loaded = await loadAnkh(bytes, {
  async loadAsset(file) {
    const response = await fetch(new URL(file, new URL(root, location.href)));
    if (!response.ok) throw new Error(`could not load ${file}`);
    return new Uint8Array(await response.arrayBuffer());
  },
});
```

`parseAnkh` accepts binary `.ankh`, readable `.ankh.json`, compact
`.ankh.min.json`, or an already-decoded object. Binary input validates the
envelope, decoded-size limit, raw Deflate, length, CRC-32, MessagePack, compact
keys, schema version, asset dimensions, and confined asset paths.

The library never fetches on its own. `loadAnkh` receives a loader callback so
browser games, Node tools, bundlers, native shells, and test harnesses retain
control of transport, caching, authentication, and cancellation.

## Runtime export playback

The package also owns the deterministic evaluator previously embedded in the
Phaser adapter:

```ts
import { parseRig, RigPlayer } from "@ankhimate/runtime";

const rig = parseRig(runtimeJson);
const player = new RigPlayer(rig).play("idle");
const pose = player.update(1 / 60);
```

`evaluate`, attachment world queries, constraints, physics, crossfades, and
events are renderer-independent. An engine adapter consumes `RigPose` and the
atlas metadata to draw.

## Boundaries

- Native `.ankh` parsing returns the complete name-keyed authoring schema.
- `parseRig` reads the normalized `ankhimate-runtime` export optimized for
  evaluation and rendering.
- Converting arbitrary authoring projects into the normalized runtime export is
  exporter work; it is not silently guessed at load time.

Licensed under MIT OR Apache-2.0.
