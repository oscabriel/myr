/**
 * A project's policy page (its route is `/$project/people`), rendered to HTML with `react-dom/server` from
 * fixtures decoded with the protocol's own schemas (`PublicPolicy` from
 * `projectPolicy`, `Ledger` from `ledger`): who decides which paths, who is
 * vouched for and denounced, each layer's readers and writers, the caps,
 * budget and timings, and where each comes from at the landed commit. The
 * page is read-only, and it shows nothing the two contracts don't carry.
 */
import { describe, expect, it } from "@effect/vitest";
import { commandDocs } from "@repo/agent-kit/command-doc";
import { Brand } from "@repo/brand";
import { Client, Contracts } from "@repo/protocol/contracts";
import { PolicyPending, PublicPolicy } from "@repo/protocol/domain/policy";
import { Ledger } from "@repo/protocol/domain/visibility";
import { ProjectName } from "@repo/protocol/ids";
import { UnknownProject } from "@repo/protocol/refusal";
import { asTester, unanswered } from "@repo/protocol/testing";
import { isNotFound } from "@tanstack/react-router";
import { Effect, Layer, Option, Ref, Schema } from "effect";
import { RpcTest } from "effect/rpc";

import { PeopleView } from "../src/features/project-people/people-view.tsx";
import { projectSections } from "../src/features/shared/shell/sections.ts";
import { readPeople } from "../src/routes/$project/people.tsx";
import { inOrder, markupOf, plainText, textOf } from "./ask-fixtures.ts";
import { elementWith, elementsWith, inspectorOf, mainOf } from "./records.ts";
import { renderAt } from "./render.tsx";

const datekit = ProjectName.make("oscabriel/datekit");

const sha = "4c2e6a8b0d2f4a6c8e0b2d4f6a8c0e2b4d6f8a0c";

const decodePolicy = Schema.decodeSync(PublicPolicy);

const decodeLedger = Schema.decodeSync(Ledger);

/** What every policy below shares: the parts the page doesn't show. */
const unshown = {
  judge: { paths: [`${Brand.configDir}/**`], pointers: [] },
  kinds: [],
  modules: [],
  ratchets: [],
  run: { checks: { unit: "bun test" }, test: "bun test {path}" },
  weakening: { markers: [] },
};

/** datekit's evaluated config folder at `sha`, as `projectPolicy` returns it. */
const datekitPolicy = decodePolicy({
  ...unshown,
  agents: "trailer",
  at: sha,
  budget: { decisionsPerDay: 5, expireDays: 14 },
  caps: { claimsPerPerson: 3, proposalsPerPerson: 2 },
  claims: { lapseAfterMs: 86_400_000, warnAfterMs: 7_200_000 },
  deciders: [
    { handles: ["ines-v"], paths: "**" },
    { handles: ["okonkwo", "bram"], paths: "src/format/**" },
    { handles: ["okonkwo"], paths: "src/tz.ts" },
  ],
  record: { countsAfterDays: 30, windowDays: 365 },
  source: "config",
  vouch: { file: `${Brand.configDir}/vouched.td`, mode: "forCode" },
  vouches: [
    { denounced: false, handle: "bram", note: "first answer landed in 0.4.0" },
    { denounced: false, handle: "ines-v", note: "maintainer" },
    { denounced: true, handle: "spam-bot", note: "opened 40 proposals" },
  ],
});

/** datekit's ledger: one maintainers layer. */
const datekitLedger = decodeLedger({
  entries: [],
  layers: [
    {
      audience: "maintainers",
      disclose: "sealed",
      holds: ["checks", "notes"],
      name: "maintainers",
      readers: "deciders",
      reason: "Held-back checks judge an answer by the ask's words.",
      repo: "datekit--maintainers",
      sunsetDays: 90,
      writers: ["ines-v", "okonkwo"],
    },
  ],
  posture: "openWithSealedEvidence",
  postureLabel: "Open with sealed evidence",
  project: "datekit",
});

/** An imported repo with no `project.ts` in its config folder: the platform's defaults, its initializer deciding. */
const burrowPolicy = decodePolicy({
  ...unshown,
  agents: "trailer",
  at: sha,
  budget: { decisionsPerDay: 5, expireDays: 14 },
  caps: { claimsPerPerson: 3, proposalsPerPerson: 2 },
  claims: { lapseAfterMs: 86_400_000, warnAfterMs: 7_200_000 },
  deciders: [{ handles: ["wren"], paths: "**" }],
  record: { countsAfterDays: 30, windowDays: 365 },
  source: "defaults",
  vouch: { file: `${Brand.configDir}/vouched.td`, mode: "forCode" },
  vouches: [],
});

/** Why an import with no config folder, whose defaults found no test command, has no policy at `sha`. */
const noConfig = Schema.decodeSync(PolicyPending)({
  at: sha,
  reason: "noConfig",
});

const burrowLedger = decodeLedger({
  entries: [],
  layers: [],
  posture: "open",
  postureLabel: "Open",
  project: "burrow",
});

const page = (
  <PeopleView
    ledger={datekitLedger}
    policy={Option.some(datekitPolicy)}
    project={datekit}
    unevaluated={Option.none()}
  />
);

/** The markup of the section whose heading has the id `id`. */
const sectionOf = (markup: string, id: string) => {
  const heading = markup.indexOf(`id="${id}"`);

  return heading === -1
    ? ""
    : elementWith(markup.slice(markup.lastIndexOf("<section", heading)), "");
};

/**
 * Each shell line the page offers to copy, as typed: one command, its
 * continuation lines (` \` then a new line) joined back into one.
 */
const commandsOf = (markup: string) =>
  [
    ...markup.matchAll(/<code\b[^>]*select-all[^>]*>(?<line>.*?)<\/code>/gsu),
  ].map((found) =>
    plainText((found.groups?.line ?? "").replaceAll(/ \\\n\s*/gu, " ")).trim()
  );

/** The CLI command a line runs: the longest command path it starts with. */
const commandOf = (line: string) =>
  commandDocs(Contracts)
    .filter(({ path }) => line.startsWith(`${Brand.cli} ${path.join(" ")} `))
    .toSorted((one, other) => other.path.length - one.path.length)
    .at(0);

/** Each deciders row's text, in order. */
const decidersOf = (markup: string) =>
  elementsWith(mainOf(markup), "data-paths=").map((row) =>
    plainText(row).trim()
  );

describe("a project's policy page", () => {
  it("is titled Policy, as of the landed commit, from the config file, each linked", () => {
    const markup = markupOf(page);
    const meta = plainText(mainOf(markup));

    expect(markup).toMatch(/<h1\b[^>]*>Policy<\/h1>/u);
    expect(meta).toContain(
      `As of ${sha.slice(0, 7)} , from ${Brand.configDir}/project.ts`
    );
    expect(markup).toMatch(
      new RegExp(
        `<a\\b[^>]*href="/datekit/commit/${sha}"[^>]*>${sha.slice(0, 7)}</a>`,
        "u"
      )
    );
    expect(mainOf(markup)).toContain(
      `href="/datekit/blob/${sha}/${Brand.configDir}/project.ts"`
    );
  });

  it.effect(
    "reads Policy in the crumbs and the project's sections, at the address it has always had",
    () =>
      Effect.gen(function* () {
        const markup = yield* renderAt("/datekit/people", page);
        const crumbs = elementWith(markup, 'aria-label="Breadcrumb"');

        expect(plainText(crumbs)).toContain("Policy");
        expect(plainText(crumbs)).not.toContain("People");
        expect(
          projectSections("datekit").find(({ to }) => to === "/datekit/people")
            ?.label
        ).toBe("Policy");
      })
  );

  it("lists who decides which paths, in the policy's order, the path in mono and each handle linked to their page", () => {
    const markup = markupOf(page);
    const rows = elementsWith(mainOf(markup), "data-paths=");

    expect(decidersOf(markup)).toStrictEqual([
      "** ines-v",
      "src/format/** okonkwo , bram",
      "src/tz.ts okonkwo",
    ]);
    expect(rows[0]).toMatch(/<code\b[^>]*font-mono[^>]*>\*\*<\/code>/u);
    expect(rows[1]).toMatch(
      /<a\b[^>]*href="\/people\/okonkwo"[^>]*>okonkwo<\/a>/u
    );
    expect(rows[1]).toMatch(/<a\b[^>]*href="\/people\/bram"[^>]*>bram<\/a>/u);
  });

  it("states the vouch rule in words and splits the file into vouched and denounced, with notes", () => {
    const markup = mainOf(markupOf(page));
    const vouching = sectionOf(markup, "vouching");

    expect(plainText(vouching)).toContain("For code");
    expect(
      inOrder(plainText(vouching), [
        "Vouched for",
        "bram",
        "first answer landed in 0.4.0",
        "ines-v",
        "maintainer",
        "Denounced",
        "spam-bot",
        "opened 40 proposals",
      ])
    ).toBeTruthy();
    expect(vouching).toContain('data-vouch="spam-bot"');
    expect(vouching).toContain(
      `href="/datekit/blob/${sha}/${Brand.configDir}/vouched.td"`
    );
  });

  it("names the layers in one line that links the ledger, and lists no reader, writer or audience again", () => {
    const markup = mainOf(markupOf(page));
    const layers = elementWith(markup, "data-layers");

    expect(layers).toContain('data-layer="maintainers"');
    expect(layers).toMatch(/<a\b[^>]*href="\/datekit\/ledger"/u);
    expect(plainText(layers)).toContain("sealed");
    expect(layers.slice(layers.indexOf(">") + 1)).not.toMatch(
      /<(?:p|div|ul|ol|li|dl)\b/u
    );

    for (const repeated of ["Readers", "Writers", "Audience", "the deciders"]) {
      expect(markup).not.toContain(repeated);
    }
  });

  it("heads the layers' line as its own section, so it never reads as part of Agents", () => {
    const markup = mainOf(markupOf(page));
    const layers = sectionOf(markup, "layers");

    expect(layers).toMatch(/<h2\b[^>]*id="layers"[^>]*>Layers<\/h2>/u);
    expect(layers).toContain("data-layers");
    expect(sectionOf(markup, "agents")).not.toContain("data-layers");
  });

  it("shows the caps, budget, claim timing and record window, the numbers tabular", () => {
    const limits = sectionOf(mainOf(markupOf(page)), "limits");

    for (const words of [
      "3 claims per person",
      "2 proposals per person",
      "5 decisions a day",
      "14 days",
      "2 hours",
      "24 hours",
      "30 days",
      "365 days",
    ]) {
      expect(plainText(limits)).toContain(words);
    }

    expect(limits).toContain("tabular-nums");
  });

  it("says whether landings disclose the agents people worked through", () => {
    const disclosed = plainText(sectionOf(markupOf(page), "agents"));

    const undisclosed = plainText(
      sectionOf(
        markupOf(
          <PeopleView
            ledger={datekitLedger}
            policy={Option.some({ ...datekitPolicy, agents: "none" })}
            project={datekit}
            unevaluated={Option.none()}
          />
        ),
        "agents"
      )
    );

    expect(disclosed).toContain(
      "Each landing names the agents its people worked through"
    );
    expect(undisclosed).toContain("Landings carry no Assisted-by: trailer");
    expect(undisclosed).not.toContain("names the agents");
  });

  it("says a denouncement still bars a person when the vouch rule is bans only", () => {
    const vouching = plainText(
      sectionOf(
        markupOf(
          <PeopleView
            ledger={datekitLedger}
            policy={Option.some({
              ...datekitPolicy,
              vouch: { ...datekitPolicy.vouch, mode: "bansOnly" },
            })}
            project={datekit}
            unevaluated={Option.none()}
          />
        ),
        "vouching"
      )
    );

    expect(vouching).toContain("Bans only: nobody needs a vouch");
    expect(vouching).toContain(
      "a denounced person still may not claim, push or propose"
    );
  });

  it("offers no control, only how to change it: land a change to the config folder", () => {
    const markup = markupOf(page);
    const facts = plainText(inspectorOf(markup));

    for (const control of ["<input", "<textarea", "<form", "<select"]) {
      expect(markup).not.toContain(control);
    }

    expect(facts).toContain(`Land a change to ${Brand.configDir}/`);
    expect(facts).toContain(`${Brand.cli} ask open`);
    expect(facts).toContain(`${Brand.cli} land`);
  });

  it("puts each change command on lines of its own, numbered, never one wall", () => {
    const facts = inspectorOf(markupOf(page));

    const raw = [
      ...facts.matchAll(/<code\b[^>]*select-all[^>]*>(?<line>.*?)<\/code>/gsu),
    ].map((found) => found.groups?.line ?? "");

    expect(raw).toHaveLength(2);

    for (const command of raw) {
      expect(command.split("\n").length).toBeGreaterThan(1);

      for (const line of command.split("\n")) {
        expect(line.split("$(git rev-parse HEAD)").length).toBeLessThan(3);
      }
    }

    expect([...facts.matchAll(/<code\b[^>]*select-all/gu)]).toHaveLength(2);
  });

  it("shows each command whole: a real CLI command, with every flag its payload takes and --yes", () => {
    const lines = commandsOf(inspectorOf(markupOf(page)));

    expect(lines.map((line) => commandOf(line)?.contract)).toStrictEqual([
      "openAsk",
      "land",
    ]);

    for (const line of lines) {
      const doc = commandOf(line);
      const given = line.split(" ").filter((word) => word.startsWith("--"));

      const payload = (doc?.flags ?? []).filter(
        (flag) => !["--dry-run", "--json", "--yes"].includes(flag)
      );

      expect(
        given.filter((flag) => !(doc?.flags ?? []).includes(flag))
      ).toStrictEqual([]);
      expect(payload.filter((flag) => !given.includes(flag))).toStrictEqual([]);
      expect(given.includes("--yes")).toBe(doc?.needsApproval);
    }
  });

  it("adds no sealed path, check name, salt or read log to what it was given", () => {
    const markup = markupOf(page);

    for (const leak of [
      "layers/",
      "held-back/",
      ".test.ts",
      "sha256:",
      "read log",
    ]) {
      expect(markup).not.toContain(leak);
    }
  });

  it("says a project without a project.ts runs on defaults, its initializer deciding everything", () => {
    const view = (
      <PeopleView
        ledger={burrowLedger}
        policy={Option.some(burrowPolicy)}
        project={ProjectName.make("oscabriel/burrow")}
        unevaluated={Option.none()}
      />
    );

    const markup = markupOf(view);

    expect(textOf(view)).toContain(
      `This project has no ${Brand.configDir}/project.ts: the person who set it up decides everything`
    );
    expect(decidersOf(markup)).toStrictEqual(["** wren"]);
    expect(markup).not.toContain(`/${Brand.configDir}/project.ts"`);
    expect(textOf(view)).toContain("vouches for nobody");
  });

  it("says nothing has landed yet, and shows no rules, when there is no policy and no reason", () => {
    const view = (
      <PeopleView
        ledger={datekitLedger}
        policy={Option.none()}
        project={datekit}
        unevaluated={Option.none()}
      />
    );

    const markup = markupOf(view);

    expect(textOf(view)).toContain("Nothing has landed yet");
    expect(markup).not.toContain("data-paths=");
    expect(markup).not.toContain('id="vouching"');
  });

  it("says a config with no config folder has not been evaluated, at which commit, and why", () => {
    const view = (
      <PeopleView
        ledger={burrowLedger}
        policy={Option.none()}
        project={ProjectName.make("oscabriel/burrow")}
        unevaluated={Option.some(noConfig)}
      />
    );

    const text = textOf(view);
    const markup = markupOf(view);

    expect(
      inOrder(text, [
        `The config at the landed commit ${sha.slice(0, 7)} has not been evaluated`,
        `the project has no ${Brand.configDir}/ folder`,
        "the defaults need a test command",
        "could not find in its CI or package files",
      ])
    ).toBeTruthy();
    expect(markup).toMatch(
      new RegExp(
        `<a\\b[^>]*href="/burrow/commit/${sha}"[^>]*>${sha.slice(0, 7)}</a>`,
        "u"
      )
    );
    expect(text).toContain(`${Brand.configDir}/project.ts`);
    expect(text).toContain("It is evaluated again at every landing.");
    // Its reason rides on the notice, and no rules are drawn.
    expect([
      markup.includes('data-unevaluated="noConfig"'),
      markup.includes("data-paths="),
    ]).toStrictEqual([true, false]);
  });

  it("offers the CLI lines that make a config with no config folder evaluate, each a real command", () => {
    const markup = markupOf(
      <PeopleView
        ledger={burrowLedger}
        policy={Option.none()}
        project={ProjectName.make("oscabriel/burrow")}
        unevaluated={Option.some(noConfig)}
      />
    );

    const lines = [
      ...commandsOf(mainOf(markup)),
      ...commandsOf(inspectorOf(markup)),
    ];

    expect(lines.map((line) => commandOf(line)?.path.join(" "))).toStrictEqual([
      "init",
      "ask open",
      "land",
    ]);
    expect(lines[0]).toContain("--dry-run");

    for (const line of lines) {
      const flags = commandOf(line)?.flags ?? [];

      expect(
        line
          .split(" ")
          .filter((word) => word.startsWith("--"))
          .filter((flag) => !flags.includes(flag))
      ).toStrictEqual([]);
    }
  });

  it("says a config folder that did not evaluate has not been evaluated, linking the folder at that commit", () => {
    const view = (
      <PeopleView
        ledger={burrowLedger}
        policy={Option.none()}
        project={ProjectName.make("oscabriel/burrow")}
        unevaluated={Option.some({ ...noConfig, reason: "configFailed" })}
      />
    );

    const text = textOf(view);

    expect(markupOf(view)).toContain('data-unevaluated="configFailed"');
    expect(text).toContain(
      `The config at the landed commit ${sha.slice(0, 7)} has not been evaluated: ${Brand.configDir}/ at ${sha.slice(0, 7)} did not evaluate`
    );
    expect(text).toContain(
      `Fix it by landing a change to ${Brand.configDir}/.`
    );
    expect(markupOf(view)).toMatch(
      new RegExp(
        `<a\\b[^>]*href="/burrow/tree/${sha}/${Brand.configDir}"[^>]*>${Brand.configDir}/</a>`,
        "u"
      )
    );
    expect(text).not.toContain("test command");
  });

  it("shows a project without layers as open, with nothing held back", () => {
    const view = (
      <PeopleView
        ledger={burrowLedger}
        policy={Option.some(burrowPolicy)}
        project={ProjectName.make("oscabriel/burrow")}
        unevaluated={Option.none()}
      />
    );

    expect(textOf(view)).toContain("Open: nothing is held back");
  });
});

/** A platform that knows only datekit, counting the reads it is asked for. */
const platformOf = (
  asked: Ref.Ref<number>,
  read: {
    readonly policy?: PublicPolicy;
    readonly unevaluated?: PolicyPending;
  }
) =>
  Layer.effect(Client, RpcTest.makeClient(Contracts)).pipe(
    Layer.provide(
      Layer.mergeAll(
        unanswered,
        Contracts.toLayerHandler("projectPolicy", ({ project }) =>
          Effect.gen(function* () {
            yield* Ref.update(asked, (seen) => seen + 1);

            if (project !== datekit) {
              return yield* new UnknownProject({ project });
            }

            return read;
          })
        ),
        Contracts.toLayerHandler("ledger", ({ project }) =>
          Effect.gen(function* () {
            yield* Ref.update(asked, (seen) => seen + 1);

            if (project !== datekit) {
              return yield* new UnknownProject({ project });
            }

            return datekitLedger;
          })
        ),
        asTester
      )
    )
  );

describe(readPeople, () => {
  it.effect("reads the project's policy and ledger together", () =>
    Effect.gen(function* () {
      const asked = yield* Ref.make(0);

      const read = yield* readPeople("datekit").pipe(
        Effect.provide(platformOf(asked, { policy: datekitPolicy }))
      );

      expect(read.policy?.at).toBe(sha);
      expect(read.ledger.layers.map(({ name }) => name)).toStrictEqual([
        "maintainers",
      ]);
      expect(yield* Ref.get(asked)).toBe(2);
    })
  );

  it.effect(
    "carries no policy, and why, while the config has not evaluated",
    () =>
      Effect.gen(function* () {
        const asked = yield* Ref.make(0);

        const read = yield* readPeople("datekit").pipe(
          Effect.provide(platformOf(asked, { unevaluated: noConfig }))
        );

        expect(read.policy).toBeUndefined();
        expect(read.unevaluated).toStrictEqual({ at: sha, reason: "noConfig" });
      })
  );

  it.effect("carries neither before the first landing", () =>
    Effect.gen(function* () {
      const asked = yield* Ref.make(0);

      const read = yield* readPeople("datekit").pipe(
        Effect.provide(platformOf(asked, {}))
      );

      expect(read).not.toHaveProperty("policy");
      expect(read).not.toHaveProperty("unevaluated");
    })
  );

  it.effect("is a not-found for a project the platform does not know", () =>
    Effect.gen(function* () {
      const asked = yield* Ref.make(0);

      const failed = yield* Effect.flip(
        readPeople("no-such-project").pipe(
          Effect.provide(platformOf(asked, { policy: datekitPolicy }))
        )
      );

      expect(isNotFound(failed)).toBeTruthy();
    })
  );

  it.effect(
    "is a not-found, asking nothing, for an address that names no project",
    () =>
      Effect.gen(function* () {
        const asked = yield* Ref.make(0);

        const failed = yield* Effect.flip(
          readPeople("Not_A-Project").pipe(
            Effect.provide(platformOf(asked, { policy: datekitPolicy }))
          )
        );

        expect(isNotFound(failed)).toBeTruthy();
        expect(yield* Ref.get(asked)).toBe(0);
      })
  );
});

describe("the people view", () => {
  // Views only: props in, markup out, and outside the visibility cartridge.
  const sources: Readonly<Record<string, string>> = import.meta.glob(
    "../src/features/project-people/**/*.{ts,tsx}",
    { eager: true, import: "default", query: "?raw" }
  );

  const reaching =
    /from\s+["'](?:@repo\/visibility[^"']*|@repo\/protocol\/contracts|effect\/(?:rpc|http|reactivity)|#backend|[./]+\/(?:surfaces|client\/[^"']*|server\/[^"']*)(?:\.tsx?)?)["']|\.visibility\b/u;

  it("imports no transport, nothing from the visibility cartridge, and reads no policy layers", () => {
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(1);

    expect(
      Object.entries(sources).flatMap(([path, source]) =>
        reaching.test(source) ? [path] : []
      )
    ).toStrictEqual([]);
  });
});
