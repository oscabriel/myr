import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Decision } from "@repo/protocol/domain/decision";
import { LedgerEntry } from "@repo/protocol/domain/visibility";
import type {
  Ledger,
  VisibilityPolicy,
} from "@repo/protocol/domain/visibility";
import type { ProjectName } from "@repo/protocol/ids";
import type { Posture } from "@repo/protocol/posture";
import { ledgerOf } from "@repo/visibility/ledger";
import { postureOf } from "@repo/visibility/posture";
import { Array as Arr, DateTime, Option } from "effect";

import { ProjectEventInput } from "../events.ts";
import type { ProjectSnapshot, ProjectWrites } from "../project-store.ts";
import type { LayerRow, LedgerRow } from "../project-store/rows.ts";
import { policyIn } from "../visibility-port.ts";

const WORDS = {
  open: "Open",
  openCore: "Open core",
  openOnSchedule: "Open on schedule",
  openWithSealedEvidence: "Open with sealed evidence",
  sourceAvailable: "Source available",
} as const satisfies Record<Posture, string>;

export const nextSeq = (rows: readonly LedgerRow[]): number =>
  Math.max(0, ...rows.map(({ seq }) => seq)) + 1;

export const appended = (entries: readonly LedgerEntry[]): ProjectWrites =>
  entries.length === 0
    ? {}
    : {
        events: entries.map((entry) =>
          ProjectEventInput.LedgerAppended({ at: entry.at, entry })
        ),
        ledger: entries,
      };

export const visibilityIn = (
  snapshot: ProjectSnapshot
): Option.Option<VisibilityPolicy> =>
  Option.flatMap(policyIn(snapshot), (policy) =>
    Option.fromUndefinedOr(policy.visibility)
  );

export const declaredBy = (visibility: Option.Option<VisibilityPolicy>) =>
  postureOf({ licence: Option.none(), visibility });

type PostureChange = Extract<
  DecisionSubject,
  { readonly _tag: "PostureChange" }
>;

interface Asked {
  readonly decision: Decision;
  readonly subject: PostureChange;
}

const askedOf = (decision: Decision): Option.Option<Asked> =>
  DecisionSubject.guards.PostureChange(decision.subject)
    ? Option.some({ decision, subject: decision.subject })
    : Option.none();

const takesEffect = (decision: Decision, noticeDays: number) =>
  Option.map(
    Option.filter(
      Option.fromUndefinedOr(decision.decided),
      ({ choice }) => choice === "accept"
    ),
    ({ at }) =>
      DateTime.max(at, DateTime.add(decision.openedAt, { days: noticeDays }))
  );

export interface Standing {
  readonly label: string;
  readonly posture: Posture;
  readonly declared: Posture;
  readonly changed: Option.Option<{
    readonly at: DateTime.Utc;
    readonly decision: Decision;
    readonly subject: PostureChange;
  }>;
}

/** Only the latest posture decision counts: a config that moved on from its `to` without a decision widened, and stands. */
export const standing = (input: {
  readonly decisions: readonly Decision[];
  readonly now: DateTime.Utc;
  readonly visibility: Option.Option<VisibilityPolicy>;
}): Standing => {
  const declared = declaredBy(input.visibility);

  const asked = Option.filter(
    Arr.last(
      input.decisions.flatMap((decision) => Option.toArray(askedOf(decision)))
    ),
    ({ subject }) => subject.to === declared.posture
  );

  if (Option.isNone(asked)) {
    return {
      changed: Option.none(),
      declared: declared.posture,
      ...declared,
    };
  }

  const noticeDays = Option.match(input.visibility, {
    onNone: () => 0,
    onSome: ({ notice }) => notice.narrowingDays,
  });

  const effective = Option.filter(
    takesEffect(asked.value.decision, noticeDays),
    (at) => DateTime.isLessThanOrEqualTo(at, input.now)
  );

  return Option.match(effective, {
    onNone: (): Standing => ({
      changed: Option.none(),
      declared: declared.posture,
      label: WORDS[asked.value.subject.from],
      posture: asked.value.subject.from,
    }),
    onSome: (at): Standing => ({
      changed: Option.some({ at, ...asked.value }),
      declared: declared.posture,
      ...declared,
    }),
  });
};

export const nextMove = (input: {
  readonly decisions: readonly Decision[];
  readonly now: DateTime.Utc;
  readonly visibility: Option.Option<VisibilityPolicy>;
}): Option.Option<DateTime.Utc> => {
  const declared = declaredBy(input.visibility);

  const noticeDays = Option.match(input.visibility, {
    onNone: () => 0,
    onSome: ({ notice }) => notice.narrowingDays,
  });

  return Arr.last(
    input.decisions.flatMap((decision) => Option.toArray(askedOf(decision)))
  ).pipe(
    Option.filter(({ subject }) => subject.to === declared.posture),
    Option.flatMap(({ decision }) => takesEffect(decision, noticeDays)),
    Option.filter((at) => DateTime.isGreaterThan(at, input.now))
  );
};

/** Not while a narrowing from Open waits on its decision: nothing was sealed before. */
export const sealedInEffect = (posture: Standing) =>
  posture.posture !== "open" || posture.declared === "open";

export const postureCaughtUp = (
  snapshot: ProjectSnapshot,
  posture: Standing,
  seq: number
): readonly LedgerEntry[] =>
  Option.match(posture.changed, {
    onNone: () => [],
    onSome: ({ at, decision, subject }) =>
      snapshot.ledger.some(
        (row) =>
          LedgerEntry.guards.PostureChanged(row) && row.decision === decision.id
      )
        ? []
        : [
            LedgerEntry.cases.PostureChanged.make({
              at,
              decision: decision.id,
              from: subject.from,
              seq,
              to: subject.to,
            }),
          ],
  });

const withRepos = (
  visibility: VisibilityPolicy,
  rows: readonly LayerRow[]
): VisibilityPolicy => ({
  ...visibility,
  layers: visibility.layers.map((layer) =>
    Option.match(
      Arr.findFirst(rows, ({ name }) => name === layer.name),
      {
        onNone: () => layer,
        onSome: ({ repo }) => ({ ...layer, repo }),
      }
    )
  ),
});

/** The layer read log is the layers' readers' own, never in the public ledger. */
export const ledgerFor = (
  project: ProjectName,
  snapshot: ProjectSnapshot,
  now: DateTime.Utc
): Ledger => {
  const visibility = visibilityIn(snapshot);

  const ledger = ledgerOf({
    licence: Option.none(),
    project,
    rows: snapshot.ledger,
    visibility: Option.map(visibility, (declared) =>
      withRepos(declared, snapshot.layers)
    ),
  });

  const { label, posture } = standing({
    decisions: snapshot.decisions,
    now,
    visibility,
  });

  return { ...ledger, posture, postureLabel: label };
};
