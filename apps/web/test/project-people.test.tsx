/**
 * A project's people page, rendered to HTML with `react-dom/server` from
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
import { PublicPolicy } from "@repo/protocol/domain/policy";
import { Ledger } from "@repo/protocol/domain/visibility";
import { ProjectName } from "@repo/protocol/ids";
import { UnknownProject } from "@repo/protocol/refusal";
import { asTester, unanswered } from "@repo/protocol/testing";
import { isNotFound } from "@tanstack/react-router";
import { Effect, Layer, Option, Ref, Schema } from "effect";
import { RpcTest } from "effect/rpc";

import { PeopleView } from "../src/features/project-people/people-view.tsx";
import { readPeople } from "../src/routes/$project/people.tsx";
import { inOrder, markupOf, plainText, textOf } from "./ask-fixtures.ts";

const datekit = ProjectName.make("datekit");

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
  />
);

/** The markup from `start` up to `end` (or to the end): one section of the page. */
const between = (markup: string, start: string, end?: string) =>
  markup.slice(
    markup.indexOf(start),
    end === undefined ? undefined : markup.indexOf(end)
  );

/** The markup of the section whose heading has the id `id`. */
const sectionOf = (markup: string, id: string) => {
  const heading = markup.indexOf(`id="${id}"`);

  return markup.slice(
    markup.lastIndexOf("<section", heading),
    markup.indexOf("</section>", heading)
  );
};

/** Each shell line the page offers to copy, as typed. */
const commandsOf = (markup: string) =>
  [
    ...markup.matchAll(/<code\b[^>]*select-all[^>]*>(?<line>.*?)<\/code>/gsu),
  ].map((found) => plainText(found.groups?.line ?? "").trim());

/** The CLI command a line runs: the longest command path it starts with. */
const commandOf = (line: string) =>
  commandDocs(Contracts)
    .filter(({ path }) => line.startsWith(`${Brand.cli} ${path.join(" ")} `))
    .toSorted((one, other) => other.path.length - one.path.length)
    .at(0);

/** Each `<tr>`'s text, in order. */
const rowsOf = (markup: string) =>
  [...markup.matchAll(/<tr\b[^>]*>(?<row>.*?)<\/tr>/gsu)].map((found) =>
    plainText(found.groups?.row ?? "").trim()
  );

describe("a project's people page", () => {
  it("lists who decides which paths, in the policy's order, each handle linked to their page", () => {
    const markup = markupOf(page);
    const table = between(markup, "<table", "</table>");

    expect(rowsOf(table)).toStrictEqual([
      "Paths Deciders",
      "** ines-v",
      "src/format/** okonkwo , bram",
      "src/tz.ts okonkwo",
    ]);
    expect(table).toMatch(
      /<a\b[^>]*href="\/people\/okonkwo"[^>]*>okonkwo<\/a>/u
    );
    expect(table).toMatch(/<a\b[^>]*href="\/people\/bram"[^>]*>bram<\/a>/u);
  });

  it("states the vouch rule in words and splits the file into vouched and denounced, with notes", () => {
    const markup = markupOf(page);
    const vouching = plainText(between(markup, 'id="vouching"', 'id="layers"'));

    expect(vouching).toContain("For code");
    expect(
      inOrder(vouching, [
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
    expect(markup).toContain(
      `href="/datekit/blob/${sha}/${Brand.configDir}/vouched.td"`
    );
  });

  it("shows each layer's audience, readers, writers, disclosure, reason and sunset, from the ledger", () => {
    const layers = plainText(
      between(markupOf(page), 'id="layers"', 'id="limits"')
    );

    expect(
      inOrder(layers, [
        "maintainers",
        "Audience",
        "maintainers",
        "Readers",
        "the deciders",
        "Writers",
        "ines-v",
        "okonkwo",
        "Disclosure",
        "sealed",
        "Reason",
        "Held-back checks judge an answer by the ask's words.",
        "Sunset",
        "90 days",
      ])
    ).toBeTruthy();
  });

  it("shows the caps, budget, claim timing and record window", () => {
    const limits = plainText(
      between(markupOf(page), 'id="limits"', 'id="agents"')
    );

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
      expect(limits).toContain(words);
    }
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

  it("links the file each section comes from, inside that section", () => {
    const markup = markupOf(page);
    const projectFile = `href="/datekit/blob/${sha}/${Brand.configDir}/project.ts"`;

    for (const id of ["deciders", "limits", "agents"]) {
      expect(sectionOf(markup, id)).toContain(projectFile);
    }

    expect(sectionOf(markup, "vouching")).toContain(
      `href="/datekit/blob/${sha}/${Brand.configDir}/vouched.td"`
    );
    expect(markup.split(projectFile)).toHaveLength(4);
  });

  it("says which commit it is as of, and links each source file at that commit", () => {
    const markup = markupOf(page);

    expect(textOf(page)).toContain(`As of ${sha.slice(0, 7)}`);
    expect(markup).toMatch(
      new RegExp(
        `<a\\b[^>]*href="/datekit/commit/${sha}"[^>]*>${sha.slice(0, 7)}</a>`,
        "u"
      )
    );
    expect(markup).toContain(
      `href="/datekit/blob/${sha}/${Brand.configDir}/project.ts"`
    );
  });

  it("offers no control, only how to change it: land a change to the config folder", () => {
    const markup = markupOf(page);
    const text = plainText(markup);

    for (const control of ["<input", "<textarea", "<form", "<select"]) {
      expect(markup).not.toContain(control);
    }

    expect(text).toContain(
      `Change these by landing a change to ${Brand.configDir}/`
    );
    expect(text).toContain(`${Brand.cli} ask open`);
    expect(text).toContain(`${Brand.cli} land`);
  });

  it("shows each command whole: a real CLI command, with every flag its payload takes and --yes", () => {
    const lines = commandsOf(markupOf(page));

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
        project={ProjectName.make("burrow")}
      />
    );

    const markup = markupOf(view);

    expect(textOf(view)).toContain(
      `This project has no ${Brand.configDir}/project.ts: the person who set it up decides everything`
    );
    expect(rowsOf(between(markup, "<table", "</table>"))).toStrictEqual([
      "Paths Deciders",
      "** wren",
    ]);
    expect(markup).not.toContain(`/${Brand.configDir}/project.ts"`);
    expect(textOf(view)).toContain("vouches for nobody");
  });

  it("says the config has not been evaluated yet, and shows no tables, when there is no policy", () => {
    const view = (
      <PeopleView
        ledger={datekitLedger}
        policy={Option.none()}
        project={datekit}
      />
    );

    const markup = markupOf(view);

    expect(textOf(view)).toContain("has not been evaluated yet");
    expect(markup).not.toContain("<table");
    expect(markup).not.toContain('id="vouching"');
  });

  it("shows a project without layers as open, with nothing held back", () => {
    const view = (
      <PeopleView
        ledger={burrowLedger}
        policy={Option.some(burrowPolicy)}
        project={ProjectName.make("burrow")}
      />
    );

    expect(textOf(view)).toContain("Open: nothing is held back");
  });
});

/** A platform that knows only datekit, counting the reads it is asked for. */
const platformOf = (
  asked: Ref.Ref<number>,
  policy: Option.Option<PublicPolicy>
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

            return Option.match(policy, {
              onNone: () => ({}),
              onSome: (evaluated) => ({ policy: evaluated }),
            });
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
        Effect.provide(platformOf(asked, Option.some(datekitPolicy)))
      );

      expect(read.policy?.at).toBe(sha);
      expect(read.ledger.layers.map(({ name }) => name)).toStrictEqual([
        "maintainers",
      ]);
      expect(yield* Ref.get(asked)).toBe(2);
    })
  );

  it.effect("carries no policy while the config has not evaluated", () =>
    Effect.gen(function* () {
      const asked = yield* Ref.make(0);

      const read = yield* readPeople("datekit").pipe(
        Effect.provide(platformOf(asked, Option.none()))
      );

      expect(read.policy).toBeUndefined();
    })
  );

  it.effect("is a not-found for a project the platform does not know", () =>
    Effect.gen(function* () {
      const asked = yield* Ref.make(0);

      const failed = yield* Effect.flip(
        readPeople("no-such-project").pipe(
          Effect.provide(platformOf(asked, Option.some(datekitPolicy)))
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
            Effect.provide(platformOf(asked, Option.some(datekitPolicy)))
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
