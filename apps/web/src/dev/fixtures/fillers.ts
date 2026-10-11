/**
 * Six small fictional projects beside the others, so a list of projects
 * runs past what fits beside it, each made through the project service as
 * datekit is, in its decider's namespace (`okafor/amberlog`): created, its
 * first commit pushed, one ask opened by its decider. `mossgate` opens none: a visitor's proposal is all it holds, so
 * it lists with no open asks.
 */
import { Brand } from "@repo/brand";
import { CheckSpec } from "@repo/protocol/domain/check";
import type { Handle } from "@repo/protocol/ids";
import { AskId, ProjectName, RepoPath, shortNameOf } from "@repo/protocol/ids";
import { Person } from "@repo/protocol/principal";
import { Array, Effect, Schema } from "effect";

import { DevClock, devMinute } from "../clock.ts";
import {
  askFileOf,
  burrowPeople,
  datekitPeople,
  policyJson,
} from "../examples.ts";
import type { StatedAsk } from "../examples.ts";
import type { Files } from "../git.ts";
import { opened, startedAt, visitors } from "../seed.ts";

const encodeCheck = Schema.encodeSync(CheckSpec);

const { configDir } = Brand;

interface Filler {
  readonly project: ProjectName;
  readonly decider: Handle;
  readonly summary: string;
  readonly source: string;
  readonly ask?: { readonly id: string; readonly want: string };
}

const filler = (input: {
  readonly project: string;
  readonly decider: Handle;
  readonly summary: string;
  readonly source: string;
  readonly ask?: { readonly id: string; readonly want: string };
}): Filler => ({
  ...input,
  project: ProjectName.make(`${input.decider}/${input.project}`),
});

const fillers: readonly Filler[] = [
  filler({
    ask: {
      id: "redact-header-values",
      want: "Logged request headers hide the values of Authorization and Cookie.",
    },
    decider: burrowPeople.decider,
    project: "amberlog",
    source: "log",
    summary: "Structured logs for small services.",
  }),
  filler({
    ask: {
      id: "skip-unchanged-steps",
      want: "A build step whose inputs hash the same as last time is skipped.",
    },
    decider: burrowPeople.second,
    project: "cinderbox",
    source: "cache",
    summary: "A tiny build cache keyed by the hashes of its inputs.",
  }),
  filler({
    ask: {
      id: "quote-embedded-newlines",
      want: "A field holding a newline is written quoted.",
    },
    decider: datekitPeople.zones,
    project: "fernwick",
    source: "csv",
    summary: "Reads and writes CSV with types.",
  }),
  filler({
    decider: burrowPeople.second,
    project: "mossgate",
    source: "limit",
    summary: "A rate limiter for edge functions.",
  }),
  filler({
    ask: {
      id: "due-cards-first",
      want: "A review session shows the cards that are due before any new card.",
    },
    decider: burrowPeople.decider,
    project: "quillon",
    source: "cards",
    summary: "Spaced-repetition flashcards in the terminal.",
  }),
  filler({
    ask: {
      id: "drain-on-shutdown",
      want: "Closing the pool waits for every borrowed connection to come back.",
    },
    decider: datekitPeople.zones,
    project: "tidepool",
    source: "pool",
    summary: "A connection pool that queues borrowers fairly.",
  }),
];

/** `drain-on-shutdown` → `drainOnShutdown`: the export an ask's check looks for. */
export const exportNameOf = (ask: string) =>
  ask.replaceAll(/-(?<letter>[a-z0-9])/gu, (_match, letter: string) =>
    letter.toUpperCase()
  );

/** A check that fails on main by its assertion: the module exports no function by the ask's name. */
export const checkOf = (module: string, ask: string, want: string) =>
  [
    'import { expect, test } from "bun:test";',
    "",
    `import * as module from "../../src/${module}.ts";`,
    "",
    `test(${JSON.stringify(want)}, () => {`,
    `  expect(typeof Reflect.get(module, ${JSON.stringify(exportNameOf(ask))})).toBe("function");`,
    "});",
    "",
  ].join("\n");

/** The ask a filler states, as its `policy.json` holds it. */
const statedOf = (
  project: Filler,
  ask: NonNullable<Filler["ask"]>
): StatedAsk => ({
  askedBy: project.decider,
  blockedBy: [],
  brief: { want: ask.want },
  check: encodeCheck(
    CheckSpec.cases.RedThenGreen.make({
      path: RepoPath.make(`test/asks/${ask.id}.test.ts`),
    })
  ),
  file: `${configDir}/asks/${ask.id}.ask.ts`,
  id: ask.id,
  kind: "fix",
  territory: { module: ".", paths: [`src/${project.source}.ts`] },
});

const filesOf = (project: Filler, stated: readonly StatedAsk[]): Files =>
  new Map([
    [
      "README.md",
      [
        `# ${shortNameOf(project.project)}`,
        "",
        project.summary,
        "",
        "A fictional project: it and its people are invented.",
        "",
      ].join("\n"),
    ],
    [
      "package.json",
      `${JSON.stringify({ name: shortNameOf(project.project), scripts: { test: "bun test" }, type: "module", version: "0.1.0" }, null, 2)}\n`,
    ],
    [
      `src/${project.source}.ts`,
      `/** ${project.summary} */\nexport const ${project.source} = () => undefined;\n`,
    ],
    [
      `${configDir}/policy.json`,
      policyJson({
        asks: [...stated],
        deciders: [{ handles: [project.decider], paths: "**" }],
        functions: { admit: false, opensAlone: false },
        kinds: [
          {
            checkKind: "redThenGreen",
            claimers: "vouched",
            finish: "optional",
            name: "fix",
            oneWay: false,
            race: 1,
            requires: ["want", "check", "territory"],
            strength: "assertion",
          },
        ],
        ratchets: [],
        run: { checks: { unit: "bun test" }, test: "bun test {path}" },
        source: "config",
        weakening: { markers: [".skip(", ".only(", ".todo("] },
      }),
    ],
    [
      `${configDir}/vouched.td`,
      `# The people ${project.project}'s deciders vouch for.\n`,
    ],
  ]);

/**
 * Every filler made and adopted, one every three minutes from `minute`,
 * each one's ask (or, in mossgate, a visitor's proposal) a minute after its
 * first push.
 */
export const seedFillers = (minute: number) =>
  Effect.forEach(
    fillers,
    (project, index) =>
      Effect.gen(function* () {
        const at = minute + index * 3;

        const stated = Array.fromNullishOr(project.ask).map((ask) =>
          statedOf(project, ask)
        );

        const { api } = yield* startedAt(
          project.project,
          project.decider,
          filesOf(project, stated),
          devMinute(at)
        );

        if (Array.isReadonlyArrayNonEmpty(stated)) {
          yield* opened(
            api,
            project.decider,
            stated.map((each) => {
              const file = askFileOf(each);

              return [
                AskId.make(each.id),
                [
                  file,
                  {
                    content: checkOf(project.source, each.id, each.brief.want),
                    path: RepoPath.make(`test/asks/${each.id}.test.ts`),
                  },
                ],
              ] as const;
            }),
            at + 2
          );

          return;
        }

        const clock = yield* DevClock;

        yield* clock.set(devMinute(at + 2));
        yield* api.proposeAsk(Person.make({ handle: visitors.regular }), {
          want: `${project.project} sheds load by route, not only in total.`,
        });
      }),
    { discard: true }
  );
