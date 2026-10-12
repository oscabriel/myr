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

export interface FinishRecord {
  readonly ask: AskId;
  readonly area: string;
  readonly decider: Handle;
  readonly at: DateTime.Utc;
  readonly rule: Option.Option<string>;
  readonly note: Option.Option<string>;
  readonly paths: readonly RepoPath[];
}

export interface Promotion {
  readonly decision: Decision;
  readonly proposal: Proposal;
}

export interface PromotionInput {
  readonly existing: readonly Decision[];
  readonly finishes: readonly FinishRecord[];
  readonly ids: {
    readonly decision: DecisionId;
    readonly proposal: ProposalId;
  };
  readonly now: DateTime.Utc;
  readonly policy: Policy;
  readonly project: ProjectName;
}

const labels = {
  area: "area",
  finished: "finished",
  promotedFrom: "promoted from",
  rule: "rule",
  want: "want",
  why: "why",
} as const;

const ruleId = /^@?[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)*$/u;

const joined = /[-/]/u;

const backticked = /`(?<span>[^`]+)`/gu;

const asRule = (text: string): Option.Option<string> =>
  Option.liftPredicate(
    text.trim(),
    (word) => ruleId.test(word) && joined.test(word)
  );

const ruleInNote = (note: string): Option.Option<string> =>
  Option.orElse(asRule(note), () =>
    Arr.findFirst([...note.matchAll(backticked)], ({ groups }) =>
      asRule(groups?.span ?? "")
    )
  );

const reasonOf = (finish: FinishRecord): Option.Option<string> =>
  Option.orElse(
    Option.filter(
      Option.map(finish.rule, (rule) => rule.trim()),
      (rule) => rule !== ""
    ),
    () => Option.flatMap(finish.note, ruleInNote)
  );

interface Reasoned {
  readonly finish: FinishRecord;
  readonly rule: string;
}

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

const promotedFor = (existing: readonly Decision[], group: Group) =>
  existing.filter(
    (decision) =>
      DecisionSubject.guards.OpenProposal(decision.subject) &&
      Option.isSome(valueOf(decision, labels.promotedFrom)) &&
      Option.contains(valueOf(decision, labels.area), group.area) &&
      Option.contains(valueOf(decision, labels.rule), group.rule)
  );

const finishesNamed = (decision: Decision): readonly string[] =>
  Option.match(valueOf(decision, labels.promotedFrom), {
    onNone: () => [],
    onSome: (value) => value.split(" "),
  });

const isOpen = (decision: Decision, now: DateTime.Utc) =>
  decision.decided === undefined &&
  DateTime.isLessThan(now, decision.expiresAt);

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

const alreadyAsked = (policy: Policy, rule: string) =>
  policy.asks.some(
    ({ check, state }) =>
      state !== "closed" &&
      CheckSpec.guards.LintToZero(check) &&
      check.rule === rule
  );

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

const lintKindOf = (policy: Policy): Option.Option<AskKind> =>
  Arr.findFirst(policy.kinds, ({ checkKind }) => checkKind === "lintToZero");

type Place =
  | { readonly module: string }
  | { readonly globs: Arr.NonEmptyReadonlyArray<string> };

const folderOf = (path: string) => path.split("/").slice(0, -1).join("/");

const isUnder = (folder: string, other: string) =>
  folder !== other && folder.startsWith(`${other}/`);

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

const slug = (text: string) =>
  text
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");

const askIdOf = (rule: string, area: string): Option.Option<AskId> =>
  Schema.decodeOption(AskId)(
    area === "." || slug(area) === ""
      ? slug(rule)
      : `${slug(rule)}-in-${slug(area)}`
  );

const quoted = (text: string) => JSON.stringify(text);

const spoken = (names: Arr.NonEmptyReadonlyArray<string>) => {
  const last = Arr.lastNonEmpty(names);
  const rest = Arr.initNonEmpty(names);

  return rest.length === 0 ? last : `${rest.join(", ")} and ${last}`;
};

const territoryCall = (place: Place) =>
  "module" in place
    ? `territory.package(${quoted(place.module)})`
    : `territory.paths(${place.globs.map(quoted).join(", ")})`;

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

const finishLine = (finish: FinishRecord) => {
  const line = `${finish.ask} by ${finish.decider} on ${DateTime.formatIsoDateUtc(finish.at)}`;

  return Option.match(finish.note, {
    onNone: () => line,
    onSome: (note) => `${line}: ${note.trim()}`,
  });
};

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

  // Only finishers who still decide: accepting needs a maintainer.
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

/** At most one per call: `ids` is one pair from the project's sequence. */
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
