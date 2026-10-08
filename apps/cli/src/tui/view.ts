/**
 * Today on a terminal screen, drawn by OpenTUI's React renderer from the
 * state alone: whose Today it is and the budget; the decisions in the order
 * a decider takes them, each with what it is about, when it expires (marked
 * when that is within the day), its default and its evidence; the newcomers
 * to welcome; what the last choice came to; and the keys the decision under
 * the cursor takes. Written with `createElement`, so the CLI's `.ts` build
 * needs no JSX.
 */
import { TextAttributes } from "@opentui/core";
import { createElement } from "@opentui/react";
import type { BoxProps, TextProps } from "@opentui/react";
import type { JSX } from "@opentui/react/jsx-runtime";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Choice, Decision } from "@repo/protocol/domain/decision";
import { DateTime, Option } from "effect";

import { choicesFor, current, inOrder, soonIn } from "./today.ts";
import type { DecideCall, TodayViewState } from "./today.ts";

const short = (sha: string) => sha.slice(0, 7);

/** A ref as people say it: `main` for `refs/heads/main`. */
const refWords = (ref: string) => ref.replace(/^refs\/heads\//u, "");

/** What a decision is about, in a few words. */
const about = DecisionSubject.match({
  Finish: ({ ask, head }) => `finish the answer to ${ask} at ${short(head)}`,
  OpenProposal: ({ proposal }) => `open the ask ${proposal} proposes`,
  PostureChange: ({ from, to }) => `change the posture from ${from} to ${to}`,
  ProxyWidened: ({ hosts, item }) =>
    `let ${item} reach ${hosts.join(", ")} through the platform's proxy`,
  RaiseRatchet: ({ after, ask, before, ratchet, territory }) =>
    `raise the ${ratchet} ratchet in ${territory} from ${before} to ${after}, for ${ask}`,
  SecretInTree: ({ ask, item }) =>
    `${item}'s write-only value showed up in an answer to ${ask}`,
  StrayPush: ({ after, before, ref }) =>
    `${refWords(ref)} moved from ${short(before)} to ${short(after)} without a landing`,
  Vouch: ({ handle }) => `vouch for ${handle}`,
  Waiver: ({ at, marker, reason }) =>
    `allow ${marker} at ${at.path}:${at.line} ("${reason}")`,
});

/** An expiry as a decider reads it: weekday, date and time, in UTC. */
const byWhen = (at: DateTime.Utc) =>
  `${DateTime.formatUtc(at, {
    day: "numeric",
    hour: "2-digit",
    hourCycle: "h23",
    locale: "en-GB",
    minute: "2-digit",
    month: "short",
    weekday: "short",
  })} UTC`;

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

const capitalized = (word: string) =>
  `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`;

const where = ({ decision, project }: DecideCall) => `${project}/${decision}`;

const box = (props: BoxProps, ...children: readonly JSX.Element[]) =>
  createElement("box", props, ...children);

const line = (content: string, props: TextProps = {}) =>
  createElement("text", { wrapMode: "word", ...props }, content);

const muted = { attributes: TextAttributes.DIM } as const satisfies TextProps;

/** One fact's value as a row holds it: its first line, and how many follow. */
const firstLine = (value: string) => {
  const [first = "", ...rest] = value.split("\n");

  return rest.length === 0
    ? first
    : `${first} (${plural(rest.length, "more line", "more lines")})`;
};

const Budget = ({ state }: { readonly state: TodayViewState }) => {
  const { budget, decider, overflow } = state.today;
  const left = Math.max(0, budget.total - budget.used);

  return box(
    { flexDirection: "column" },
    line(`Today for ${decider}`, { attributes: TextAttributes.BOLD }),
    line(
      `Budget: ${budget.used} of ${budget.total} decisions used, ${left} left today · ${plural(budget.finishes, "finish", "finishes")}, counted apart`
    ),
    ...(overflow === 0
      ? []
      : [
          line(
            `${overflow} more ${overflow === 1 ? "waits" : "wait"} for tomorrow; each expires to its default if nobody decides first.`,
            muted
          ),
        ])
  );
};

const Entry = ({
  decision,
  here,
  soon,
}: {
  readonly decision: Decision;
  readonly here: boolean;
  readonly soon: boolean;
}) =>
  box(
    { flexDirection: "column" },
    line(
      `${here ? ">" : " "} ${soon ? "!" : " "} ${decision.project}/${decision.id}  ${about(decision.subject)}`,
      here ? { attributes: TextAttributes.BOLD } : {}
    ),
    line(
      `      expires ${byWhen(decision.expiresAt)}${soon ? ", within the day" : ""} · if nobody decides: ${decision.default}`
    ),
    ...decision.evidence.map(({ label, value }) =>
      line(`      ${label}: ${firstLine(value)}`, muted)
    )
  );

const Decisions = ({ state }: { readonly state: TodayViewState }) => {
  const ordered = inOrder(state.today);
  const isSoon = soonIn(state.today);

  return ordered.length === 0
    ? line(
        "Nothing to decide today. Undecided decisions expire to their safe default."
      )
    : box(
        { flexDirection: "column", gap: 1 },
        ...ordered.map((decision, index) =>
          createElement(Entry, {
            decision,
            here: index === state.cursor,
            key: `${decision.project}/${decision.id}`,
            soon: isSoon(decision),
          })
        )
      );
};

const Newcomers = ({ state }: { readonly state: TodayViewState }) =>
  state.today.newcomers.length === 0
    ? box({})
    : line(`Newcomers to welcome: ${state.today.newcomers.join(", ")}`);

/** The question a choice other than the default waits on. */
const question = (call: DecideCall, fallback: Choice) =>
  `${capitalized(call.choice)} ${where(call)}? Its default is ${fallback}. y to send it, n to keep it open.`;

/** The keys the decision under the cursor takes, or the confirmation waiting. */
const Keys = ({ state }: { readonly state: TodayViewState }) => {
  const here = current(state);

  const asking = Option.flatMap(state.confirming, (call) =>
    Option.map(here, (decision) => question(call, decision.default))
  );

  const choices = Option.match(here, {
    onNone: () => [],
    onSome: (decision) =>
      choicesFor(decision).map(({ choice, key }) => `${key} ${choice}`),
  });

  return box(
    { flexDirection: "column" },
    ...state.notice.map((text) => line(text)),
    ...Option.toArray(
      Option.map(asking, (text) =>
        line(text, { attributes: TextAttributes.BOLD })
      )
    ),
    line(["up/down move", ...choices, "q quit"].join(" · "), muted)
  );
};

/** The whole screen for one state. */
export const TodayView = ({
  state,
}: {
  readonly state: TodayViewState;
}): JSX.Element =>
  box(
    { flexDirection: "column", gap: 1 },
    createElement(Budget, { state }),
    createElement(Decisions, { state }),
    createElement(Newcomers, { state }),
    createElement(Keys, { state })
  );
