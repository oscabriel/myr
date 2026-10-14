import { describe, expect, it } from "@effect/vitest";
import { CheckSpec } from "@repo/protocol/domain/check";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import { ProjectEvent } from "@repo/protocol/domain/event";
import { LedgerEntry } from "@repo/protocol/domain/visibility";
import {
  AskId,
  CommitSha,
  Handle,
  LayerName,
  ProposalId,
  RepoPath,
} from "@repo/protocol/ids";
import { DateTime, Effect, Exit, Option, Schema, Struct } from "effect";
import type { Layer } from "effect";

import type { ProjectEventInput } from "../src/events.ts";
import { ProjectStore } from "../src/project-store.ts";
import type { ProjectWrites } from "../src/project-store.ts";
import {
  AnswerRow,
  AskRow,
  AttemptRow,
  ClaimRow,
  DecisionRow,
  EnvValueRow,
  LandingRow,
  LayerReadRow,
  LayerRow,
  LedgerRow,
  OutboxRow,
  ProjectRow,
  ProposalRow,
  PushEventRow,
  RatchetRow,
} from "../src/project-store/rows.ts";

// Rows are written here encoded, as the store keeps them, and decoded once;
// a snapshot is compared encoded, so every field reads back as written.

const at = (minute: number) =>
  `2026-10-07T12:${String(minute).padStart(2, "0")}:00.000Z`;

const sha = (n: number) => n.toString(16).padStart(40, "0");

const decoded = <A, I>(schema: Schema.Codec<A, I>, value: NoInfer<I>): A =>
  Schema.decodeSync(schema)(value);

const decodedAll = <A, I>(
  schema: Schema.Codec<A, I>,
  values: readonly NoInfer<I>[]
) => values.map((value) => decoded(schema, value));

const json = (text: string) =>
  Schema.decodeSync(Schema.fromJsonString(Schema.Json))(text);

const askOf = (id: string) =>
  ({
    askedBy: "alice",
    blockedBy: [],
    brief: { want: "An empty date string is refused, not parsed as today" },
    check: CheckSpec.cases.RedThenGreen.make({
      path: RepoPath.make("test/parse.test.ts"),
    }),
    file: `asks/${id}.ask.ts`,
    id,
    kind: "fix",
    openedAt: at(0),
    openedIn: sha(1),
    project: "alice/datekit",
    state: "open",
    territory: { module: "core", paths: ["packages/core/**"] },
  }) satisfies (typeof AskRow)["Encoded"];

const project = {
  createdAt: at(0),
  initializer: "alice",
  landed: sha(1),
  policy: { decisions: { expireDays: 14 } },
  policyAt: sha(1),
  project: "alice/datekit",
  state: "live",
} satisfies (typeof ProjectRow)["Encoded"];

const askA = askOf("empty-date");

const askB = askOf("leap-day");

// A lifecycle state's JSON with its keys out of order: the store keeps it
// byte for byte, since the service decodes it with the lifecycle's schema.
const claimState =
  '{"_tag":"Live","warnsAt":"2026-10-07T14:00:00.000Z","base":"0000000000000000000000000000000000000001"}';

const answerState = '{"_tag":"Queued","requestId":"req-00000001"}';

const claim = {
  ask: "empty-date",
  claimant: "bob",
  state: json(claimState),
  updatedAt: at(1),
} satisfies (typeof ClaimRow)["Encoded"];

const answerOf = (state: Schema.Json) =>
  ({
    answerer: "bob",
    ask: "empty-date",
    head: sha(2),
    requestId: "req-00000001",
    state,
    updatedAt: at(2),
  }) satisfies (typeof AnswerRow)["Encoded"];

const answer = answerOf(json(answerState));

const queue = { active: "req-00000001", order: ["req-00000001"] };

const outboxOf = (id: string) =>
  ({
    attempts: 0,
    body: { fork: "alice__datekit--empty-date--bob" },
    id,
    kind: "makeFork",
    notBefore: at(1),
  }) satisfies (typeof OutboxRow)["Encoded"];

const firstOutbox = outboxOf("out-1");

const secondOutbox = outboxOf("out-2");

const landingOf = (n: number) =>
  ({
    assisted: [],
    author: "bob",
    credits: [{ handle: "alice", role: "Asked-by" }],
    landedAt: at(n),
    parent: sha(n),
    project: "alice/datekit",
    sha: sha(n + 1),
  }) satisfies (typeof LandingRow)["Encoded"];

const proposal = {
  expiresAt: at(30),
  files: ["asks/time-zones.ask.ts"],
  id: "prop-000001",
  openedAt: at(3),
  project: "alice/datekit",
  proposer: "carol",
  state: "open",
  want: "Dates keep their time zone when formatted",
} satisfies (typeof ProposalRow)["Encoded"];

const decision = {
  deciders: ["alice"],
  default: "decline",
  evidence: [{ label: "proposer", value: "carol" }],
  expiresAt: at(30),
  id: "dec-000001",
  openedAt: at(3),
  project: "alice/datekit",
  subject: DecisionSubject.cases.OpenProposal.make({
    proposal: ProposalId.make("prop-000001"),
  }),
} satisfies (typeof DecisionRow)["Encoded"];

const ratchet = {
  at: sha(1),
  count: 12,
  ratchet: "anyCount",
  territory: "packages/core",
} satisfies (typeof RatchetRow)["Encoded"];

const pushEventOf = (eventId: string) =>
  ({
    after: sha(3),
    at: at(4),
    before: sha(2),
    eventId,
    ref: "refs/heads/main",
    repo: "alice__datekit--empty-date--bob",
  }) satisfies (typeof PushEventRow)["Encoded"];

const declared = {
  admittedAt: at(6),
  landedSha: sha(7),
  name: "maintainers",
  repo: "alice__datekit--maintainers",
  saltRef: "c2FsdA==",
  suiteRoot: `sha256:${"ab".repeat(32)}`,
} satisfies (typeof LayerRow)["Encoded"];

const proposedLayer = {
  name: "security",
  proposed: sha(8),
  repo: "alice__datekit--security",
} satisfies (typeof LayerRow)["Encoded"];

const attempt = {
  area: "export",
  ask: "empty-date",
  claimant: "bob",
  count: 1,
  week: "2026-W41",
} satisfies (typeof AttemptRow)["Encoded"];

const ledgerEntryOf = (seq: number) =>
  Schema.encodeSync(LedgerEntry)(
    LedgerEntry.cases.LayerDeclared.make({
      at: DateTime.makeUnsafe(at(seq)),
      disclose: "sealed",
      kinds: ["checks"],
      layer: LayerName.make("maintainers"),
      seq,
    })
  ) satisfies (typeof LedgerRow)["Encoded"];

const envValue = {
  key: "SENTRY_AUTH_TOKEN",
  sealed: { ciphertext: "Y2lwaGVy", iv: "aXY=", keyVersion: 1 },
  setAt: at(9),
  setBy: "alice",
} satisfies (typeof EnvValueRow)["Encoded"];

const readBy = (handle: string, minute: number) => ({
  at: DateTime.makeUnsafe(at(minute)),
  handle: Handle.make(handle),
  layer: LayerName.make("maintainers"),
  sha: CommitSha.make(sha(7)),
});

const readRow = (handle: string, minute: number, seq: number) =>
  ({
    at: at(minute),
    handle,
    layer: "maintainers",
    seq,
    sha: sha(7),
  }) satisfies (typeof LayerReadRow)["Encoded"];

// Events are written as the service hands them over: unnumbered.

const claimed: ProjectEventInput = ProjectEvent.cases.Claimed.mapFields(
  Struct.omit(["seq"])
).make({
  ask: AskId.make("empty-date"),
  at: DateTime.makeUnsafe(at(1)),
  claimant: Handle.make("bob"),
});

const pushed: ProjectEventInput = ProjectEvent.cases.Pushed.mapFields(
  Struct.omit(["seq"])
).make({
  ask: AskId.make("empty-date"),
  at: DateTime.makeUnsafe(at(2)),
  head: CommitSha.make(sha(2)),
});

const pushes = (count: number) => Array.from({ length: count }, () => pushed);

const everything: ProjectWrites = {
  answers: decodedAll(AnswerRow, [answer]),
  asks: decodedAll(AskRow, [askA, askB]),
  claims: decodedAll(ClaimRow, [claim]),
  events: [claimed, pushed],
  outbox: decodedAll(OutboxRow, [firstOutbox, secondOutbox]),
  project: decoded(ProjectRow, project),
  queue,
};

const EncodedSnapshot = Schema.Struct({
  answers: Schema.Array(AnswerRow),
  asks: Schema.Array(AskRow),
  attempts: Schema.Array(AttemptRow),
  claims: Schema.Array(ClaimRow),
  decisions: Schema.Array(DecisionRow),
  envValues: Schema.Array(EnvValueRow),
  landings: Schema.Array(LandingRow),
  lastSeq: Schema.Int,
  layers: Schema.Array(LayerRow),
  ledger: Schema.Array(LedgerRow),
  outbox: Schema.Array(OutboxRow),
  project: Schema.OptionFromNullOr(ProjectRow),
  proposals: Schema.Array(ProposalRow),
  queue: Schema.Json,
  ratchets: Schema.Array(RatchetRow),
});

const empty = {
  answers: [],
  asks: [],
  attempts: [],
  claims: [],
  decisions: [],
  envValues: [],
  landings: [],
  lastSeq: 0,
  layers: [],
  ledger: [],
  outbox: [],
  project: null,
  proposals: [],
  queue: null,
  ratchets: [],
};

const loaded = Effect.gen(function* () {
  const store = yield* ProjectStore;

  return yield* Schema.encodeEffect(EncodedSnapshot)(yield* store.load());
});

const since = (seq: number, limit: number) =>
  ProjectStore.use((store) => store.eventsSince(seq, limit));

const readsSince = (seq: number, limit: number) =>
  ProjectStore.use((store) => store.layerReadsSince(seq, limit)).pipe(
    Effect.flatMap(Schema.encodeEffect(Schema.Array(LayerReadRow)))
  );

export const describeProjectStore = (
  adapter: string,
  layer: Layer.Layer<ProjectStore>
) => {
  describe(`ProjectStore over ${adapter}`, () => {
    it.effect("loads an empty snapshot before anything is written", () =>
      Effect.gen(function* () {
        expect(yield* loaded).toStrictEqual(empty);
        expect(yield* since(0, 10)).toStrictEqual([]);
      }).pipe(Effect.provide(layer))
    );

    it.effect("loads every row a commit wrote, and numbers its events", () =>
      Effect.gen(function* () {
        const store = yield* ProjectStore;

        expect(yield* store.commit(everything)).toStrictEqual({
          duplicatePushEvents: [],
          seqs: [1, 2],
        });

        expect(yield* loaded).toStrictEqual({
          ...empty,
          answers: [answer],
          asks: [askA, askB],
          claims: [claim],
          lastSeq: 2,
          outbox: [firstOutbox, secondOutbox],
          project,
          queue,
        });

        expect(yield* since(0, 10)).toStrictEqual([
          { event: { ...claimed, seq: 1 }, seq: 1 },
          { event: { ...pushed, seq: 2 }, seq: 2 },
        ]);
      }).pipe(Effect.provide(layer))
    );

    it.effect("keeps a lifecycle state's JSON byte for byte", () =>
      Effect.gen(function* () {
        const store = yield* ProjectStore;

        yield* store.commit(everything);

        const snapshot = yield* store.load();

        expect(
          snapshot.claims.map((written) => JSON.stringify(written.state))
        ).toStrictEqual([claimState]);
        expect(
          snapshot.answers.map((written) => JSON.stringify(written.state))
        ).toStrictEqual([answerState]);
      }).pipe(Effect.provide(layer))
    );

    it.effect("loads landings, proposals, decisions and ratchets", () =>
      Effect.gen(function* () {
        const store = yield* ProjectStore;

        yield* store.commit({
          decisions: decodedAll(DecisionRow, [decision]),
          landings: decodedAll(LandingRow, [landingOf(1), landingOf(2)]),
          proposals: decodedAll(ProposalRow, [proposal]),
          ratchets: decodedAll(RatchetRow, [ratchet]),
        });

        expect(yield* loaded).toStrictEqual({
          ...empty,
          decisions: [decision],
          landings: [landingOf(2), landingOf(1)],
          proposals: [proposal],
          ratchets: [ratchet],
        });
      }).pipe(Effect.provide(layer))
    );

    it.effect("replaces a row written again under its key, in its place", () =>
      Effect.gen(function* () {
        const store = yield* ProjectStore;

        const later = answerOf(
          json('{"_tag":"Merging","requestId":"req-00000001"}')
        );

        const renamed = {
          ...askA,
          brief: { want: "An empty date is refused" },
        };

        const released = { ...claim, state: json('{"_tag":"Released"}') };
        const lowered = { ...ratchet, count: 11 };
        const retried = { ...firstOutbox, attempts: 1 };

        yield* store.commit({
          ...everything,
          ratchets: decodedAll(RatchetRow, [ratchet]),
        });

        yield* store.commit({
          answers: decodedAll(AnswerRow, [later]),
          asks: decodedAll(AskRow, [renamed]),
          claims: decodedAll(ClaimRow, [released]),
          outbox: decodedAll(OutboxRow, [retried]),
          project: decoded(ProjectRow, { ...project, landed: sha(9) }),
          queue: { order: [] },
          ratchets: decodedAll(RatchetRow, [lowered]),
        });

        expect(yield* loaded).toStrictEqual({
          ...empty,
          answers: [later],
          asks: [renamed, askB],
          claims: [released],
          lastSeq: 2,
          outbox: [retried, secondOutbox],
          project: { ...project, landed: sha(9) },
          queue: { order: [] },
          ratchets: [lowered],
        });
      }).pipe(Effect.provide(layer))
    );

    it.effect("writes nothing for a push event it has already seen", () =>
      Effect.gen(function* () {
        const store = yield* ProjectStore;
        const first = decodedAll(PushEventRow, [pushEventOf("evt-1")]);

        expect(yield* store.commit({ pushEvents: first })).toStrictEqual({
          duplicatePushEvents: [],
          seqs: [],
        });

        // The replay carries a push event not seen yet, and the seen one twice:
        // it still writes nothing, that new push event included.
        expect(
          yield* store.commit({
            ...everything,
            pushEvents: decodedAll(PushEventRow, [
              pushEventOf("evt-1"),
              pushEventOf("evt-2"),
              pushEventOf("evt-1"),
            ]),
          })
        ).toStrictEqual({ duplicatePushEvents: ["evt-1"], seqs: [] });

        expect(yield* loaded).toStrictEqual(empty);
        expect(yield* since(0, 10)).toStrictEqual([]);

        expect(
          yield* store.commit({
            events: [pushed],
            pushEvents: decodedAll(PushEventRow, [pushEventOf("evt-2")]),
          })
        ).toStrictEqual({ duplicatePushEvents: [], seqs: [1] });
      }).pipe(Effect.provide(layer))
    );

    it.effect("keeps a push event sent twice in one commit once", () =>
      Effect.gen(function* () {
        const store = yield* ProjectStore;

        const twice = decodedAll(PushEventRow, [
          pushEventOf("evt-1"),
          pushEventOf("evt-1"),
        ]);

        expect(yield* store.commit({ pushEvents: twice })).toStrictEqual({
          duplicatePushEvents: [],
          seqs: [],
        });
        expect(yield* store.commit({ pushEvents: twice })).toStrictEqual({
          duplicatePushEvents: ["evt-1"],
          seqs: [],
        });
      }).pipe(Effect.provide(layer))
    );

    it.effect("reads events after a sequence number, up to a limit", () =>
      Effect.gen(function* () {
        const store = yield* ProjectStore;

        yield* store.commit(everything);

        expect(yield* since(1, 10)).toStrictEqual([
          { event: { ...pushed, seq: 2 }, seq: 2 },
        ]);
        expect(yield* since(0, 1)).toStrictEqual([
          { event: { ...claimed, seq: 1 }, seq: 1 },
        ]);
        expect(yield* since(2, 10)).toStrictEqual([]);
      }).pipe(Effect.provide(layer))
    );

    it.effect("keeps only the newest 500 events", () =>
      Effect.gen(function* () {
        const store = yield* ProjectStore;

        yield* store.commit({ events: pushes(500) });

        const { seqs } = yield* store.commit({ events: pushes(5) });

        expect(seqs).toStrictEqual([501, 502, 503, 504, 505]);

        const kept = yield* store.eventsSince(0, 1000);

        expect(kept.length).toBe(500);
        expect(kept.map((event) => event.seq).slice(0, 2)).toStrictEqual([
          6, 7,
        ]);
        expect((yield* store.load()).lastSeq).toBe(505);
      }).pipe(Effect.provide(layer))
    );

    it.effect("drops acknowledged outbox entries from the next load", () =>
      Effect.gen(function* () {
        const store = yield* ProjectStore;

        yield* store.commit(everything);
        yield* store.ackOutbox(["out-1", "out-unknown"]);

        expect((yield* loaded).outbox).toStrictEqual([secondOutbox]);
      }).pipe(Effect.provide(layer))
    );

    it.effect(
      "names the outbox entries an ack took, so of two acks of one entry only the first takes it",
      () =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;

          yield* store.commit(everything);

          expect([
            yield* store.ackOutbox(["out-1", "out-unknown"]),
            yield* store.ackOutbox(["out-1"]),
            yield* store.ackOutbox([]),
          ]).toStrictEqual([["out-1"], [], []]);
        }).pipe(Effect.provide(layer))
    );

    it.effect(
      "loads landings newest first, the later write first on a tie",
      () =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const earlier = landingOf(1);
          const first = landingOf(5);
          const second = { ...landingOf(5), sha: sha(40) };

          yield* store.commit({
            landings: decodedAll(LandingRow, [first, earlier]),
          });
          yield* store.commit({ landings: decodedAll(LandingRow, [second]) });

          expect((yield* loaded).landings).toStrictEqual([
            second,
            first,
            earlier,
          ]);
        }).pipe(Effect.provide(layer))
    );

    it.effect("finds a landing older than the snapshot's newest 50", () =>
      Effect.gen(function* () {
        const store = yield* ProjectStore;
        const landings = Array.from({ length: 51 }, (_, n) => landingOf(n + 1));

        yield* store.commit({ landings: decodedAll(LandingRow, landings) });

        const snapshot = yield* loaded;

        expect(snapshot.landings.length).toBe(50);
        expect(snapshot.landings[0]).toStrictEqual(landingOf(51));
        expect(snapshot.landings.at(-1)).toStrictEqual(landingOf(2));

        const oldest = yield* store.landing(CommitSha.make(sha(2)));

        expect(
          yield* Schema.encodeEffect(Schema.OptionFromNullOr(LandingRow))(
            oldest
          )
        ).toStrictEqual(landingOf(1));
        expect(
          Option.isNone(yield* store.landing(CommitSha.make(sha(999))))
        ).toBe(true);
      }).pipe(Effect.provide(layer))
    );

    it.effect(
      "counts every landing, past the snapshot's newest 50, each sha once",
      () =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;
          const before = yield* store.landingCount();

          const landings = Array.from({ length: 51 }, (_, n) =>
            landingOf(n + 1)
          );

          yield* store.commit({ landings: decodedAll(LandingRow, landings) });
          yield* store.commit({
            landings: decodedAll(LandingRow, [landingOf(51)]),
          });

          expect([before, yield* store.landingCount()]).toStrictEqual([0, 51]);
        }).pipe(Effect.provide(layer))
    );

    it.effect(
      "loads layers, attempts, ledger entries and write-only values, each replaced under its key",
      () =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;

          yield* store.commit({
            attempts: decodedAll(AttemptRow, [attempt]),
            envValues: decodedAll(EnvValueRow, [envValue]),
            layers: decodedAll(LayerRow, [declared, proposedLayer]),
            ledger: decodedAll(LedgerRow, [ledgerEntryOf(1), ledgerEntryOf(2)]),
          });

          expect(yield* loaded).toStrictEqual({
            ...empty,
            attempts: [attempt],
            envValues: [envValue],
            layers: [declared, proposedLayer],
            ledger: [ledgerEntryOf(1), ledgerEntryOf(2)],
          });

          const counted = { ...attempt, count: 2 };
          const reset = { ...envValue, setAt: at(10), setBy: "carol" };
          const admitted = { ...proposedLayer, landedSha: sha(8) };

          yield* store.commit({
            attempts: decodedAll(AttemptRow, [counted]),
            envValues: decodedAll(EnvValueRow, [reset]),
            layers: decodedAll(LayerRow, [admitted]),
            ledger: decodedAll(LedgerRow, [ledgerEntryOf(3)]),
          });

          expect(yield* loaded).toStrictEqual({
            ...empty,
            attempts: [counted],
            envValues: [reset],
            layers: [declared, admitted],
            ledger: [ledgerEntryOf(1), ledgerEntryOf(2), ledgerEntryOf(3)],
          });
        }).pipe(Effect.provide(layer))
    );

    it.effect(
      "numbers the layer read log and reads it after a number, out of the snapshot",
      () =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;

          yield* store.commit({
            layerReads: [readBy("alice", 11), readBy("okonkwo", 12)],
          });
          yield* store.commit({ layerReads: [readBy("alice", 13)] });

          expect(yield* readsSince(0, 10)).toStrictEqual([
            readRow("alice", 11, 1),
            readRow("okonkwo", 12, 2),
            readRow("alice", 13, 3),
          ]);
          expect(yield* readsSince(1, 1)).toStrictEqual([
            readRow("okonkwo", 12, 2),
          ]);
          expect(yield* loaded).toStrictEqual(empty);
        }).pipe(Effect.provide(layer))
    );

    it.effect("keeps an import's source with its row", () =>
      Effect.gen(function* () {
        const store = yield* ProjectStore;

        const imported = {
          ...project,
          importedFrom: {
            branch: "master",
            url: "https://github.com/dtolnay/anyhow",
          },
        } satisfies (typeof ProjectRow)["Encoded"];

        yield* store.commit({ project: decoded(ProjectRow, imported) });

        expect((yield* loaded).project).toStrictEqual(imported);
      }).pipe(Effect.provide(layer))
    );

    it.effect("keeps a claim's pinned suite with its row", () =>
      Effect.gen(function* () {
        const store = yield* ProjectStore;

        const pinned = {
          ...claim,
          pinned: { at: sha(7), suite: `sha256:${"ab".repeat(32)}` },
        } satisfies (typeof ClaimRow)["Encoded"];

        yield* store.commit({ claims: decodedAll(ClaimRow, [pinned]) });

        expect((yield* loaded).claims).toStrictEqual([pinned]);
      }).pipe(Effect.provide(layer))
    );

    it.effect(
      "leaves the previous state whole when a commit fails part-way",
      () =>
        Effect.gen(function* () {
          const store = yield* ProjectStore;

          yield* store.commit(everything);

          const before = yield* loaded;

          // `attempts` must be an integer: the last row written breaks it, after
          // the rows and events before it were already written.
          const failed = yield* Effect.exit(
            store.commit({
              asks: decodedAll(AskRow, [askOf("time-zones")]),
              events: [pushed],
              outbox: [
                decoded(OutboxRow, outboxOf("out-3")),
                { ...decoded(OutboxRow, outboxOf("out-4")), attempts: 0.5 },
              ],
              project: decoded(ProjectRow, { ...project, landed: sha(9) }),
            })
          );

          expect(Exit.isFailure(failed)).toBe(true);
          expect(yield* loaded).toStrictEqual(before);
          expect(yield* since(2, 10)).toStrictEqual([]);
        }).pipe(Effect.provide(layer))
    );
  });
};
