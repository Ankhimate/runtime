# Ankhimate runtimes

Game-side runtimes for animation data exported by Ankhimate. Each runtime is an
independent package because engine APIs and release cycles differ.

| Runtime | Status |
|---|---|
| [`core/`](core/) | Framework-independent `@ankhimate/runtime`: native format parsing, loading, evaluation, and playback |
| [`phaser/`](phaser/) | Phaser 3 runtime |

The repository is intentionally ready for runtimes in other languages and
engines without making them depend on the editor or on one another.
