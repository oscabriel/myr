# Myr

A Git platform for the boundary between a project and everyone else. Everything a project ships is public, its contribution process is typed code on `main`, and a push lands only by passing a typed gate.

Anyone's agent can now offer a change at any hour, and projects answer by closing the door or hand-building a vouch gate in front of it. Myr puts that boundary in the platform, so it is held at the push rather than in a maintainer's evening. Live demo: <https://web-demo.oscargabriel.workers.dev>.

A platform can do what a setting on a code host cannot:

- **Judge with checks the answer cannot touch.** A push that edits test config, scripts or CI, or skips a test without a reason, is refused.
- **Hold checks back.** A maintainer's hidden checks run on every answer; the answerer learns one result per area.
- **Refuse in git's own words.** Every refusal is a typed value, printed in `git push`'s `remote:` lines with the command to run next.
- **Give an ask one claimant.** A claim is an exclusive, expiring right to answer, so two agents never race on one change.
- **Credit the asker too.** A landing names every person by trailer (`Asked-by`, `Decided-by` and more); an agent is disclosed, never credited.

Contributors meet four nouns, defined in [GLOSSARY.md](GLOSSARY.md): an **ask** (a change the project wants, with a check that fails on `main`), an **answer** (a commit offered for one ask), a **check** (what judges it, on the exact merged tree) and a **refusal** (what comes back instead of a landing).

```
$ git push
remote: OutOfScope: changes paths outside the ask's territory: README.md; put those files back, or flag the ask if the want needs them
remote:   next: myr check
remote:   retryable: no
 ! [remote rejected] HEAD -> main (OutOfScope)
```

## Quick start

You need Bun 1.4.2 and git 2.5x. Nothing here needs an account:

```sh
bun install --frozen-lockfile
bun run verify                      # lint, types and every test, the whole core loop in Node with real git
bun run --cwd apps/web dev          # the web over a dev world seeded with two fictional projects
bun run seed -- --world node        # both examples, seeded onto a platform running in Node
```

The CLI comes from the platform itself; `myr login` signs you in through the browser and sets up git's credential helper, so plain `git clone` and `git push` work:

```sh
curl -fsSL <origin>/install.sh | sh
myr login --url <origin>
myr asks --project oscabriel/datekit
myr claim <ask>
```

The web's `/docs` holds the guides and the full reference; `/llms.txt` and `myr mcp` serve the same to agents.

## Deploy your own

You need a Cloudflare account on Workers Paid, with Artifacts, and Docker with buildx. Sign-in mails codes from `no-reply@myr.technology` through Cloudflare Email Service, so onboard the brand's domain for Email Sending on the account (Compute › Email Service). Add a `dev-<you>` stage to `infra/stages.ts` and each app's `wrangler.jsonc`, set the credentials `infra/.env.schema` names, then:

```sh
bun run bootstrap -- --stage dev-<you>   # makes the stage's resources; deletes nothing
bun run deploy -- --stage dev-<you>      # runs verify, deploys the three Workers, runs smoke
```

[AGENTS.md](AGENTS.md) covers secrets, smoke, seeding, releases and teardown, and its principles table names the check that holds each rule.

## The tree

```
apps/        the platform, sandbox and web Workers, and the CLI
packages/    the protocol (one schema for every surface), gate, rules, checks, lifecycles, git and the rest
infra/       bootstrap, deploy, the stage table, teardown
scripts/     brand and byte checks, seed, smoke, swarm, release
examples/    datekit and burrow, fictional projects for the demo
tools/       the vendored lint plugins
```

## Credits

Files ported from other projects name their upstream in their first line and carry its licence notice; vendored folders keep their licence file beside them.

- **varlock** ([dmno-dev/varlock](https://github.com/dmno-dev/varlock), MIT): the `.env.schema` format, and the leak scanner in `packages/visibility/src/leak-scan.ts`.
- **Rat Stack** ([joelhooks/rat-stack](https://github.com/joelhooks/rat-stack), MIT): the CLI and MCP projections in `packages/protocol/src/{cli,mcp}.ts`, the Effect diagnostics map, and burrow's `no-module-level-mutable-state` rule.
- **anti-slop** ([dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop), MIT): the lint plugins in `tools/oxlint/anti-slop/`.
- **shadcn/ui** (MIT): the web's base components, in `apps/web/src/components/ui/`.
- **IBM Plex Sans** and **IBM Plex Mono** (SIL Open Font License): the web's typefaces, installed from fontsource (`@fontsource-variable/ibm-plex-sans`, `@fontsource/ibm-plex-mono`), each package carrying its licence.
- **Pierre** (`@pierre/diffs`, `@pierre/trees`, Apache-2.0), **unified** (MIT), **Effect** and **isomorphic-git**: highlighting and diffs, Markdown, the whole codebase, and git inside a Worker.
- Ideas, no code: Cloudflare's cf (one command catalog), Ghostty's `VOUCHED.td` format and Matt Pocock's agent-brief shape.

Licensed under the terms in [LICENSE](LICENSE).
