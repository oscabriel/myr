# burrow

The services behind burrow's shop: six small TypeScript packages in one Bun workspace, sharing one HTTP kit.

burrow, its shop and the people named here are fictional, made up as an example project; no real person, company or host is meant.

| Package | What it does |
| --- | --- |
| `@burrow/kit` | The HTTP helpers every service uses: `http.get`, and `legacyFetch`, which it replaces |
| `@burrow/auth` | Sessions, and who is on which team |
| `@burrow/billing` | Exchange rates and invoices |
| `@burrow/catalog` | Products and categories |
| `@burrow/notify` | Message templates |
| `@burrow/search` | Search, and "search again" |

## Working on it

```sh
bun install
bun run lint         # oxlint: Ultracite's core and anti-slop presets, and our own rule
bun run typecheck
bun test
bun run lint:rules   # our lint rule's fixture test (oxlint's RuleTester, under Node)
bun run debt         # escape directives, against debt.baseline.json
```

`lefthook.yml` runs the lint and the typecheck before each commit and the tests before each push, once you run `lefthook install`.

## How we keep it tidy

- **No state in modules.** Our one lint rule, `no-module-level-mutable-state` (in `tools/oxlint/burrow`), flags a `let` or `var` at the top of a package's `src/`: the services are long-lived processes, so that binding is shared by every request they serve. Six are left, one per package. The rule warns until they are gone, and their count may only fall; then it becomes an error. A fix is usually a factory, a parameter, or a cache the caller owns.
- **Escapes say why.** A comment that switches a check off (`oxlint-disable`, `@ts-expect-error`) carries its reason after ` -- `, and `bun run debt` keeps their number at or under `debt.baseline.json`.
- **`legacyFetch` is on its way out.** It throws on any failed request; `http.get` hands the failure back as a value. `bun scripts/count-callers.ts legacyFetch` shows who still calls it, by package (`--json` for a script).

## Contributing

Work is offered as asks, each with a check that says when it is done. The project's process lives in `.myr/`: `project.ts` (maintainers, ask kinds, the module-state ratchet), `vouched.td` (who may claim), and the open asks in `asks/`. `okafor` and `lin-h` decide for every path.

## License

MIT, see `LICENSE`. `tools/oxlint/burrow/rules/no-module-level-mutable-state.ts` is MIT too, under its authors' notice in `tools/oxlint/burrow/LICENSE-rat-stack.txt`.
