# Vendored anti-slop

Source: [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop), commit `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b` (2026-09-10), MIT. `LICENSE` here is upstream's, verbatim.

Installed 2026-10-06 by the `install-anti-slop` skill's `scripts/install.mjs`. The skill's bundled `assets/anti-slop/` was byte-identical (`diff -r`) to `skills/install-anti-slop/assets/anti-slop/` in a clean clone at that commit.

Installed paths:

- `index.ts`, `rules/`, `shared/`: the generic plugin, registered as `anti-slop`.
- `effect/`: the Effect rule group, registered as `anti-slop-effect`.
- `vendor/eslint-stylistic/`: upstream's own vendored copy, with its `LICENSE` and `UPSTREAM.md`.

Deviations from upstream: none yet. Rat Stack's rejection-handler patch (planned in `PROVENANCE.md`) is not applied.

Ultracite 7.12.4 ships its own bundled anti-slop preset (`ultracite/oxlint/anti-slop`) at an older commit (`e8c4880`) with no Effect group. `oxlint.config.ts` does not extend it; this copy is the one that runs.
