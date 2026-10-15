import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Client, Contracts } from "@repo/protocol/contracts";
import type { Ask } from "@repo/protocol/domain/ask";
import type { ClaimView } from "@repo/protocol/domain/claim";
import { Outcome } from "@repo/protocol/domain/outcome";
import {
  AskId,
  BlobSha,
  CommitSha,
  Handle,
  ProjectName,
  RepoName,
  RepoPath,
} from "@repo/protocol/ids";
import {
  OutOfScope,
  UnknownAsk,
  UnknownPath,
  UnknownProject,
} from "@repo/protocol/refusal";
import { explain } from "@repo/protocol/render";
import { asTester, unanswered } from "@repo/protocol/testing";
import { isNotFound } from "@tanstack/react-router";
import { DateTime, Effect, Exit, Layer, Ref, Schema, Stream } from "effect";
import { Atom, AtomRegistry, Reactivity } from "effect/reactivity";
import { RpcTest } from "effect/rpc";

import { claimAtom, releaseAtom } from "../src/client/claim.ts";
import { keys } from "../src/client/keys.ts";
import { readAsk } from "../src/features/answer/reads.ts";
import { AskView } from "../src/features/ask/ask-page.tsx";
import { NoSuchAsk } from "../src/features/ask/refused.tsx";
import { askStates } from "../src/features/shared/ask-progress.ts";
import type { ClaimControl } from "../src/features/shared/facts.tsx";
import { Refusals } from "../src/features/shared/refusals.ts";
import { ContractsClient, webContracts } from "../src/surfaces.ts";
import {
  ask,
  askId,
  brief,
  claimedEvent,
  closedEvent,
  family,
  inOrder,
  judgedEvent,
  landedSha,
  markupOf,
  now,
  plainText,
  project,
  textOf,
  verdictOf,
} from "./ask-fixtures.ts";
import { textIn } from "./markup.ts";

const inPre = (markup: string) =>
  /<pre\b[^>]*>(?<inner>.*?)<\/pre>/su.exec(markup)?.groups?.inner;

const mainOf = (markup: string) =>
  /<main\b[^>]*>(?<inner>.*)<\/main>/su.exec(markup)?.groups?.inner ?? "";

const trailOf = (markup: string) =>
  /<nav aria-label="Breadcrumb"[^>]*>(?<inner>.*?)<\/nav>/su.exec(markup)
    ?.groups?.inner ?? "";

type AskProps = Parameters<typeof AskView>[0];

const tamsin = Handle.make("tamsin");

const ignore = () => {};

const forkRemote =
  "https://git.example.dev/oscabriel/datekit--parse-iso-week--tamsin.git";

const claiming = (overrides: Partial<ClaimControl> = {}): ClaimControl => ({
  busy: false,
  here: `/${project}/asks/${askId}`,
  onClaim: ignore,
  onRelease: ignore,
  signedIn: true,
  ...overrides,
});

const page = (shown = ask, more: Partial<AskProps> = {}) => (
  <AskView ask={shown} brief={brief} now={now} {...more} />
);

const checkSource = (lines: number) => ({
  path: RepoPath.make("test/parse-week.test.ts"),
  sha: "f".repeat(40),
  text: Array.from(
    { length: lines },
    (_, index) => `expect(parseWeek("2026-W41-${index}")).not.toBeNull();`
  ).join("\n"),
});

describe(AskView, () => {
  it("titles the page with the want, then reads the brief's sections in order", () => {
    const markup = markupOf(page());

    expect(markup).toMatch(
      /<h1\b[^>]*>Parse ISO week dates like 2026-W41-3<\/h1>/u
    );
    expect(
      inOrder(textOf(page()), [
        "Current behaviour",
        "parseWeek returns null for 2026-W41-3.",
        "Out of scope",
        "Formatting week dates back to strings.",
        "Terms",
        "Week date: a date written as year, week and weekday.",
        "Context",
        "ISO 8601 numbers weeks from the Monday of the week holding 4 January.",
      ])
    ).toBeTruthy();
  });

  it("sets a want of 80 characters at the headline, and a longer one a step down, whole", () => {
    const want =
      "The linter reports a heading that skips a level, such as a level-two heading followed by a level-four one.";

    const long = markupOf(page({ ...ask, brief: { ...ask.brief, want } }));

    expect(
      /<h1\b[^>]*class="(?<classes>[^"]*)"/u.exec(long)?.groups?.classes
    ).toContain("text-title");
    expect(long).toContain(`>${want}</h1>`);
    expect(
      /<h1\b[^>]*class="(?<classes>[^"]*)"/u.exec(markupOf(page()))?.groups
        ?.classes
    ).toContain("text-headline");
  });

  it("leaves out a section the brief does not have", () => {
    const text = textOf(
      page({ ...ask, brief: { want: "Parse ISO week dates like 2026-W41-3" } })
    );

    expect(text).not.toContain("Current behaviour");
    expect(text).not.toContain("Out of scope");
    expect(text).not.toContain("Terms");
  });

  it("names the project, its asks and the ask in the context bar's trail", () => {
    const trail = trailOf(markupOf(page()));

    expect(inOrder(plainText(trail), ["datekit", "Asks", askId])).toBeTruthy();
    expect(trail).toContain('href="/oscabriel/datekit"');
  });

  it("says an open ask is open to take, who it is held for, and gives its kind, asker and age", () => {
    const held = {
      ...ask,
      mentor: Handle.make("okonkwo"),
      reserve: "newcomers" as const,
    };

    const text = textOf(page(held));

    expect(text).toContain("Open to take");
    expect(text).toContain("Held for newcomers, mentored by okonkwo");
    expect(
      inOrder(text, ["fix", "asked by", "ines-v", "opened 2 d ago"])
    ).toBeTruthy();
    expect(markupOf(page(held))).toContain('href="/people/okonkwo"');
    expect(markupOf(page())).toContain('href="/people/ines-v"');
  });

  it("gives the ask's territory and its check", () => {
    const text = textOf(page());

    expect(
      inOrder(text, [
        "Territory and check",
        "@datekit/parse",
        "test/parse-week.test.ts",
      ])
    ).toBeTruthy();
    expect(markupOf(page())).toContain(
      'href="/oscabriel/datekit/blob/main/test/parse-week.test.ts"'
    );
  });

  it("says who may take an open ask, with no command to clone, claim or check", () => {
    const text = textOf(page());

    expect(text).toContain("Take it");
    expect(text).not.toContain("git clone");
    expect(text).not.toContain(`${Brand.cli} claim`);
    expect(text).not.toContain(`${Brand.cli} check`);
  });

  it("claims an ask open to take with a button, once the page hands it a control", () => {
    const markup = markupOf(page(ask, { control: claiming(), viewer: tamsin }));

    expect(markup).toContain('data-action="claim"');
    expect(markup).not.toContain('data-action="release"');
  });

  it("says the reader holds a claim they made from the page, before the events say so", () => {
    const text = textIn(
      markupOf(
        page(ask, {
          claimedHere: tamsin,
          control: claiming({ remote: forkRemote }),
          viewer: tamsin,
        })
      )
    );

    expect(text).toContain("You hold this claim");
    expect(text).toContain(forkRemote);
    expect(text).toContain("Release it");
    expect(text).not.toContain("Claim it");
  });

  it("offers a claimed ask's holder a release, and anyone else neither claim nor release", () => {
    const states = askStates([claimedEvent(1, "tamsin")]);
    const claimed = { ...ask, state: "claimed" } as const;

    const holder = markupOf(
      page(claimed, { control: claiming(), states, viewer: tamsin })
    );

    const other = markupOf(
      page(claimed, {
        control: claiming(),
        states,
        viewer: Handle.make("okonkwo"),
      })
    );

    expect(holder).toContain('data-action="release"');
    expect(other).not.toContain('data-action="release"');
    expect(other).not.toContain('data-action="claim"');
  });

  it("names who holds a claimed ask and offers no way to take it", () => {
    const states = askStates([claimedEvent(1, "tamsin")]);

    const text = textIn(
      markupOf(page({ ...ask, state: "claimed" }, { states }))
    );

    expect(text).toContain("Claimed by tamsin, no answer pushed yet");
    expect(text).toContain("tamsin's move");
    expect(text).not.toContain("Take it");
    expect(text).not.toContain(`${Brand.cli} claim`);
  });

  it("says where a refused answer was refused and whose move it is", () => {
    const refusal = new OutOfScope({ paths: [RepoPath.make("README.md")] });
    const outcome = Outcome.cases.Refused.make({ refusals: [refusal] });

    const states = askStates([
      claimedEvent(1, "tamsin"),
      judgedEvent(2, outcome),
    ]);

    const text = textOf(
      page(
        { ...ask, state: "claimed" },
        { states, verdict: { ...verdictOf(outcome), stage: "shape" } }
      )
    );

    expect(
      inOrder(text, ["Refused", "at Shape", "OutOfScope", "tamsin's move"])
    ).toBeTruthy();
  });

  it("says a landed ask landed, with its commit", () => {
    const states = askStates([
      claimedEvent(1, "tamsin"),
      judgedEvent(2, Outcome.cases.Landed.make({ sha: landedSha })),
      closedEvent(3),
    ]);

    const markup = markupOf(page({ ...ask, state: "closed" }, { states }));

    expect(textOf(page({ ...ask, state: "closed" }, { states }))).toContain(
      "Landed as 9b1c3e5"
    );
    expect(markup).toContain(`href="/oscabriel/datekit/commit/${landedSha}"`);
  });

  it("gives a round the word its landing or verdict has since said, not the one it was judged with", () => {
    const states = askStates([
      claimedEvent(1, "tamsin"),
      judgedEvent(2, Outcome.cases.Checking.make({ stage: "human" })),
      closedEvent(3),
    ]);

    const answers = plainText(
      mainOf(markupOf(page({ ...ask, state: "closed" }, { states })))
    );

    expect(inOrder(answers, ["Round 1", "bbbbbbb", "Landed"])).toBeTruthy();
    expect(answers).not.toContain("Checking");
  });

  it("lists one answer row per judged round, each linking its answer", () => {
    const states = askStates([
      claimedEvent(1, "tamsin"),
      judgedEvent(
        2,
        Outcome.cases.Refused.make({
          refusals: [new OutOfScope({ paths: [RepoPath.make("README.md")] })],
        }),
        CommitSha.make("e".repeat(40))
      ),
      judgedEvent(3, Outcome.cases.Checking.make({ stage: "checks" })),
    ]);

    const main = mainOf(
      markupOf(page({ ...ask, state: "claimed" }, { states }))
    );

    const rows = [
      ...main.matchAll(
        /href="\/oscabriel\/datekit\/answers\/parse-iso-week\?head=(?<head>[0-9a-f]+)"/gu
      ),
    ].map(({ groups }) => groups?.head);

    expect(rows).toStrictEqual(["e".repeat(40), "b".repeat(40)]);
    expect(
      inOrder(plainText(main), [
        "Answers",
        "Round 1",
        "eeeeeee",
        "Refused",
        "Round 2",
        "bbbbbbb",
        "Checking",
      ])
    ).toBeTruthy();
  });

  it("shows the check's source inline when it was read, its first 30 lines until asked for the whole", () => {
    const markup = mainOf(markupOf(page(ask, { check: checkSource(45) })));
    const text = plainText(markup);

    expect(text).toContain('expect(parseWeek("2026-W41-29")).not.toBeNull();');
    expect(text).not.toContain(
      'expect(parseWeek("2026-W41-30")).not.toBeNull();'
    );
    expect(text).toContain("Show the whole check");
    expect(markup).toContain('data-code="plain"');
  });

  it("shows only the check's path when its source could not be read", () => {
    const markup = mainOf(markupOf(page()));

    expect(markup).not.toContain('data-code="plain"');
    expect(markup).toContain(
      'href="/oscabriel/datekit/blob/main/test/parse-week.test.ts"'
    );
  });

  it("says a family's delete child waits for its siblings in the family's terms", () => {
    const { children, deleteChild, parent } = family;
    const states = askStates([closedEvent(1, children[0] ?? parent.id)]);
    const text = textOf(page(deleteChild, { parent, states }));

    expect(text).toContain("Waiting for 2 of 3 children to land");
    expect(text).not.toContain("Waits on");
  });

  it("says a delete child whose siblings all landed is open to take, and never that it waits", () => {
    const { children, deleteChild, parent } = family;

    const states = askStates(
      children.map((child, index) => closedEvent(index + 1, child))
    );

    const markup = markupOf(
      page({ ...deleteChild, state: "open" }, { parent, states })
    );

    const text = textOf(
      page({ ...deleteChild, state: "open" }, { parent, states })
    );

    expect(text).toContain("Open to take");
    expect(text).not.toContain("Waits on");
    expect(text).not.toContain("to land first");
    expect(mainOf(markup)).toContain(`data-family="${parent.id}"`);
  });

  it("says a family's parent waits for its family in the family's terms, never as a list of ids", () => {
    const { children, deleteChild, parent } = family;
    const states = askStates([closedEvent(1, children[0] ?? parent.id)]);
    const markup = mainOf(markupOf(page(parent, { states })));

    expect(plainText(markup)).toContain(
      "Waits for 2 of 3 children and the delete step to land first; a claim waits until they do."
    );
    expect(plainText(markup)).not.toContain("Waits on");
    expect(markup).toContain(
      `href="/oscabriel/datekit/asks/${deleteChild.id}"`
    );
  });

  it("says a family's parent whose children all landed waits only for the delete step", () => {
    const { children, parent } = family;

    const states = askStates(
      children.map((child, index) => closedEvent(index + 1, child))
    );

    expect(plainText(mainOf(markupOf(page(parent, { states }))))).toContain(
      "Waits for the delete step to land first"
    );
  });

  it("names the asks an ask outside a family waits on, each linking to its page", () => {
    const blocked = {
      ...ask,
      blockedBy: [AskId.make("split-format"), AskId.make("split-parse")],
    };

    const text = textOf(page(blocked));
    const markup = markupOf(page(blocked));

    expect(
      inOrder(text, [
        "Waits on",
        "split-format",
        "split-parse",
        "to land first",
      ])
    ).toBeTruthy();
    expect(markup).toContain('href="/oscabriel/datekit/asks/split-format"');
    expect(markup).toContain('href="/oscabriel/datekit/asks/split-parse"');
  });

  it("names nothing it waits on when nothing blocks it, or what blocked it landed", () => {
    expect(textOf(page())).not.toContain("Waits on");

    const states = askStates([closedEvent(1, AskId.make("split-format"))]);

    expect(
      textOf(
        page({ ...ask, blockedBy: [AskId.make("split-format")] }, { states })
      )
    ).not.toContain("Waits on");
  });

  it("gives no claim line once the ask is closed", () => {
    const text = textOf(page({ ...ask, state: "closed" }));

    expect(text).toContain("Closed");
    expect(text).not.toContain(`${Brand.cli} claim`);
  });

  it("links to the ask's Markdown and to the verdict on its latest answer", () => {
    const markup = markupOf(page());

    expect(markup).toContain(`href="/oscabriel/datekit/asks/${askId}.md"`);
    expect(markup).toContain(`href="/oscabriel/datekit/answers/${askId}"`);
  });

  it("shows the brief exactly as an agent reads it", () => {
    expect(inPre(markupOf(page()))).toBe(inPre(markupOf(<pre>{brief}</pre>)));
  });

  it("gives the project's posture when the list of projects has it", () => {
    const text = textOf(page(ask, { posture: "openWithSealedEvidence" }));

    expect(text).toContain("Open with sealed evidence");
  });
});

describe(NoSuchAsk, () => {
  it("shows the refusal a loader's not-found carried from the server, as git printed it", () => {
    const refusal = new UnknownAsk({ ask: AskId.make("no-such-ask") });

    // The not-found's data, as it crosses from the server: encoded, then cloned.
    const data = structuredClone(Schema.encodeSync(Refusals)([refusal]));

    expect(
      inOrder(textOf(<NoSuchAsk data={data} />), [
        "No such ask",
        ...explain([refusal]).map((line) => line.trim()),
      ])
    ).toBeTruthy();
  });

  it("says nothing is at an address that names no ask at all", () => {
    expect(textOf(<NoSuchAsk />)).toContain("Nothing is at this address");
  });

  it("offers the way onward: the project, and the open asks", () => {
    const markup = markupOf(<NoSuchAsk project="datekit" />);

    expect(markup).toContain('href="/oscabriel/datekit"');
    expect(markup).toContain('href="/asks"');
    expect(textOf(<NoSuchAsk project="datekit" />)).toContain("Open asks");
  });

  it("names the project and its asks in the trail, and no crumb for the ask that is not there", () => {
    const refusal = new UnknownAsk({ ask: AskId.make("no-such-ask") });
    const data = structuredClone(Schema.encodeSync(Refusals)([refusal]));

    const trail = trailOf(
      markupOf(<NoSuchAsk data={data} project="datekit" />)
    );

    expect(inOrder(plainText(trail), ["datekit", "Asks"])).toBeTruthy();
    expect(trail).toContain('href="/oscabriel/datekit"');
    expect(trail).not.toContain("no-such-ask");
  });

  it("links no project the platform says it does not have", () => {
    const refusal = new UnknownProject({
      project: ProjectName.make("oscabriel/nowhere"),
    });

    const data = structuredClone(Schema.encodeSync(Refusals)([refusal]));
    const markup = markupOf(<NoSuchAsk data={data} project="nowhere" />);

    expect(markup).not.toContain('href="/nowhere"');
    expect(markup).toContain('href="/asks"');
  });

  it("says what its route gives it when a not-found carries no refusal", () => {
    expect(
      textOf(<NoSuchAsk nothing="No answer is at this head." />)
    ).toContain("No answer is at this head.");
  });
});

interface Asked {
  readonly asks: number;
  readonly files: number;
  readonly replays: number;
  readonly verdicts: number;
}

const nothingAsked: Asked = { asks: 0, files: 0, replays: 0, verdicts: 0 };

const count = (asked: Ref.Ref<Asked>, key: keyof Asked) =>
  Ref.update(asked, (seen) => ({ ...seen, [key]: seen[key] + 1 }));

const replay = [
  claimedEvent(1, "tamsin"),
  claimedEvent(2, "okafor", AskId.make("format-week")),
];

const platformOf = (
  asked: Ref.Ref<Asked>,
  {
    readable = true,
    shown = ask,
  }: { readonly readable?: boolean; readonly shown?: Ask } = {}
) =>
  Layer.effect(Client, RpcTest.makeClient(Contracts)).pipe(
    Layer.provide([
      Layer.mergeAll(
        unanswered,
        Contracts.toLayerHandler("showAsk", (payload) =>
          Effect.gen(function* () {
            yield* count(asked, "asks");

            if (payload.ask === family.parent.id) {
              return { ask: family.parent, brief };
            }

            if (payload.ask !== askId) {
              return yield* new UnknownAsk({ ask: payload.ask });
            }

            return { ask: shown, brief };
          })
        ),
        Contracts.toLayerHandler("verdict", () =>
          Effect.as(count(asked, "verdicts"), {})
        ),
        Contracts.toLayerHandler("watch", () =>
          Stream.fromEffect(count(asked, "replays")).pipe(
            Stream.flatMap(() => Stream.fromIterable(replay))
          )
        ),
        Contracts.toLayerHandler("readFile", (payload) =>
          Effect.gen(function* () {
            yield* count(asked, "files");

            if (!readable) {
              return yield* new UnknownPath({
                commit: CommitSha.make("a".repeat(40)),
                path: payload.path,
              });
            }

            return {
              at: CommitSha.make("a".repeat(40)),
              binary: false,
              path: payload.path,
              sha: BlobSha.make("f".repeat(40)),
              size: 42,
              text: 'test("parses", () => {});',
              truncated: false,
            };
          })
        )
      ),
      asTester,
    ])
  );

describe(readAsk, () => {
  it.effect(
    "reads the ask, its brief, its events and its check's source for the page",
    () =>
      Effect.gen(function* () {
        const asked = yield* Ref.make(nothingAsked);

        const read = yield* readAsk({ ask: askId, project }).pipe(
          Effect.provide(platformOf(asked))
        );

        expect({
          ask: read.ask.id,
          brief: read.brief,
          check: read.check?.text,
          events: read.events.map(({ seq }) => seq),
          lastSeq: read.lastSeq,
          parent: read.parent,
        }).toStrictEqual({
          ask: askId,
          brief,
          check: 'test("parses", () => {});',
          events: [1],
          lastSeq: 2,
          parent: undefined,
        });
        expect(yield* Ref.get(asked)).toStrictEqual({
          asks: 1,
          files: 1,
          replays: 1,
          verdicts: 1,
        });
      })
  );

  it.effect(
    "reads a family member's parent, and shows the ask without its check's source when the file cannot be read",
    () =>
      Effect.gen(function* () {
        const asked = yield* Ref.make(nothingAsked);

        const read = yield* readAsk({ ask: askId, project }).pipe(
          Effect.provide(
            platformOf(asked, {
              readable: false,
              shown: { ...family.child(0), check: ask.check, id: askId },
            })
          )
        );

        expect(read.parent?.id).toBe(family.parent.id);
        expect(read.check).toBeUndefined();
        expect((yield* Ref.get(asked)).asks).toBe(2);
      })
  );

  it.effect(
    "is a not-found carrying the UnknownAsk refusal for an ask the project lacks",
    () =>
      Effect.gen(function* () {
        const asked = yield* Ref.make(nothingAsked);
        const missing = AskId.make("no-such-ask");

        const failed = yield* Effect.flip(
          readAsk({ ask: missing, project }).pipe(
            Effect.provide(platformOf(asked))
          )
        );

        expect(isNotFound(failed)).toBeTruthy();

        const carried = yield* Schema.decodeUnknownEffect(Refusals)(
          isNotFound(failed) ? failed.data : undefined
        );

        expect(explain(carried)).toStrictEqual(
          explain([new UnknownAsk({ ask: missing })])
        );
      })
  );

  it.effect(
    "is a not-found with no refusal, and asks nothing, for a name no ask can have",
    () =>
      Effect.gen(function* () {
        const asked = yield* Ref.make(nothingAsked);

        const failed = yield* Effect.flip(
          readAsk({ ask: "Not_An-Ask", project }).pipe(
            Effect.provide(platformOf(asked))
          )
        );

        expect(isNotFound(failed)).toBeTruthy();
        expect(
          isNotFound(failed) ? failed.data : "not a not-found"
        ).toBeUndefined();
        expect(yield* Ref.get(asked)).toStrictEqual(nothingAsked);
      })
  );
});

const claimView: ClaimView = {
  ask: askId,
  base: CommitSha.make("a".repeat(40)),
  checkCommand: "bun test",
  claimant: tamsin,
  fork: RepoName.make("datekit--parse-iso-week--tamsin"),
  lapsesAt: DateTime.add(now, { days: 3 }),
  openedAt: now,
  project,
  remote: forkRemote,
  state: "live",
  warnsAt: DateTime.add(now, { days: 2 }),
};

interface Sent {
  readonly claim: readonly unknown[];
  readonly release: readonly unknown[];
  readonly showAsk: number;
}

const claimContracts = (sent: Ref.Ref<Sent>) =>
  Layer.effect(ContractsClient)(
    RpcTest.makeClient(webContracts, { flatten: true })
  ).pipe(
    Layer.provide([
      Layer.mergeAll(
        unanswered,
        Contracts.toLayerHandler("claim", (payload) =>
          Ref.update(sent, (all) => ({
            ...all,
            claim: [...all.claim, payload],
          })).pipe(Effect.as({ claim: claimView }))
        ),
        Contracts.toLayerHandler("release", (payload) =>
          Ref.update(sent, (all) => ({
            ...all,
            release: [...all.release, payload],
          })).pipe(Effect.as({ released: true }))
        ),
        Contracts.toLayerHandler("showAsk", () =>
          Ref.update(sent, (all) => ({
            ...all,
            showAsk: all.showAsk + 1,
          })).pipe(Effect.as({ ask, brief }))
        )
      ),
      asTester,
    ]),
    Layer.provideMerge(Reactivity.layer)
  );

const theAsk = ContractsClient.query(
  "showAsk",
  { ask: askId, project },
  { reactivityKeys: keys.ask(project, askId) }
);

const pressing = (which: "claim" | "release") =>
  Effect.gen(function* () {
    const sent = yield* Ref.make<Sent>({ claim: [], release: [], showAsk: 0 });

    const registry = yield* Effect.acquireRelease(
      Effect.sync(() =>
        AtomRegistry.make({
          initialValues: [
            Atom.initialValue(
              ContractsClient.runtime.layer,
              claimContracts(sent)
            ),
          ],
        })
      ),
      (made) =>
        Effect.sync(() => {
          made.dispose();
        })
    );

    registry.mount(theAsk);
    yield* AtomRegistry.getResult(registry, theAsk);

    const input = { ask: askId, project };

    const succeeded =
      which === "claim"
        ? yield* Effect.exit(
            Effect.suspend(() => {
              registry.mount(claimAtom);
              registry.set(claimAtom, input);

              return AtomRegistry.getResult(registry, claimAtom, {
                suspendOnWaiting: true,
              });
            })
          ).pipe(Effect.map(Exit.isSuccess))
        : yield* Effect.exit(
            Effect.suspend(() => {
              registry.mount(releaseAtom);
              registry.set(releaseAtom, input);

              return AtomRegistry.getResult(registry, releaseAtom, {
                suspendOnWaiting: true,
              });
            })
          ).pipe(Effect.map(Exit.isSuccess));

    yield* AtomRegistry.getResult(registry, theAsk, { suspendOnWaiting: true });

    return { sent: yield* Ref.get(sent), succeeded };
  }).pipe(Effect.scoped);

describe("claiming from the ask page", () => {
  it.live(
    "sends the ask and its project as the claim, and reads the ask again",
    () =>
      Effect.gen(function* () {
        const { sent, succeeded } = yield* pressing("claim");

        expect(succeeded).toBeTruthy();
        expect(sent.claim).toStrictEqual([{ ask: askId, project }]);
        expect(sent.showAsk).toBe(2);
      })
  );

  it.live(
    "sends the ask and its project as the release, and reads the ask again",
    () =>
      Effect.gen(function* () {
        const { sent, succeeded } = yield* pressing("release");

        expect(succeeded).toBeTruthy();
        expect(sent.release).toStrictEqual([{ ask: askId, project }]);
        expect(sent.showAsk).toBe(2);
      })
  );
});
