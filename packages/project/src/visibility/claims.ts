import type { HeldBackResult } from "@repo/protocol/domain/answer";
import type { SealedChecks } from "@repo/protocol/domain/visibility";
import { AreaName, sameHandle } from "@repo/protocol/ids";
import type { AskId, Handle, SuiteRoot } from "@repo/protocol/ids";
import { AttemptsExhausted, HeldBackFailed } from "@repo/protocol/refusal";
import { heldBackValue } from "@repo/visibility/commitment";
import { Array as Arr, DateTime, Number as Num, Option, Order } from "effect";

import type { AttemptRow } from "../project-store/rows.ts";

const DAY = 86_400_000;

const mondayOf = (at: DateTime.Utc) =>
  DateTime.startOf(at, "week", { weekStartsOn: 1 });

export const isoWeek = (at: DateTime.Utc): string => {
  // The week belongs to the year its Thursday falls in.
  const thursday = DateTime.add(mondayOf(at), { days: 3 });
  const year = DateTime.getPartUtc(thursday, "year");

  const newYear = DateTime.toEpochMillis(
    DateTime.makeUnsafe(`${year}-01-01T00:00:00Z`)
  );

  const dayOfYear = (DateTime.toEpochMillis(thursday) - newYear) / DAY;
  const week = Math.floor(dayOfYear / 7) + 1;

  return `${year}-W${String(week).padStart(2, "0")}`;
};

export const weekEnds = (at: DateTime.Utc): DateTime.Utc =>
  DateTime.add(mondayOf(at), { days: 7 });

export interface AttemptsLeft {
  readonly ok: boolean;
  readonly resetsAt: Option.Option<DateTime.Utc>;
}

export const attemptsLeft = (input: {
  readonly claimCount: number;
  readonly weekCount: number;
  readonly policy: SealedChecks["attempts"];
  readonly now: DateTime.Utc;
}): AttemptsLeft => {
  const ok =
    input.claimCount < input.policy.perClaim &&
    input.weekCount < input.policy.perPersonPerAreaPerWeek;

  return {
    ok,
    resetsAt: ok ? Option.none() : Option.some(weekEnds(input.now)),
  };
};

export interface AttemptsJudged {
  readonly attempts: readonly AttemptRow[];
  readonly refusals: readonly (AttemptsExhausted | HeldBackFailed)[];
  readonly trailer: Option.Option<string>;
}

export const judgeAttempts = (input: {
  readonly attempts: readonly AttemptRow[];
  readonly ask: AskId;
  readonly checks: SealedChecks;
  readonly claimant: Handle;
  readonly now: DateTime.Utc;
  readonly results: readonly HeldBackResult[];
  readonly suite: SuiteRoot;
}): AttemptsJudged => {
  const week = isoWeek(input.now);

  const areas = Arr.sort(Object.keys(input.checks.areas), Order.String).map(
    (area) => AreaName.make(area)
  );

  const ran = input.results.filter(
    ({ area, total }) => total > 0 && areas.includes(area)
  );

  const counted: AttemptRow[] = [];
  const refusals: (AttemptsExhausted | HeldBackFailed)[] = [];

  const thisWeek = (row: AttemptRow, area: AreaName) =>
    row.area === area &&
    row.week === week &&
    sameHandle(row.claimant, input.claimant);

  for (const area of areas) {
    const results = ran.filter((result) => result.area === area);

    if (results.length === 0) {
      continue;
    }

    const own = input.attempts.find(
      (row) => thisWeek(row, area) && row.ask === input.ask
    );

    const claimCount = own?.count ?? 0;

    const weekCount = Num.sumAll(
      input.attempts
        .filter((row) => thisWeek(row, area))
        .map(({ count }) => count)
    );

    const left = (more: number) =>
      attemptsLeft({
        claimCount: claimCount + more,
        now: input.now,
        policy: input.checks.attempts,
        weekCount: weekCount + more,
      });

    const exhausted = (resetsAt: Option.Option<DateTime.Utc>) =>
      new AttemptsExhausted({
        area,
        resetsAt: Option.getOrElse(resetsAt, () => weekEnds(input.now)),
      });

    const before = left(0);

    if (!before.ok) {
      refusals.push(exhausted(before.resetsAt));
      continue;
    }

    if (results.every(({ passed, total }) => passed >= total)) {
      continue;
    }

    const after = left(1);

    counted.push({
      area,
      ask: input.ask,
      claimant: own?.claimant ?? input.claimant,
      count: claimCount + 1,
      week,
    });

    refusals.push(
      after.ok
        ? new HeldBackFailed({ area, suite: input.suite })
        : exhausted(after.resetsAt)
    );
  }

  return {
    attempts: counted,
    refusals,
    trailer:
      refusals.length === 0
        ? heldBackValue({ areas, results: ran })
        : Option.none(),
  };
};
