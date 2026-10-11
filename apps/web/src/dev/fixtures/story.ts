/**
 * How a fixture project's record is written: a story told in the order
 * things happened, each step writing what the service would have written
 * for it (the events `watch` replays, numbered in order, the asks, each
 * round's verdict, the claims and the landings). A landing is a real
 * commit on the project's canonical `main` in the world's repo host,
 * committed by the platform with its credit trailers, so the code pages,
 * the log and every landing link read real git. An answer's head names no
 * commit the world holds (its fork is never made): it is a stable id made
 * from the step's name, as are merged trees, patch ids and suite roots.
 */
import { RefName, RefOutcome, RepoHost } from "@repo/artifacts/repo-host";
import { Brand } from "@repo/brand";
import { formatLanding } from "@repo/git/trailers";
import { listingOf } from "@repo/project/events";
import type {
  AnswerView,
  HeldBackResult,
  LaneOutcome,
  LaneResult,
  Verdict,
} from "@repo/protocol/domain/answer";
import type { Ask } from "@repo/protocol/domain/ask";
import { CheckSpec } from "@repo/protocol/domain/check";
import type { ClaimState, ClaimView } from "@repo/protocol/domain/claim";
import type { ForkRef } from "@repo/protocol/domain/code";
import type { AgentTrailer, Credit } from "@repo/protocol/domain/credit";
import type { Decision } from "@repo/protocol/domain/decision";
import { ProjectEvent } from "@repo/protocol/domain/event";
import type { LandingView } from "@repo/protocol/domain/landing";
import { Outcome } from "@repo/protocol/domain/outcome";
import type { StageName } from "@repo/protocol/domain/outcome";
import type { LedgerEntry } from "@repo/protocol/domain/visibility";
import {
  CheckVersion,
  CommitSha,
  LandedSha,
  claimForkName,
  keyOf,
  LaneName,
  PatchId,
  RepoName,
  RequestId,
  SuiteRoot,
  TreeSha,
} from "@repo/protocol/ids";
import type {
  AskId,
  Handle,
  ProjectName,
  ProposalId,
} from "@repo/protocol/ids";
import { Array, DateTime, Effect, Option, Record } from "effect";

import { overlay, personIdentity, platformIdentity, scratch } from "../git.ts";
import type { Files } from "../git.ts";
import type { FixtureRecord, HeldProposal, KeptLog } from "./record.ts";

// ------------------------------------------------------------- ids

/** The largest prime below 2^32: each block of eight digits is a hash modulo it. */
const MODULUS = 4_294_967_291;

/** `count` hex digits made from `label` alone: a polynomial hash, a fresh seed per eight digits. */
export const hexOf = (label: string, count: number): string => {
  let out = "";

  for (let block = 0; out.length < count; block += 1) {
    let hash = 2_166_136_261 + block * 16_777_619;

    for (const char of `${block}:${label}`) {
      hash = (hash * 257 + (char.codePointAt(0) ?? 0)) % MODULUS;
    }

    out += hash.toString(16).padStart(8, "0");
  }

  return out.slice(0, count);
};

/** `{ [key]: value }` when there is a value, else nothing: an optional key, spread. */
export const present = <K extends string, A>(
  key: K,
  value: A | undefined
): Partial<Record<K, A>> =>
  Option.match(Option.fromUndefinedOr(value), {
    onNone: () => ({}),
    onSome: (held) => Record.singleton(key, held),
  });

/** A commit id made from `label`: an answer's head, which no repo of the world holds. */
export const headOf = (label: string) => CommitSha.make(hexOf(label, 40));

/** A held-back suite's commitment, made from its area's name. */
export const suiteOf = (area: string) =>
  SuiteRoot.make(`sha256:${hexOf(`suite:${area}`, 64)}`);

/** An instant of the dev world's calendar (`clock.ts`), from `2026-10-07T10:00`, in UTC. */
export const instant = (text: string): DateTime.Utc =>
  DateTime.toUtc(DateTime.makeUnsafe(`${text}:00Z`));

// ----------------------------------------------------------- lanes

/** The project's own lanes, by name, with their commands. */
export type Lanes = Readonly<Record<string, string>>;

/** The lane an ask's own check reports as, and its command. */
const askLane = (ask: Ask, test: string): readonly [string, string] =>
  CheckSpec.match(ask.check, {
    LintToZero: ({ command }) => ["lintToZero", command],
    Migrate: ({ count }) => ["migrate", count],
    Ratchet: ({ ratchet }) => ["ratchet", `ratchet ${ratchet}`],
    RedThenGreen: ({ path }) => ["redThenGreen", test.replace("{path}", path)],
    SymbolAbsent: ({ count }) => ["symbolAbsent", count],
  });

// ------------------------------------------------------------ story

/** What one landing carries beside its commit. */
interface LandingInput {
  readonly assisted?: readonly AgentTrailer[];
  readonly at: DateTime.Utc;
  readonly author: Handle;
  readonly ask?: AskId;
  readonly changes: Files;
  readonly credits: readonly Credit[];
  readonly heldBack?: string;
  readonly message: { readonly body: string; readonly subject: string };
  readonly opened?: AskId;
  readonly requestId: RequestId;
  readonly verdict?: Verdict;
}

/** One claim as the story keeps it. */
interface Held {
  readonly at: DateTime.Utc;
  readonly base: LandedSha;
  readonly claimant: Handle;
  readonly lastPush?: DateTime.Utc;
  readonly state: ClaimState;
  readonly suite?: SuiteRoot;
}

/**
 * A story over `project`'s canonical repo, whose `main` stands at `base`
 * with `files`: each step writes what the service would, in order.
 */
export const storyOf = (input: {
  readonly base: LandedSha;
  readonly files: Files;
  readonly lanes: Lanes;
  readonly project: ProjectName;
  readonly test: string;
  readonly lapseAfter: { readonly hours: number };
  readonly warnAfter: { readonly hours: number };
}) =>
  Effect.gen(function* () {
    const host = yield* RepoHost;
    const { project } = input;
    const repo = RepoName.make(keyOf(project));
    const main = RefName.make("refs/heads/main");

    let head = input.base;
    let { files } = input;
    const asks = new Map<AskId, Ask>();
    const events: ProjectEvent[] = [];
    const verdicts = new Map<AskId, Verdict[]>();
    const answers: AnswerView[] = [];
    const landings: LandingView[] = [];
    const claims = new Map<AskId, Held[]>();
    const decisions: Decision[] = [];
    const ledger: LedgerEntry[] = [];
    const proposals = new Map<ProposalId, HeldProposal>();
    const logs = new Map<string, KeptLog>();
    const firstClaims = new Map<Handle, DateTime.Utc>();

    const nextSeq = () => events.length + 1;

    /** One event, numbered next. */
    const tell = (made: (seq: number) => ProjectEvent) => {
      events.push(made(nextSeq()));
    };

    const askOf = (id: AskId) => {
      const found = asks.get(id);

      if (found === undefined) {
        throw new Error(`the story names no ask ${id}`);
      }

      return found;
    };

    const setAsk = (ask: Ask) => {
      asks.set(ask.id, ask);
    };

    const claimOf = (id: AskId) => {
      const held = claims.get(id)?.at(-1);

      if (held === undefined) {
        throw new Error(`nobody claimed ${id}`);
      }

      return held;
    };

    const moveClaim = (id: AskId, change: (held: Held) => Held) => {
      const all = claims.get(id) ?? [];
      const last = claimOf(id);

      claims.set(id, [...all.slice(0, -1), change(last)]);
    };

    /** A commit of `changes` on main, by the platform for `author`, at `at`. */
    const commit = (landing: LandingInput) =>
      Effect.gen(function* () {
        const into = yield* scratch;
        const next = overlay(files, landing.changes);

        const sha = yield* into.commit({
          at: landing.at,
          author: personIdentity(landing.author),
          committer: platformIdentity,
          message: formatLanding({
            ...present(
              "ask",
              landing.ask === undefined
                ? undefined
                : { ask: landing.ask, project }
            ),
            assisted: landing.assisted ?? [],
            body: landing.message.body,
            credits: landing.credits,
            ...present("heldBack", landing.heldBack),
            requestId: landing.requestId,
            subject: landing.message.subject,
            ...present("verdict", landing.verdict),
          }),
          parents: [head],
          tree: yield* into.tree(next),
        });

        const outcomes = yield* Effect.orDie(
          host.push(repo, into.source, [
            { from: Option.some(head), ref: main, to: sha },
          ])
        );

        if (!outcomes.every(RefOutcome.$is("Updated"))) {
          return yield* Effect.die(`${repo}'s main moved under the fixtures`);
        }

        const view: LandingView = {
          assisted: landing.assisted ?? [],
          author: landing.author,
          credits: landing.credits,
          landedAt: landing.at,
          parent: head,
          project,
          requestId: landing.requestId,
          sha: LandedSha.make(sha),
          ...present("ask", landing.ask),
          ...present("opened", landing.opened),
          ...present("heldBackTrailer", landing.heldBack),
          ...present("verdict", landing.verdict),
        };

        files = next;
        head = view.sha;
        landings.push(view);

        return view;
      });

    /** The child of a family that waits on the rest opens once they have all closed. */
    const familyMoves = (landed: Ask, at: DateTime.Utc) => {
      if (landed.parent === undefined) {
        return;
      }

      for (const child of asks.values()) {
        if (
          child.parent === landed.parent &&
          child.state === "waitingOnParent" &&
          child.blockedBy.every((id) => asks.get(id)?.state === "closed")
        ) {
          const opened: Ask = { ...child, state: "open" };

          setAsk(opened);
          tell((seq) =>
            ProjectEvent.cases.AskOpened.make({
              ask: listingOf(opened),
              at,
              seq,
            })
          );
        }
      }
    };

    const lanesOf = (
      ask: Ask,
      results: Readonly<Record<string, LaneOutcome>>,
      requestId: RequestId
    ): readonly LaneResult[] =>
      [askLane(ask, input.test), ...Object.entries(input.lanes)].flatMap(
        ([lane, command]) => {
          const result = results[lane];

          return result === undefined
            ? []
            : [
                {
                  command,
                  durationMs:
                    800 +
                    (Number.parseInt(hexOf(`${requestId}/${lane}`, 4), 16) %
                      9000),
                  lane: LaneName.make(lane),
                  result,
                  ...present(
                    "logRef",
                    result === "failed" ? `${requestId}/${lane}` : undefined
                  ),
                },
              ];
        }
      );

    return {
      /** An ask's id, read back; the story names only asks it opened. */
      ask: askOf,

      /**
       * The asks a decider opens in one landing: their files on main, an
       * `AskOpened` for each that opens now (a child waiting on the rest
       * opens later), and the landing, which names the first as opened.
       */
      open: (step: {
        readonly asks: Array.NonEmptyReadonlyArray<
          Omit<Ask, "openedAt" | "openedIn" | "project">
        >;
        readonly at: DateTime.Utc;
        readonly by: Handle;
        readonly files: Files;
      }) =>
        Effect.gen(function* () {
          const [first] = step.asks;
          const children = step.asks.slice(1).map(({ id }) => `- ${id}`);

          const landing = yield* commit({
            at: step.at,
            author: step.by,
            changes: step.files,
            credits: [{ handle: first.askedBy, role: "Asked-by" }],
            message: {
              body:
                children.length === 0
                  ? first.brief.want
                  : [
                      first.brief.want,
                      "",
                      "Its child asks, the last waiting on the rest:",
                      ...children,
                    ].join("\n"),
              subject: `Open ask ${first.id}`,
            },
            opened: first.id,
            requestId: RequestId.make(`open-${hexOf(`open:${first.id}`, 40)}`),
          });

          for (const stated of step.asks) {
            const ask: Ask = {
              ...stated,
              openedAt: step.at,
              openedIn: landing.sha,
              project,
            };

            setAsk(ask);

            if (ask.state === "open") {
              tell((seq) =>
                ProjectEvent.cases.AskOpened.make({
                  ask: listingOf(ask),
                  at: step.at,
                  seq,
                })
              );
            }
          }

          tell((seq) =>
            ProjectEvent.cases.Landed.make({ at: step.at, landing, seq })
          );

          return landing;
        }),

      /** `who` claims `id`; an answer to it is judged by `suite` when its claim pins one. */
      claim: (id: AskId, who: Handle, at: DateTime.Utc, suite?: SuiteRoot) => {
        claims.set(id, [
          ...(claims.get(id) ?? []),
          {
            at,
            base: head,
            claimant: who,
            state: "live",
            ...present("suite", suite),
          },
        ]);

        if (!firstClaims.has(who)) {
          firstClaims.set(who, at);
        }

        setAsk({ ...askOf(id), state: "claimed" });
        tell((seq) =>
          ProjectEvent.cases.Claimed.make({ ask: id, at, claimant: who, seq })
        );
      },

      /** The claimant pushes to the claim's fork: its head, named for `round`. */
      push: (id: AskId, at: DateTime.Utc, round = 1) => {
        const claimed = claimOf(id);
        const pushed = headOf(`${project}/${id}/${claimed.claimant}/${round}`);

        moveClaim(id, (held) => ({ ...held, lastPush: at, state: "live" }));
        tell((seq) =>
          ProjectEvent.cases.Pushed.make({ ask: id, at, head: pushed, seq })
        );

        return pushed;
      },

      /**
       * The answer at `pushed` checked: its verdict, kept as a round of the
       * ask, and a `Judged` event with where it stands.
       */
      judge: (
        id: AskId,
        pushed: CommitSha,
        step: {
          readonly at: DateTime.Utc;
          readonly heldBack?: readonly HeldBackResult[];
          readonly lanes: Readonly<Record<string, LaneOutcome>>;
          readonly outcome: Outcome;
          readonly stage: StageName;
          readonly logs?: Readonly<Record<string, string>>;
        }
      ) => {
        const ask = askOf(id);
        const claimed = claimOf(id);
        const requestId = RequestId.make(`push-${pushed}-${claimed.claimant}`);
        const lanes = lanesOf(ask, step.lanes, requestId);

        const verdict: Verdict = {
          ask: id,
          at: step.at,
          base: claimed.base,
          checkVersion: CheckVersion.make(
            `${askLane(ask, input.test)[0]}@0.0.0+${hexOf(`version:${id}`, 16)}`
          ),
          head: pushed,
          heldBack: step.heldBack ?? [],
          lanes,
          outcome: step.outcome,
          patchId: PatchId.make(hexOf(`patch:${pushed}`, 64)),
          project,
          stage: step.stage,
          tree: TreeSha.make(hexOf(`tree:${pushed}`, 40)),
          verifier: "platform",
        };

        for (const lane of lanes) {
          const text = step.logs?.[lane.lane];

          if (lane.logRef !== undefined && text !== undefined) {
            logs.set(lane.logRef, {
              claimant: claimed.claimant,
              lane: lane.lane,
              text,
            });
          }
        }

        verdicts.set(id, [...(verdicts.get(id) ?? []), verdict]);
        answers.push({
          ask: id,
          at: step.at,
          head: pushed,
          outcome: step.outcome,
          requestId,
        });
        tell((seq) =>
          ProjectEvent.cases.Judged.make({
            ask: id,
            at: step.at,
            head: pushed,
            outcome: step.outcome,
            seq,
          })
        );

        return verdict;
      },

      /**
       * The ask's last judged answer lands: a platform commit of `changes`
       * crediting the asker, the answerer and anyone who decided on it,
       * then `Landed` and `AskClosed`, and the family's next step opens
       * once every sibling has landed.
       */
      land: (
        id: AskId,
        step: {
          readonly assisted?: readonly AgentTrailer[];
          readonly at: DateTime.Utc;
          readonly changes: Files;
          readonly decidedBy?: Handle;
        }
      ) =>
        Effect.gen(function* () {
          const ask = askOf(id);
          const claimed = claimOf(id);
          const rounds = verdicts.get(id) ?? [];
          const last = rounds.at(-1);

          if (last === undefined) {
            return yield* Effect.die(`${id} has no judged answer to land`);
          }

          const trailer = Array.isReadonlyArrayNonEmpty(last.heldBack)
            ? last.heldBack
                .map(
                  ({ area, passed, suite, total }) =>
                    `${area} ${passed}/${total} @ ${suite}`
                )
                .join("; ")
            : undefined;

          const credits: Credit[] = [
            { handle: ask.askedBy, role: "Asked-by" },
            { handle: claimed.claimant, role: "Signed-off-by" },
            ...(step.decidedBy === undefined
              ? []
              : [{ handle: step.decidedBy, role: "Decided-by" as const }]),
            ...(ask.mentor === undefined
              ? []
              : [{ handle: ask.mentor, role: "Mentored-by" as const }]),
          ];

          // The landing's sha is the commit's: the verdict it carries
          // names it once the commit exists.
          const landing = yield* commit({
            ask: id,
            at: step.at,
            author: claimed.claimant,
            changes: step.changes,
            credits,
            message: { body: ask.brief.want, subject: `Answer ${id}` },
            requestId: RequestId.make(`push-${last.head}-${claimed.claimant}`),
            verdict: last,
            ...present("assisted", step.assisted),
            ...present("heldBack", trailer),
          });

          const outcome = Outcome.cases.Landed.make({ sha: landing.sha });
          const verdict: Verdict = { ...last, outcome };
          const view: LandingView = { ...landing, verdict };

          landings[landings.length - 1] = view;
          verdicts.set(id, [...rounds.slice(0, -1), verdict]);

          const answered = answers.findLastIndex(
            (answer) => answer.ask === id && answer.head === last.head
          );

          if (answered !== -1) {
            const was = answers[answered];

            if (was !== undefined) {
              answers[answered] = { ...was, outcome };
            }
          }

          moveClaim(id, (held) => ({ ...held, state: "answered" }));

          const closed: Ask = { ...ask, state: "closed" };

          setAsk(closed);
          tell((seq) =>
            ProjectEvent.cases.Landed.make({ at: step.at, landing: view, seq })
          );
          tell((seq) =>
            ProjectEvent.cases.AskClosed.make({
              ask: id,
              at: step.at,
              landing: landing.sha,
              seq,
            })
          );
          familyMoves(closed, step.at);

          return view;
        }),

      /**
       * The checks still running on the ask's last answer finish with
       * `lanes`, and it passes every stage: its verdict, kept, stands at the
       * last stage until it lands.
       */
      finishChecks: (
        id: AskId,
        lanes: Readonly<Record<string, LaneOutcome>>
      ) => {
        const rounds = verdicts.get(id) ?? [];
        const last = rounds.at(-1);

        if (last !== undefined) {
          const requestId = RequestId.make(
            `push-${last.head}-${claimOf(id).claimant}`
          );

          verdicts.set(id, [
            ...rounds.slice(0, -1),
            {
              ...last,
              lanes: lanesOf(askOf(id), lanes, requestId),
              outcome: Outcome.cases.Checking.make({ stage: "human" }),
              stage: "human",
            },
          ]);
        }
      },

      /** A landing that answers no ask: a release from a layer, a decider's own change. */
      landOwn: (step: {
        readonly at: DateTime.Utc;
        readonly author: Handle;
        readonly changes: Files;
        readonly credits: readonly Credit[];
        readonly message: { readonly body: string; readonly subject: string };
      }) =>
        Effect.gen(function* () {
          const view = yield* commit({
            ...step,
            requestId: RequestId.make(
              `land-${hexOf(`land:${step.message.subject}`, 40)}`
            ),
          });

          tell((seq) =>
            ProjectEvent.cases.Landed.make({ at: step.at, landing: view, seq })
          );

          return view;
        }),

      /** The claim is warned: no push for a while. */
      warn: (id: AskId, at: DateTime.Utc) => {
        moveClaim(id, (held) => ({ ...held, state: "warned" }));
        tell((seq) => ProjectEvent.cases.Warned.make({ ask: id, at, seq }));
      },

      /** The claim lapsed, and the ask is open again. */
      lapse: (id: AskId, at: DateTime.Utc) => {
        moveClaim(id, (held) => ({ ...held, state: "lapsed" }));
        setAsk({ ...askOf(id), state: "open" });
        tell((seq) => ProjectEvent.cases.Lapsed.make({ ask: id, at, seq }));
      },

      /** The claimant let the ask go, and it is open again. */
      release: (id: AskId, at: DateTime.Utc) => {
        moveClaim(id, (held) => ({ ...held, state: "released" }));
        setAsk({ ...askOf(id), state: "open" });
        tell((seq) => ProjectEvent.cases.Released.make({ ask: id, at, seq }));
      },

      /** A decision put to its deciders. */
      decision: (decision: Decision) => {
        decisions.push(decision);
      },

      /** A decider takes a decision put earlier. */
      decide: (id: Decision["id"], taken: NonNullable<Decision["decided"]>) => {
        const index = decisions.findIndex((each) => each.id === id);
        const found = decisions[index];

        if (found === undefined) {
          throw new Error(`no decision ${id}`);
        }

        decisions[index] = { ...found, decided: taken };
        tell((seq) =>
          ProjectEvent.cases.Decided.make({
            at: taken.at,
            choice: taken.choice,
            decision: id,
            seq,
          })
        );
      },

      /** A ledger entry, numbered next in the ledger, and its event. */
      record: (entry: (seq: number) => LedgerEntry) => {
        const made = entry(ledger.length + 1);

        ledger.push(made);
        tell((seq) =>
          ProjectEvent.cases.LedgerAppended.make({
            at: made.at,
            entry: made,
            seq,
          })
        );
      },

      /** A proposal opened, as anyone reads it now, and its events. */
      propose: (
        held: HeldProposal,
        settled?: { readonly at: DateTime.Utc; readonly ready: boolean }
      ) => {
        proposals.set(held.proposal.id, held);
        tell((seq) =>
          ProjectEvent.cases.ProposalOpened.make({
            at: held.proposal.openedAt,
            proposal: held.proposal.id,
            seq,
          })
        );

        if (settled !== undefined) {
          tell((seq) =>
            ProjectEvent.cases.ProposalDrafted.make({
              at: settled.at,
              proposal: held.proposal.id,
              ready: settled.ready,
              seq,
            })
          );
        }
      },

      /** A later round of a proposal's draft settled. */
      drafted: (id: ProposalId, at: DateTime.Utc, ready: boolean) => {
        tell((seq) =>
          ProjectEvent.cases.ProposalDrafted.make({
            at,
            proposal: id,
            ready,
            seq,
          })
        );
      },

      /** A decider accepted the proposal: it is closed, and its ask opens. */
      accepted: (id: ProposalId) => {
        const held = proposals.get(id);

        if (held !== undefined) {
          proposals.set(id, {
            ...held,
            proposal: { ...held.proposal, state: "accepted" },
          });
        }
      },

      /** A tag on `sha`, as a release names it. */
      tag: (name: string, sha: LandedSha) =>
        Effect.gen(function* () {
          const into = yield* scratch;

          yield* Effect.orDie(
            host.push(repo, into.source, [
              {
                from: Option.none(),
                ref: RefName.make(`refs/tags/${name}`),
                to: sha,
              },
            ])
          );
        }),

      /** Main's landed commit now. */
      head: () => head,

      /** The record the story wrote, with what it keeps apart from the story. */
      told: (
        apart: Pick<FixtureRecord, "env" | "ledger"> & {
          readonly working: readonly Handle[];
        }
      ): FixtureRecord => {
        const claimViews = [...claims].flatMap(([ask, held]) =>
          held.map((each): ClaimView => ({
            ask,
            base: each.base,
            checkCommand: `${Brand.cli} check`,
            claimant: each.claimant,
            fork: claimForkName(project, ask, each.claimant),
            lapsesAt: DateTime.add(each.lastPush ?? each.at, input.lapseAfter),
            openedAt: each.at,
            project,
            remote: `/${project}--${ask}--${each.claimant}.git`,
            state: each.state,
            warnsAt: DateTime.add(each.lastPush ?? each.at, input.warnAfter),
            ...present("lastPushAt", each.lastPush),
            ...present("suite", each.suite),
          }))
        );

        const forks: readonly ForkRef[] = [
          ...claimViews.map((claim): ForkRef => ({
            ask: claim.ask,
            handle: claim.claimant,
            kind: "claim",
            repo: claim.fork,
            state: claim.state,
          })),
          ...apart.working.map((handle): ForkRef => ({
            handle,
            kind: "working",
            repo: RepoName.make(`${keyOf(project)}--me--${handle}`),
          })),
        ];

        // A copy of each part: a later step writes the story's own arrays
        // and maps in place, and a record already served must not change
        // under a read while that step is under way.
        return {
          answers: [...answers],
          asks: new Map(asks),
          claims: claimViews,
          decisions: [...decisions],
          env: apart.env,
          events: [...events],
          firstClaims: [...firstClaims].map(([handle, at]) => ({ at, handle })),
          forks,
          head,
          landings: [...landings],
          ledger: { ...apart.ledger, entries: [...ledger] },
          logs: new Map(logs),
          proposals: new Map(proposals),
          verdicts: new Map(verdicts),
        };
      },
    };
  });

/** A story under way: its steps, and the record it has written so far. */
export type Story = Effect.Success<ReturnType<typeof storyOf>>;
