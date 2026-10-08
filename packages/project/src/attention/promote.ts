/**
 * The Garden's "Promote" beat: when deciders have finished two or
 * more answers in one area for the same reason, the same lint rule, that
 * class of mistake is put to them as one decision. Accepted, its proposal
 * opens a `lintToZero` ask for the rule in that territory, red first like
 * any ask (the run on main at `openAsk` is the proof the rule still finds
 * something; no rule is replayed against old trees). Its default is
 * `decline`, so ignoring it changes nothing, and nothing opens without a
 * person's yes.
 *
 * Pure over records: the service gives the finishes it knows, the project's
 * decisions so far, and ids minted from its sequence; it writes what comes
 * back as it writes a proposal and its decision.
 */
import { Brand } from "@repo/brand";
import { CheckSpec, RatchetMeasure } from "@repo/protocol/domain/check";
import type { Evidence } from "@repo/protocol/domain/common";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Decision } from "@repo/protocol/domain/decision";
import type { AskKind } from "@repo/protocol/domain/kind";
import type { Policy } from "@repo/protocol/domain/policy";
import type { Proposal } from "@repo/protocol/domain/proposal";
import { AskId, RepoPath, sameHandle } from "@repo/protocol/ids";
import type {
  DecisionId,
  Handle,
  ProjectName,
  ProposalId,
} from "@repo/protocol/ids";
import { Array as Arr, DateTime, Option, Order, Schema } from "effect";

import { decidersFor, openDecision } from "./decisions.ts";
import { platformHandle } from "./effects.ts";

/**
 * One finish: a decider's commits on top of an answer before it landed
 * (`Finished-by`). Its `area` is the module of the ask's territory; `rule`
 * is the lint rule its verdict's lanes name, and `note` what the decider
 * wrote; `paths` are the files the finish changed.
 */
export interface FinishRecord {
  /** The ask the finished answer answered: a finish's id, one per landing. */
  readonly ask: AskId;
  readonly area: string;
  readonly decider: Handle;
  readonly at: DateTime.Utc;
  readonly rule: Option.Option<string>;
  readonly note: Option.Option<string>;
  readonly paths: readonly RepoPath[];
}

/** A promotion: the proposal for a `lintToZero` ask, and the decision that puts it to its deciders. */
export interface Promotion {
  readonly decision: Decision;
  readonly proposal: Proposal;
}

/** What `promotions` reads. */
export interface PromotionInput {
  /** The project's decisions so far, decided and expired ones included. */
  readonly existing: readonly Decision[];
  readonly finishes: readonly FinishRecord[];
  /** The next ids of the project's sequence (never `crypto.randomUUID`). */
  readonly ids: {
    readonly decision: DecisionId;
    readonly proposal: ProposalId;
  };
  readonly now: DateTime.Utc;
  readonly policy: Policy;
  readonly project: ProjectName;
}

/** The evidence labels a promotion is found again by. */
const labels = {
  area: "area",
  finished: "finished",
  promotedFrom: "promoted from",
  rule: "rule",
  want: "want",
  why: "why",
} as const;

/**
 * A lint rule as its id is written, in lowercase: `no-date-equality`,
 * `typescript/no-explicit-any`, `@typescript-eslint/no-explicit-any`.
 */
const ruleId = /^@?[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)*$/u;

/** Words joined as a rule's id joins them, by a dash or a slash. */
const joined = /[-/]/u;

/** A backticked span in a note: `` `no-date-equality` ``. */
const backticked = /`(?<span>[^`]+)`/gu;

/**
 * `text` as the rule a note names. It is taken as written, and it must join
 * two words or more, so a one-word note (`typo`) or a code span
 * (`startOfDay`) names no rule; a one-word rule (`eqeqeq`) comes from the
 * lanes.
 */
const asRule = (text: string): Option.Option<string> =>
  Option.liftPredicate(
    text.trim(),
    (word) => ruleId.test(word) && joined.test(word)
  );

/**
 * The rule a decider's note names: the note itself when it is one rule id,
 * else its first backticked span that is one. A note in prose alone names
 * no rule, so it promotes nothing: a `lintToZero` ask needs a rule.
 */
const ruleInNote = (note: string): Option.Option<string> =>
  Option.orElse(asRule(note), () =>
    Arr.findFirst([...note.matchAll(backticked)], ({ groups }) =>
      asRule(groups?.span ?? "")
    )
  );

/** Why a finish was made: the rule its lanes name, else the rule its note names. */
const reasonOf = (finish: FinishRecord): Option.Option<string> =>
  Option.orElse(
    Option.filter(
      Option.map(finish.rule, (rule) => rule.trim()),
      (rule) => rule !== ""
    ),
    () => Option.flatMap(finish.note, ruleInNote)
  );

/** A finish with the rule it was made for. */
interface Reasoned {
  readonly finish: FinishRecord;
  readonly rule: string;
}

/** Finishes in one area for one rule, oldest first. */
interface Group {
  readonly area: string;
  readonly finishes: Arr.NonEmptyReadonlyArray<FinishRecord>;
  readonly rule: string;
}

const byTime: Order.Order<FinishRecord> = Order.combine(
  Order.mapInput(DateTime.Order, ({ at }: FinishRecord) => at),
  Order.mapInput(Order.String, ({ ask }: FinishRecord) => ask)
);

const byGroup: Order.Order<Group> = Order.combine(
  Order.mapInput(Order.String, ({ area }: Group) => area),
  Order.mapInput(Order.String, ({ rule }: Group) => rule)
);

/** Finishes grouped by (area, rule), each group oldest first, groups by area then rule. */
const groupsOf = (finishes: readonly Reasoned[]): readonly Group[] =>
  Arr.sort(
    Object.values(
      Arr.groupBy(finishes, ({ finish, rule }) =>
        JSON.stringify([finish.area, rule])
      )
    ).map((members): Group => ({
      area: members[0].finish.area,
      finishes: Arr.sort(
        Arr.map(members, ({ finish }) => finish),
        byTime
      ),
      rule: members[0].rule,
    })),
    byGroup
  );

const valueOf = (decision: Decision, label: string) =>
  Arr.findFirst(decision.evidence, (each) => each.label === label).pipe(
    Option.map(({ value }) => value)
  );

/** The promotions decided or open for `group`'s area and rule. */
const promotedFor = (existing: readonly Decision[], group: Group) =>
  existing.filter(
    (decision) =>
      DecisionSubject.guards.OpenProposal(decision.subject) &&
      Option.isSome(valueOf(decision, labels.promotedFrom)) &&
      Option.contains(valueOf(decision, labels.area), group.area) &&
      Option.contains(valueOf(decision, labels.rule), group.rule)
  );

/** The finishes a promotion was made from: the key its evidence carries. */
const finishesNamed = (decision: Decision): readonly string[] =>
  Option.match(valueOf(decision, labels.promotedFrom), {
    onNone: () => [],
    onSome: (value) => value.split(" "),
  });

const isOpen = (decision: Decision, now: DateTime.Utc) =>
  decision.decided === undefined &&
  DateTime.isLessThan(now, decision.expiresAt);

/**
 * The finishes of `group` no earlier promotion of the same area and rule
 * was made from, each ask once; none while such a promotion is still open.
 * A promotion declined, or let expire, keeps its finishes: two new ones are
 * needed to ask again.
 */
const freshOf = (
  existing: readonly Decision[],
  group: Group,
  now: DateTime.Utc
): readonly FinishRecord[] => {
  const earlier = promotedFor(existing, group);

  if (earlier.some((decision) => isOpen(decision, now))) {
    return [];
  }

  const named = new Set(earlier.flatMap(finishesNamed));

  return Arr.dedupeWith(
    group.finishes.filter(({ ask }) => !named.has(ask)),
    (one, other) => one.ask === other.ask
  );
};

/** Whether an ask not yet closed already holds `rule` to zero. */
const alreadyAsked = (policy: Policy, rule: string) =>
  policy.asks.some(
    ({ check, state }) =>
      state !== "closed" &&
      CheckSpec.guards.LintToZero(check) &&
      check.rule === rule
  );

/**
 * The project's own lint command, with JSON output: a counted ratchet's for
 * `rule`, else any counted ratchet's, else a `lintToZero` ask's. A project
 * that has none is not guessed at, and nothing is promoted.
 */
const lintCommandOf = (policy: Policy, rule: string): Option.Option<string> => {
  const counted = policy.ratchets.flatMap(({ measure }) =>
    RatchetMeasure.guards.Count(measure) ? [measure] : []
  );

  return Arr.findFirst(counted, (count) => count.rule === rule).pipe(
    Option.orElse(() => Arr.head(counted)),
    Option.map(({ command }): string => command),
    Option.orElse(() =>
      Arr.findFirst(policy.asks, ({ check }) =>
        CheckSpec.guards.LintToZero(check)
          ? Option.some(check.command)
          : Option.none()
      )
    )
  );
};

/** The project's kind for `lintToZero` asks: the first of that check kind it lists. */
const lintKindOf = (policy: Policy): Option.Option<AskKind> =>
  Arr.findFirst(policy.kinds, ({ checkKind }) => checkKind === "lintToZero");

/** Where the ask may change things: a module by its name, or folders as globs. */
type Place =
  | { readonly module: string }
  | { readonly globs: Arr.NonEmptyReadonlyArray<string> };

const folderOf = (path: string) => path.split("/").slice(0, -1).join("/");

/** Whether `folder` sits under `other`. */
const isUnder = (folder: string, other: string) =>
  folder !== other && folder.startsWith(`${other}/`);

/**
 * The folders `paths` sit in, as globs, each under no other: `src/date/**`;
 * `**` when a file sits at the root.
 */
const foldersOf = (paths: readonly RepoPath[]): readonly string[] => {
  const folders = Arr.dedupe(paths.map(folderOf));

  if (folders.includes("")) {
    return ["**"];
  }

  return Arr.sort(
    folders.filter(
      (folder) => !folders.some((other) => isUnder(folder, other))
    ),
    Order.String
  ).map((folder) => `${folder}/**`);
};

/**
 * The territory the finishes touched: their area when it is one of the
 * project's modules, else the folders of the files they changed.
 */
const placeOf = (
  policy: Policy,
  area: string,
  finishes: readonly FinishRecord[]
): Option.Option<Place> => {
  if (policy.modules.some(({ module }) => module === area)) {
    return Option.some({ module: area });
  }

  const globs = foldersOf(finishes.flatMap(({ paths }) => paths));

  return Arr.isReadonlyArrayNonEmpty(globs)
    ? Option.some({ globs })
    : Option.none();
};

const describePlace = (place: Place) =>
  "module" in place ? place.module : place.globs.join(", ");

/** `no-date-equality` in `src/date` → `no-date-equality-in-src-date`. */
const slug = (text: string) =>
  text
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");

/** The new ask's id: the rule, and the area unless it is the whole repo. */
const askIdOf = (rule: string, area: string): Option.Option<AskId> =>
  Schema.decodeOption(AskId)(
    area === "." || slug(area) === ""
      ? slug(rule)
      : `${slug(rule)}-in-${slug(area)}`
  );

const quoted = (text: string) => JSON.stringify(text);

/** A list of names as a sentence says it: `alice`, `alice and bob`, `alice, bob and carol`. */
const spoken = (names: Arr.NonEmptyReadonlyArray<string>) => {
  const last = Arr.lastNonEmpty(names);
  const rest = Arr.initNonEmpty(names);

  return rest.length === 0 ? last : `${rest.join(", ")} and ${last}`;
};

/** What the ask file's territory field says. */
const territoryCall = (place: Place) =>
  "module" in place
    ? `territory.package(${quoted(place.module)})`
    : `territory.paths(${place.globs.map(quoted).join(", ")})`;

/**
 * The ask file, through the sdk's `kinds.lintToZero` when the project's
 * kind is that one, else through a kind of its own name made in the file
 * (as a migrate family's child is written). A `lintToZero` ask's check is
 * built from its args, so the ask file is its only file.
 */
const askFileOf = (input: {
  readonly command: string;
  readonly from: readonly FinishRecord[];
  readonly kind: AskKind;
  readonly place: Place;
  readonly rule: string;
  readonly want: string;
}) => {
  const sdk = quoted(`${Brand.cliPackage}/rules`);

  const header = `// Promoted by ${Brand.name} from ${input.from.length} finishes for the same thing: ${input.from.map(({ ask }) => ask).join(", ")}.`;

  const stated = [
    `  territory: ${territoryCall(input.place)},`,
    `  want: ${quoted(input.want)},`,
  ];

  if (input.kind.name === "lintToZero") {
    return [
      header,
      `import { kinds, territory } from ${sdk};`,
      "",
      "export default kinds.lintToZero.ask({",
      `  command: ${quoted(input.command)},`,
      `  rule: ${quoted(input.rule)},`,
      ...stated,
      "});",
      "",
    ].join("\n");
  }

  return [
    header,
    `import { check, kind, territory } from ${sdk};`,
    "",
    "const own = kind({",
    "  args: {},",
    `  check: () => check.lintToZero(${quoted(input.rule)}, ${quoted(input.command)}),`,
    `  checkKind: "lintToZero",`,
    `  name: ${quoted(input.kind.name)},`,
    "});",
    "",
    "export default own.ask({",
    ...stated,
    "});",
    "",
  ].join("\n");
};

/** One finish as its decision shows it: `compare-days by alice on 2026-10-01: <note>`. */
const finishLine = (finish: FinishRecord) => {
  const line = `${finish.ask} by ${finish.decider} on ${DateTime.formatIsoDateUtc(finish.at)}`;

  return Option.match(finish.note, {
    onNone: () => line,
    onSome: (note) => `${line}: ${note.trim()}`,
  });
};

/** `group`'s promotion, when it is due and the project can hold its ask. */
const promotionOf = (
  input: PromotionInput,
  group: Group
): Option.Option<Promotion> => {
  const { now, policy } = input;
  const { area, rule } = group;
  const fresh = freshOf(input.existing, group, now);

  const [first, second, ...more] = fresh;

  if (
    first === undefined ||
    second === undefined ||
    alreadyAsked(policy, rule)
  ) {
    return Option.none();
  }

  const finishers = Arr.dedupeWith(
    Arr.map(Arr.make(first, second, ...more), ({ decider }) => decider),
    sameHandle
  );

  const touched = fresh.flatMap(({ paths }) => paths);

  // The finishers who still decide for what they touched: the decision is
  // theirs ("you finished 2 answers …"), and accepting needs a decider.
  const deciders = decidersFor(policy, touched).filter((decider) =>
    fresh.some((finish) => sameHandle(finish.decider, decider))
  );

  return Option.gen(function* () {
    const kind = yield* lintKindOf(policy);
    const command = yield* lintCommandOf(policy, rule);
    const place = yield* placeOf(policy, area, fresh);
    const ask = yield* askIdOf(rule, area);

    const deciding = yield* Arr.isReadonlyArrayNonEmpty(deciders)
      ? Option.some(deciders)
      : Option.none();

    const want = `The lint rule \`${rule}\` reports nothing in ${describePlace(place)}`;
    const path = RepoPath.make(`${Brand.configDir}/asks/${ask}.ask.ts`);

    const evidence: readonly Evidence[] = [
      { label: labels.want, value: want },
      { label: labels.area, value: area },
      { label: labels.rule, value: rule },
      {
        label: labels.why,
        value: `${spoken(finishers)} finished ${fresh.length} answers for the same thing (${rule})`,
      },
      ...fresh.map((finish) => ({
        label: labels.finished,
        value: finishLine(finish),
      })),
      {
        label: labels.promotedFrom,
        value: fresh.map(({ ask: each }) => each).join(" "),
      },
      {
        label: path,
        value: askFileOf({ command, from: fresh, kind, place, rule, want }),
      },
    ];

    const proposal: Proposal = {
      expiresAt: DateTime.add(now, { days: policy.budget.expireDays }),
      files: [path],
      id: input.ids.proposal,
      openedAt: now,
      project: input.project,
      proposer: platformHandle,
      state: "open",
      territory: describePlace(place),
      want,
    };

    const decision = openDecision({
      deciders: deciding,
      evidence,
      expireDays: policy.budget.expireDays,
      id: input.ids.decision,
      now,
      project: input.project,
      subject: DecisionSubject.cases.OpenProposal.make({
        proposal: proposal.id,
      }),
    });

    return { decision, proposal };
  });
};

/**
 * The promotions due: finishes grouped by (area, rule), counting those
 * within the policy's record window; a group of two or more finishes no
 * earlier promotion of it was made from, with no promotion of it still
 * open, is put to the finishers who still decide for what they touched.
 *
 * At most one per call, since `ids` is one pair from the project's
 * sequence: called as each finish lands, only that finish's group can
 * become due. Groups go by area, then rule; one that cannot be held as an
 * ask (no rule, no `lintToZero` kind, no JSON lint command, an ask for the
 * rule already open, no decider left) is skipped.
 */
export const promotions = (input: PromotionInput): readonly Promotion[] => {
  const since = DateTime.subtract(input.now, {
    days: input.policy.record.windowDays,
  });

  const reasoned = input.finishes.flatMap((finish): Reasoned[] =>
    DateTime.isGreaterThanOrEqualTo(finish.at, since) &&
    DateTime.isLessThanOrEqualTo(finish.at, input.now)
      ? Option.match(reasonOf(finish), {
          onNone: () => [],
          onSome: (rule) => [{ finish, rule }],
        })
      : []
  );

  return Option.toArray(
    Arr.findFirst(groupsOf(reasoned), (group) => promotionOf(input, group))
  );
};
