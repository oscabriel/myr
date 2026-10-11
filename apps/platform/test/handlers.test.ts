import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import type { FrontPageSeed } from "@repo/project/front-page/memory";
import { Projects } from "@repo/project/projects";
import { Contracts } from "@repo/protocol/contracts";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Decision } from "@repo/protocol/domain/decision";
import type { FrontPageEntry } from "@repo/protocol/domain/front-page";
import type { Proposal } from "@repo/protocol/domain/proposal";
import {
  AskId,
  CommitSha,
  EnvKey,
  Handle,
  KindName,
  ProjectName,
  RepoPath,
  RequestId,
} from "@repo/protocol/ids";
import {
  Anonymous,
  Authenticated,
  CurrentPrincipal,
  Person,
} from "@repo/protocol/principal";
import {
  AskFull,
  CapReached,
  NotClaimed,
  NotDecider,
  UnknownEnvItem,
  ProjectExists,
  UnknownCommit,
  UnknownProject,
} from "@repo/protocol/refusal";
import { advanceTo } from "@repo/testkit/clock";
import { aProject, withAsk, withVouches } from "@repo/testkit/scenarios";
import {
  Array,
  DateTime,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Redacted,
  Result,
  Stream,
} from "effect";
import { HttpServerRequest } from "effect/http";
import { RpcTest } from "effect/rpc";

import { WorkerCaps, WorkerRateLimits } from "../src/adapters/rate-limits.ts";
import { Handlers } from "../src/handlers.ts";
import { RateLimits } from "../src/rate-limits.ts";
import { as, seeded, worldOf } from "./handlers.fixtures.ts";
import type { WorldOptions } from "./handlers.fixtures.ts";

const people = ["bob", "carol"];

/** datekit: alice decides; bob and carol are vouched for. */
const datekit = aProject({ people }).pipe(
  withVouches(people),
  withAsk({ id: "parse-iso", territory: "packages/parser" }),
  withAsk({ id: "trim-input", territory: "packages/trim" })
);

/** burrow: alice decides here too; one ask of its own. */
const burrow = aProject({ name: "alice/burrow", people }).pipe(
  withVouches(people),
  withAsk({ id: "lex-tokens", territory: "packages/lexer" })
);

const parseIso = AskId.make("parse-iso");

const trimInput = AskId.make("trim-input");

const lexTokens = AskId.make("lex-tokens");

const nowhere = ProjectName.make("alice/nowhere");

/**
 * Both projects as the projection lists them, and one it lists that the
 * platform never made, which a call across projects passes over.
 */
const listed: FrontPageSeed["projects"] = [
  { openAsks: 2, posture: "open", project: datekit.project },
  { openAsks: 1, posture: "open", project: burrow.project },
  { openAsks: 0, posture: "open", project: nowhere },
];

/** The handlers over both projects' world. */
const platform = (options: WorldOptions = {}) =>
  Handlers.pipe(Layer.provideMerge(worldOf([datekit, burrow], options)));

/** Both projects made, at the scenarios' noon. */
const made = Effect.gen(function* () {
  yield* advanceTo("2026-10-07T12:00:00Z");
  yield* seeded(datekit);
  yield* seeded(burrow);
});

/** A call made while serving an HTTP request that reached the platform at `url`. */
const reachedAt =
  (url: string) =>
  <A, E, R>(call: Effect.Effect<A, E, R>) =>
    Effect.provideService(
      call,
      HttpServerRequest.HttpServerRequest,
      HttpServerRequest.fromWeb(new Request(url, { method: "POST" }))
    );

/** The open decision on `proposal` among a Today's; none fails the test. */
const decisionOn = (
  decisions: readonly Decision[],
  proposal: Pick<Proposal, "id">
) =>
  Effect.fromOption(
    Array.findFirst(
      decisions,
      ({ subject }) =>
        DecisionSubject.guards.OpenProposal(subject) &&
        subject.proposal === proposal.id
    )
  );

describe("project reads", () => {
  it.effect("list and show a project's asks, and know no other project", () =>
    Effect.gen(function* () {
      yield* made;

      const bob = yield* as("bob");

      const asks = yield* Effect.result(
        bob.listAsks({ project: datekit.project })
      );

      const shown = yield* Effect.result(
        bob.showAsk({ ask: parseIso, project: datekit.project })
      );

      const elsewhere = yield* Effect.result(
        bob.listAsks({ project: burrow.project })
      );

      expect(
        Result.map(asks, (found) => found.asks.map(({ ask }) => ask))
      ).toStrictEqual(Result.succeed(["parse-iso", "trim-input"]));
      expect(
        Result.map(shown, ({ ask, brief }) => ({
          ask: ask.id,
          names: brief.includes("parse-iso"),
        }))
      ).toStrictEqual(Result.succeed({ ask: "parse-iso", names: true }));
      expect(
        Result.map(elsewhere, (found) => found.asks.map(({ ask }) => ask))
      ).toStrictEqual(Result.succeed(["lex-tokens"]));
      expect(
        yield* Effect.flip(bob.listAsks({ project: nowhere }))
      ).toStrictEqual(new UnknownProject({ project: nowhere }));
      expect(
        yield* Effect.flip(bob.showAsk({ ask: parseIso, project: nowhere }))
      ).toStrictEqual(new UnknownProject({ project: nowhere }));
    }).pipe(Effect.provide(platform()))
  );

  it.effect(
    "stream a project's events from a sequence number, and none of a project never made",
    () =>
      Effect.gen(function* () {
        yield* made;

        const bob = yield* as("bob");

        const all = yield* Stream.runCollect(
          bob.watch({ project: datekit.project })
        );

        const later = yield* Stream.runCollect(
          bob.watch({ project: datekit.project, since: 1 })
        );

        // The adoption lands first; then each ask's opening lands, so each
        // is heard opened, then landed.
        expect(all.map(({ _tag }) => _tag)).toStrictEqual([
          "Landed",
          "AskOpened",
          "Landed",
          "AskOpened",
          "Landed",
        ]);
        expect(later).toStrictEqual(all.slice(1));
        expect(
          yield* Effect.flip(Stream.runCollect(bob.watch({ project: nowhere })))
        ).toStrictEqual(new UnknownProject({ project: nowhere }));
      }).pipe(Effect.provide(platform()))
  );

  it.effect("replay every event of a project that has more than a page", () =>
    Effect.gen(function* () {
      yield* made;

      const api = yield* (yield* Projects).get(datekit.project);
      const bobs = Person.make({ handle: Handle.make("bob") });

      // 60 claims, each released: 120 events after datekit's adoption
      // landed and its two asks opened, each heard opened and landed.
      yield* Effect.forEach(
        Array.range(1, 60),
        () =>
          Effect.andThen(
            api.claim(bobs, parseIso),
            api.release(bobs, parseIso)
          ),
        { discard: true }
      );

      const bob = yield* as("bob");

      const all = yield* Stream.runCollect(
        bob.watch({ project: datekit.project })
      );

      const tail = yield* Stream.runCollect(
        bob.watch({ project: datekit.project, since: 123 })
      );

      expect({
        count: all.length,
        first: all[0]?._tag,
        last: all.at(-1)?._tag,
      }).toStrictEqual({ count: 125, first: "Landed", last: "Released" });
      expect(tail.map(({ _tag }) => _tag)).toStrictEqual([
        "Claimed",
        "Released",
      ]);
    }).pipe(Effect.provide(platform()))
  );
});

describe("claims", () => {
  it.effect(
    "give the claimant a fork at the platform's git URL, and refuse a second claimant",
    () =>
      Effect.gen(function* () {
        yield* made;

        const alice = yield* as("alice");
        const bob = yield* as("bob");

        const { claim } = yield* alice
          .claim({ ask: parseIso, project: datekit.project })
          .pipe(reachedAt("https://platform-dev.example.workers.dev/rpc"));

        expect({
          claimant: claim.claimant,
          fork: claim.fork,
          remote: claim.remote,
        }).toStrictEqual({
          claimant: "alice",
          fork: "alice__datekit--parse-iso--alice",
          remote:
            "https://platform-dev.example.workers.dev/alice/datekit--parse-iso--alice.git",
        });
        expect(
          yield* Effect.flip(
            bob.claim({ ask: parseIso, project: datekit.project })
          )
        ).toStrictEqual(new AskFull({ ask: parseIso }));
      }).pipe(Effect.provide(platform()))
  );

  it.effect(
    "name the platform's own URL for a claim made with no request to read it from",
    () =>
      Effect.gen(function* () {
        yield* made;

        const alice = yield* as("alice");

        const { claim } = yield* alice.claim({
          ask: parseIso,
          project: datekit.project,
        });

        expect(claim.remote).toBe(
          `https://${Brand.domain}/alice/datekit--parse-iso--alice.git`
        );
      }).pipe(Effect.provide(platform()))
  );

  it.effect(
    "past one person's rate limit are refused before any project hears them; another person's are not",
    () =>
      Effect.gen(function* () {
        yield* made;

        const alice = yield* as("alice");
        const bob = yield* as("bob");

        yield* alice.claim({ ask: parseIso, project: datekit.project });

        const past = yield* Effect.flip(
          alice.claim({ ask: trimInput, project: datekit.project })
        );

        // alice's refused claim never reached datekit, so trim-input is free.
        const bobs = yield* bob.claim({
          ask: trimInput,
          project: datekit.project,
        });

        expect(past).toStrictEqual(
          new CapReached({ cap: 1, limit: "claims", retryAfter: 60 })
        );
        expect(bobs.claim.claimant).toBe("bob");
      }).pipe(Effect.provide(platform({ limits: { claim: 1, proposal: 5 } })))
  );
});

describe("proposals and flags", () => {
  it.effect("share one rate limit per person", () =>
    Effect.gen(function* () {
      yield* made;

      const bob = yield* as("bob");
      const carol = yield* as("carol");

      const proposed = yield* bob.proposeAsk({
        project: datekit.project,
        want: "Parse ISO week dates.",
      });

      const flagged = yield* Effect.flip(
        bob.flagAsk({
          ask: parseIso,
          project: datekit.project,
          reason: "The want names a file.",
        })
      );

      const carols = yield* carol.flagAsk({
        ask: parseIso,
        project: datekit.project,
        reason: "The want names a file.",
      });

      expect(proposed.proposal.proposer).toBe("bob");
      expect(flagged).toStrictEqual(
        new CapReached({ cap: 1, limit: "proposals", retryAfter: 60 })
      );
      expect({
        flags: carols.proposal.flags,
        proposer: carols.proposal.proposer,
      }).toStrictEqual({ flags: "parse-iso", proposer: "carol" });
    }).pipe(Effect.provide(platform({ limits: { claim: 5, proposal: 1 } })))
  );
});

describe("calls that name no project", () => {
  it.effect(
    "show the caller's claims in every project the projection lists",
    () =>
      Effect.gen(function* () {
        yield* made;

        const alice = yield* as("alice");
        const bob = yield* as("bob");

        yield* alice.claim({ ask: parseIso, project: datekit.project });
        yield* alice.claim({ ask: lexTokens, project: burrow.project });
        yield* bob.claim({ ask: trimInput, project: datekit.project });

        const status = yield* alice
          .status({})
          .pipe(reachedAt("https://platform-dev.example.workers.dev/rpc"));

        expect(
          status.claims.map(({ fork, remote }) => ({ fork, remote }))
        ).toStrictEqual([
          {
            fork: "alice__burrow--lex-tokens--alice",
            remote:
              "https://platform-dev.example.workers.dev/alice/burrow--lex-tokens--alice.git",
          },
          {
            fork: "alice__datekit--parse-iso--alice",
            remote:
              "https://platform-dev.example.workers.dev/alice/datekit--parse-iso--alice.git",
          },
        ]);
        expect(status.answers).toStrictEqual([]);
      }).pipe(
        Effect.provide(
          platform({
            frontPage: { credits: [], entries: [], projects: listed },
          })
        )
      )
  );

  it.effect(
    "give a decider one Today across their projects, and anyone else none",
    () =>
      Effect.gen(function* () {
        yield* made;

        const alice = yield* as("alice");
        const bob = yield* as("bob");
        const carol = yield* as("carol");

        // bob is new in both projects; datekit's second proposal opens
        // before burrow's, so it expires first.
        yield* bob.claim({ ask: parseIso, project: datekit.project });
        yield* bob.claim({ ask: lexTokens, project: burrow.project });

        const declined = yield* bob.proposeAsk({
          project: datekit.project,
          want: "Parse ISO week dates.",
        });

        yield* advanceTo("2026-10-07T12:05:00Z");
        yield* carol.proposeAsk({
          project: datekit.project,
          want: "Trim tabs too.",
        });
        yield* advanceTo("2026-10-07T12:10:00Z");
        yield* bob.proposeAsk({
          project: burrow.project,
          want: "Lex comments.",
        });

        const { decisions: inDatekit } = yield* alice.today({
          project: datekit.project,
        });

        const first = yield* decisionOn(inDatekit, declined.proposal);

        yield* alice.decide({
          choice: "decline",
          decision: first.id,
          project: datekit.project,
        });

        const today = yield* alice.today({});

        expect({
          budget: today.budget,
          decider: today.decider,
          decisions: today.decisions.map(({ openedAt, project }) => ({
            openedAt: DateTime.formatIso(openedAt),
            project,
          })),
          expiringSoon: today.expiringSoon,
          newcomers: today.newcomers,
          overflow: today.overflow,
          unattended: today.unattended,
        }).toStrictEqual({
          // Five decisions a day in each project; one spent in datekit.
          budget: { finishes: 0, total: 10, used: 1 },
          decider: "alice",
          decisions: [
            { openedAt: "2026-10-07T12:05:00.000Z", project: "alice/datekit" },
            { openedAt: "2026-10-07T12:10:00.000Z", project: "alice/burrow" },
          ],
          expiringSoon: [],
          newcomers: ["bob"],
          overflow: 0,
          unattended: [],
        });
        expect(yield* Effect.flip(bob.today({}))).toStrictEqual(
          new NotDecider({})
        );
        expect(
          yield* Effect.flip(bob.today({ project: datekit.project }))
        ).toStrictEqual(new NotDecider({}));
      }).pipe(
        Effect.provide(
          platform({
            frontPage: { credits: [], entries: [], projects: listed },
          })
        )
      )
  );

  it.effect("decide nothing when the projection lists no project", () =>
    Effect.gen(function* () {
      yield* made;

      const alice = yield* as("alice");

      expect(yield* alice.status({})).toStrictEqual({
        answers: [],
        claims: [],
        handle: Handle.make("alice"),
      });
      expect(yield* Effect.flip(alice.today({}))).toStrictEqual(
        new NotDecider({})
      );
    }).pipe(Effect.provide(platform()))
  );
});

const entry = (
  project: ProjectName,
  ask: string,
  kind: string
): FrontPageEntry => ({
  ask: {
    ask: AskId.make(ask),
    blockedBy: [],
    claimed: false,
    kind: KindName.make(kind),
    territory: "parser",
    want: `${ask}: its check passes`,
  },
  posture: "open",
  project,
  takeable: true,
});

const projection: FrontPageSeed = {
  credits: [
    {
      credit: {
        area: "parser",
        count: 2,
        project: datekit.project,
        role: "Signed-off-by",
      },
      handle: Handle.make("bob"),
    },
    {
      credit: {
        area: "lexer",
        count: 1,
        project: burrow.project,
        role: "Asked-by",
      },
      handle: Handle.make("alice"),
    },
  ],
  entries: [
    entry(datekit.project, "parse-iso", "fix"),
    entry(burrow.project, "drop-legacy", "migrate"),
  ],
  projects: listed,
};

describe("reads across projects", () => {
  it.effect(
    "come from the front-page projection, and a project the platform never made keeps its listed posture",
    () =>
      Effect.gen(function* () {
        // No project is made: only the projection answers, so each listed
        // posture is the projection's own fallback.
        const bob = yield* as("bob");

        expect(yield* bob.listProjects({})).toStrictEqual({
          projects: listed,
        });
        expect(yield* bob.frontPage({})).toStrictEqual({
          entries: projection.entries,
        });
        expect(
          yield* bob.frontPage({ kind: KindName.make("migrate") })
        ).toStrictEqual({ entries: [projection.entries[1]] });
        expect(
          yield* bob.credits({ handle: Handle.make("Bob") })
        ).toStrictEqual({
          credits: [
            {
              area: "parser",
              count: 2,
              project: datekit.project,
              role: "Signed-off-by",
            },
          ],
        });
      }).pipe(Effect.provide(platform({ frontPage: projection })))
  );
});

/** A server side that takes every call as nobody signed in. */
const anonymous = Layer.succeed(Authenticated, (effect) =>
  Effect.provideService(effect, CurrentPrincipal, Anonymous.make({}))
);

describe("each call", () => {
  it.effect(
    "reaches its project as the person who made it, so the project answers that person",
    () =>
      Effect.gen(function* () {
        yield* made;

        const alice = yield* as("alice");
        const bob = yield* as("bob");
        const { project } = datekit;

        yield* bob.claim({ ask: parseIso, project });

        const bobsStatus = yield* bob.status({ project });
        const alicesStatus = yield* alice.status({ project });

        const aliceReleases = yield* Effect.flip(
          alice.release({ ask: parseIso, project })
        );

        const bobReleases = yield* bob.release({ ask: parseIso, project });

        const bobOpens = yield* Effect.flip(
          bob.openAsk({
            ask: AskId.make("tidy-all"),
            files: [
              {
                content: 'export default "tidy-all";\n',
                path: RepoPath.make(`${Brand.configDir}/asks/tidy-all.ask.ts`),
              },
            ],
            project,
          })
        );

        // The project declares no env item, so none takes a value: a
        // decider hears the key is unknown, anyone else that deciders set.
        const setPaymentsKey = {
          key: EnvKey.make("PAYMENTS_KEY"),
          project,
          value: Redacted.make("not-a-real-value-0123456789abcdef"),
        };

        const bobSets = yield* Effect.flip(bob.setEnv(setPaymentsKey));
        const aliceSets = yield* Effect.flip(alice.setEnv(setPaymentsKey));

        const alicesFork = yield* alice
          .fork({ project })
          .pipe(reachedAt("https://platform-dev.example.workers.dev/rpc"));

        const { proposal } = yield* bob.proposeAsk({
          project,
          want: "Parse ISO week dates.",
        });

        const today = yield* alice.today({ project });

        const decision = yield* decisionOn(today.decisions, proposal);

        const bobDecides = yield* Effect.flip(
          bob.decide({ choice: "decline", decision: decision.id, project })
        );

        const aliceDecides = yield* alice.decide({
          choice: "decline",
          decision: decision.id,
          project,
        });

        expect({
          aliceDecides: aliceDecides.decision.decided?.by,
          aliceReleases,
          aliceSets,
          alicesClaims: alicesStatus.claims,
          alicesFork,
          bobDecides,
          bobOpens,
          bobReleases,
          bobSets,
          bobsClaims: bobsStatus.claims.map(({ claimant }) => claimant),
        }).toStrictEqual({
          aliceDecides: "alice",
          aliceReleases: NotClaimed.of(parseIso),
          aliceSets: new UnknownEnvItem({ key: setPaymentsKey.key }),
          alicesClaims: [],
          alicesFork: {
            fork: "alice__datekit--me--alice",
            remote:
              "https://platform-dev.example.workers.dev/alice/datekit--me--alice.git",
          },
          bobDecides: new NotDecider({}),
          bobOpens: new NotDecider({}),
          bobReleases: { released: true },
          bobSets: new NotDecider({}),
          bobsClaims: ["bob"],
        });
      }).pipe(Effect.provide(platform()))
  );

  it.effect(
    "reaches the project it names, not another, for every other read and write",
    () =>
      Effect.gen(function* () {
        yield* made;

        const bob = yield* as("bob");
        const { project } = burrow;
        const unseen = CommitSha.make("0".repeat(40));
        const requestId = RequestId.make("request-0001");
        const answer = { base: unseen, head: unseen, project, requestId };

        const ledger = yield* bob.ledger({ project });
        const envItems = yield* bob.envShape({ project });
        const verdict = yield* bob.verdict({ ask: lexTokens, project });

        const landing = yield* Effect.flip(
          bob.landing({ project, sha: unseen })
        );

        const submits = yield* Effect.flip(
          bob.submitAnswer({ ...answer, ask: lexTokens })
        );

        const finishes = yield* Effect.flip(
          bob.finish({ ...answer, ask: lexTokens })
        );

        const lands = yield* Effect.flip(
          bob.land({ ...answer, message: "Tidy the lexer." })
        );

        const vouches = yield* Effect.flip(
          bob.vouch({ handle: Handle.make("dave"), project, verdict: "vouch" })
        );

        expect({
          envItems: envItems.project,
          finishes,
          landing,
          lands,
          ledger: ledger.project,
          submits,
          verdict,
          vouches,
        }).toStrictEqual({
          envItems: "alice/burrow",
          finishes: new NotDecider({}),
          landing: new UnknownCommit({ sha: unseen }),
          lands: new NotDecider({}),
          ledger: "alice/burrow",
          submits: NotClaimed.of(lexTokens),
          verdict: {},
          vouches: new NotDecider({}),
        });
      }).pipe(Effect.provide(platform()))
  );

  it.effect(
    "by nobody signed in reads public contracts, and can't reach one for people",
    () =>
      Effect.gen(function* () {
        yield* made;

        const anyone = yield* RpcTest.makeClient(Contracts).pipe(
          Effect.provide(anonymous)
        );

        const asks = yield* anyone.listAsks({ project: datekit.project });

        const claimed = yield* Effect.exit(
          anyone.claim({ ask: parseIso, project: datekit.project })
        );

        expect(asks.asks.map(({ ask }) => ask)).toStrictEqual([
          "parse-iso",
          "trim-input",
        ]);
        expect(Exit.hasDies(claimed)).toBeTruthy();
      }).pipe(Effect.provide(platform()))
  );
});

describe("making a project", () => {
  it.effect(
    "starts it empty with its maker as its decider, at the platform's git URL, once",
    () =>
      Effect.gen(function* () {
        yield* advanceTo("2026-10-07T12:00:00Z");

        const carol = yield* as("carol");
        const fresh = ProjectName.make("carol/fresh");

        const first = yield* carol
          .initProject({ project: fresh })
          .pipe(reachedAt("https://platform-dev.example.workers.dev/rpc"));

        const again = yield* Effect.flip(carol.initProject({ project: fresh }));

        expect(first).toStrictEqual({
          project: "carol/fresh",
          remote: "https://platform-dev.example.workers.dev/carol/fresh.git",
        });
        expect(again).toStrictEqual(new ProjectExists({ project: fresh }));
      }).pipe(Effect.provide(platform()))
  );

  it.effect(
    "converges: a name an import failed to fill is the next call's to start",
    () =>
      Effect.gen(function* () {
        yield* advanceTo("2026-10-07T12:00:00Z");

        const carol = yield* as("carol");
        const fresh = ProjectName.make("carol/fresh");

        const failed = yield* Effect.flip(
          carol.initProject({
            import: { url: "https://example.com/missing.git" },
            project: fresh,
          })
        );

        const second = yield* carol.initProject({ project: fresh });

        expect(failed._tag).toBe("ImportFailed");
        expect(second.project).toBe("carol/fresh");
      }).pipe(Effect.provide(platform()))
  );
});

/**
 * A rate-limit binding that admits `allowed` calls per key, and keeps every
 * key it was asked about, in order.
 */
const fakeLimit = (allowed: number) => {
  const keys: string[] = [];

  const binding: RateLimit = {
    limit: ({ key }) => {
      keys.push(key);

      return Promise.resolve({
        success: keys.filter((each) => each === key).length <= allowed,
      });
    },
  };

  return { binding, keys };
};

describe("the Worker's rate limits", () => {
  it.effect(
    "count claims, proposals and drafts apart, per person whatever the case of their handle",
    () =>
      Effect.gen(function* () {
        const claims = fakeLimit(2);
        const proposals = fakeLimit(1);
        const drafts = fakeLimit(1);

        const spent = yield* RateLimits.use(({ check }) =>
          Effect.all([
            Effect.result(check("claim", Handle.make("Alice"))),
            Effect.result(check("claim", Handle.make("alice"))),
            Effect.result(check("claim", Handle.make("alice"))),
            Effect.result(check("claim", Handle.make("bob"))),
            Effect.result(check("proposal", Handle.make("alice"))),
            Effect.result(check("proposal", Handle.make("alice"))),
            Effect.result(check("draft", Handle.make("alice"))),
            Effect.result(check("draft", Handle.make("Alice"))),
          ])
        ).pipe(
          Effect.provide(
            WorkerRateLimits({
              claim: claims.binding,
              draft: drafts.binding,
              proposal: proposals.binding,
            })
          )
        );

        expect(spent).toStrictEqual([
          Result.void,
          Result.void,
          Result.fail(
            new CapReached({
              cap: WorkerCaps.claim,
              limit: "claims",
              retryAfter: 60,
            })
          ),
          Result.void,
          Result.void,
          Result.fail(
            new CapReached({
              cap: WorkerCaps.proposal,
              limit: "proposals",
              retryAfter: 60,
            })
          ),
          Result.void,
          Result.fail(
            new CapReached({
              cap: WorkerCaps.draft,
              limit: "drafts",
              retryAfter: 60,
            })
          ),
        ]);
        expect(claims.keys).toStrictEqual(["alice", "alice", "alice", "bob"]);
        expect(proposals.keys).toStrictEqual(["alice", "alice"]);
        expect(drafts.keys).toStrictEqual(["alice", "alice"]);
      })
  );

  it.effect("die when the binding fails, rather than let a call through", () =>
    Effect.gen(function* () {
      const broken: RateLimit = {
        limit: () => Promise.reject(new Error("rate limiter unavailable")),
      };

      const spent = yield* Effect.exit(
        RateLimits.use(({ check }) =>
          check("claim", Handle.make("alice"))
        ).pipe(
          Effect.provide(
            WorkerRateLimits({ claim: broken, draft: broken, proposal: broken })
          )
        )
      );

      expect(Exit.hasDies(spent)).toBeTruthy();
    })
  );

  it.effect(
    "report the caps wrangler.jsonc gives each binding, in every stage",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;

        const config = yield* fs.readFileString(
          new URL("../wrangler.jsonc", import.meta.url).pathname
        );

        const limitsOf = (name: string) =>
          [
            ...config.matchAll(
              new RegExp(
                `"name": "${name}",\\s*"namespace_id": "\\d+",\\s*"simple": \\{ "limit": (?<limit>\\d+)`,
                "gu"
              )
            ),
          ].map(({ groups }) => Number(groups?.limit));

        expect(limitsOf("CLAIM_LIMIT")).toStrictEqual([
          WorkerCaps.claim,
          WorkerCaps.claim,
          WorkerCaps.claim,
        ]);
        expect(limitsOf("PROPOSAL_LIMIT")).toStrictEqual([
          WorkerCaps.proposal,
          WorkerCaps.proposal,
          WorkerCaps.proposal,
        ]);
      }).pipe(Effect.provide(NodeServices.layer))
  );
});
