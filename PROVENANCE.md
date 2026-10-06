# Provenance

Code from other projects enters as ports: copied with attribution, then ours to change (ADR 0013). One row per port, with its source, commit, licence and our changes. Licence texts are in `LICENSES/`.

## Ports

| Our file | Origin | Licence | Our changes |
| --- | --- | --- | --- |
| `tools/oxlint/anti-slop/` | [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop) at `c44ef22` | MIT, `LICENSES/anti-slop.MIT.txt` | None; vendored by its own install script. See `UPSTREAM.md` there. |
| `tsconfig.base.json` (compiler options and the Effect diagnostics map) | [joelhooks/rat-stack](https://github.com/joelhooks/rat-stack) `tsconfig.base.json` at `fba26d8` | MIT, `LICENSES/rat-stack.MIT.txt` | `importFromBarrel` dropped (unknown to `@effect/tsgo` 0.48.1); `types` emptied, so each package opts into its host's types; `@effect/platform-bun` added to `namespaceImportPackages`; `outdatedApi`, `unstableApiUsage` and `experimentalApiUsage` raised to `error`; `allowedUnstableApis` emptied and granted per path through `overrides`. |

## Ideas, no code

| Idea | From | Where it lives |
| --- | --- | --- |
| A release-age gate and exact pins on every install | Rat Stack's `pnpm-workspace.yaml` (`minimumReleaseAge`, `minimumReleaseAgeExclude`) | `bunfig.toml` |
