/**
 * The public ledger as the Project DO keeps it:
 * its rows numbered in order, each one also told to watchers and the
 * projection as `LedgerAppended`, and the posture the public is shown.
 *
 * A change to the visibility config that narrows the posture is a
 * `PostureChange` decision (the posture's ratchet): until a decider accepts it
 * and the config's notice period has run since it opened, the posture that
 * stood before stays in effect. Widening needs no decision, and a project's
 * first config stands at once: nothing was public before it existed.
 */
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

/** Each posture in GLOSSARY.md's words: how a posture still in effect is shown. */
const WORDS = {
  open: "Open",
  openCore: "Open core",
  openOnSchedule: "Open on schedule",
  openWithSealedEvidence: "Open with sealed evidence",
  sourceAvailable: "Source available",
} as const satisfies Record<Posture, string>;

/** The number the next ledger row takes: one past the highest kept. */
export const nextSeq = (rows: readonly LedgerRow[]): number =>
  Math.max(0, ...rows.map(({ seq }) => seq)) + 1;

/** Ledger rows as a plan writes them: the rows, and an event for each. */
export const appended = (entries: readonly LedgerEntry[]): ProjectWrites =>
  entries.length === 0
    ? {}
    : {
        events: entries.map((entry) =>
          ProjectEventInput.LedgerAppended({ at: entry.at, entry })
        ),
        ledger: entries,
      };

/** The visibility config a snapshot's policy holds. */
export const visibilityIn = (
  snapshot: ProjectSnapshot
): Option.Option<VisibilityPolicy> =>
  Option.flatMap(policyIn(snapshot), (policy) =>
    Option.fromUndefinedOr(policy.visibility)
  );

/** The posture a config declares, and its label, read from the config alone. */
export const declaredBy = (visibility: Option.Option<VisibilityPolicy>) =>
  postureOf({ licence: Option.none(), visibility });

type PostureChange = Extract<
  DecisionSubject,
  { readonly _tag: "PostureChange" }
>;

/** A decision about a posture change, with its subject typed. */
interface Asked {
  readonly decision: Decision;
  readonly subject: PostureChange;
}

const askedOf = (decision: Decision): Option.Option<Asked> =>
  DecisionSubject.guards.PostureChange(decision.subject)
    ? Option.some({ decision, subject: decision.subject })
    : Option.none();

/**
 * When an accepted narrowing takes effect: once it was accepted, and its
 * notice period has run since it opened. None while nobody accepted it.
 */
const takesEffect = (decision: Decision, noticeDays: number) =>
  Option.map(
    Option.filter(
      Option.fromUndefinedOr(decision.decided),
      ({ choice }) => choice === "accept"
    ),
    ({ at }) =>
      DateTime.max(at, DateTime.add(decision.openedAt, { days: noticeDays }))
  );

/** The posture in effect, and the decision that put it there or keeps it waiting. */
export interface Standing {
  readonly label: string;
  readonly posture: Posture;
  /** The posture the config declares, which may still wait on a decision. */
  readonly declared: Posture;
  /** The accepted narrowing that made the declared posture stand, and when it did. */
  readonly changed: Option.Option<{
    readonly at: DateTime.Utc;
    readonly decision: Decision;
    readonly subject: PostureChange;
  }>;
}

/**
 * The posture in effect at `now` under `visibility`: the declared one,
 * unless the latest posture decision asked about narrowing to it and has
 * not taken effect (open, declined, expired, or accepted with notice still
 * to run); then the posture it would narrow from, in GLOSSARY's words.
 *
 * Only the latest posture decision counts: every landing that narrows what
 * stands opens one, so a config that moved on from the latest one's `to`
 * without a decision widened, and stands, whatever an older decision about
 * the same posture came to.
 */
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

/**
 * Whether the config's held-back checks judge answers yet: not while a
 * narrowing from Open waits on its decision (nothing was sealed before).
 */
export const sealedInEffect = (posture: Standing) =>
  posture.posture !== "open" || posture.declared === "open";

/**
 * The `PostureChanged` row an accepted narrowing owes the ledger once it
 * took effect, if no row records it yet. A plan that writes appends it, so
 * the projection and the ledger's entries catch up with the posture shown.
 */
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

/** Each declared layer with the repo the project keeps for it, when it has one. */
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

/**
 * The public ledger: `ledgerOf` over the project's rows and its
 * config (each layer with its repo), shown with the posture in effect at
 * `now`. The layer read log is the layers' readers' own, never in it.
 */
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
