// Written with `createElement`, so the CLI's `.ts` build needs no JSX.
import { TextAttributes } from "@opentui/core";
import { createElement } from "@opentui/react";
import type { BoxProps, TextProps } from "@opentui/react";
import type { JSX } from "@opentui/react/jsx-runtime";
import { DecisionSubject } from "@repo/protocol/domain/decision";
import type { Choice, Decision } from "@repo/protocol/domain/decision";
import { DateTime, Option } from "effect";

import { choicesFor, current, inOrder, placeOf, soonIn } from "./today.ts";
import type { DecideCall, TodayViewState } from "./today.ts";

const short = (sha: string) => sha.slice(0, 7);

const refWords = (ref: string) => ref.replace(/^refs\/heads\//u, "");

const about = DecisionSubject.match({
  Finish: ({ ask, head }) => `finish the answer to ${ask} at ${short(head)}`,
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

/** Boxes keep their own height: a short terminal cuts the screen at its foot rather than drawing rows over each other. */
const box = (props: BoxProps, ...children: readonly JSX.Element[]) =>
  createElement("box", { flexShrink: 0, ...props }, ...children);

const line = (content: string, props: TextProps = {}) =>
  createElement("text", { flexShrink: 0, wrapMode: "word", ...props }, content);

const muted = { attributes: TextAttributes.DIM } as const satisfies TextProps;

const firstLine = (value: string) => {
  const [first = "", ...rest] = value.split("\n");

  return rest.length === 0
    ? first
    : `${first} (${plural(rest.length, "more line", "more lines")})`;
};

const Heading = ({ state }: { readonly state: TodayViewState }) => {
  const { decider, decisions, expiringSoon } = state.today;

  return box(
    { flexDirection: "column" },
    line(`Today for ${decider}`, { attributes: TextAttributes.BOLD }),
    line(
      `${plural(decisions.length, "decision", "decisions")} waiting${expiringSoon.length === 0 ? "" : ` · ${expiringSoon.length} due within a day`}`
    ),
    line("Each expires to its default if nobody decides first.", muted)
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
      `${here ? ">" : " "} ${soon ? "!" : " "} ${placeOf(decision.project, decision.id)}  ${about(decision.subject)}`,
      here ? { attributes: TextAttributes.BOLD } : {}
    ),
    line(
      `      expires ${byWhen(decision.expiresAt)}${soon ? ", within the day" : ""} · if nobody decides: ${decision.default}`
    ),
    ...decision.evidence.map(({ label, value }) =>
      line(`      ${label}: ${firstLine(value)}`, muted)
    )
  );

/** Decisions above the cursor are only counted, so the one a key would take is never cut off at the foot. */
const Decisions = ({ state }: { readonly state: TodayViewState }) => {
  const ordered = inOrder(state.today);
  const isSoon = soonIn(state.today);
  const above = state.cursor;

  return ordered.length === 0
    ? line(
        "Nothing to decide today. Undecided decisions expire to their safe default."
      )
    : box(
        { flexDirection: "column", gap: 1 },
        ...(above === 0
          ? []
          : [
              line(
                `${plural(above, "decision", "decisions")} above; up to read them`,
                muted
              ),
            ]),
        ...ordered.slice(above).map((decision, index) =>
          createElement(Entry, {
            decision,
            here: index === 0,
            key: placeOf(decision.project, decision.id),
            soon: isSoon(decision),
          })
        )
      );
};

const Newcomers = ({ state }: { readonly state: TodayViewState }) =>
  state.today.newcomers.length === 0
    ? box({})
    : line(`Newcomers to welcome: ${state.today.newcomers.join(", ")}`);

const question = (call: DecideCall, fallback: Choice) =>
  `${capitalized(call.choice)} ${placeOf(call.project, call.decision)}? Its default is ${fallback}. y to send it, n to keep it open.`;

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

export const TodayView = ({
  state,
}: {
  readonly state: TodayViewState;
}): JSX.Element =>
  box(
    { flexDirection: "column", gap: 1 },
    createElement(Heading, { state }),
    createElement(Decisions, { state }),
    createElement(Newcomers, { state }),
    createElement(Keys, { state })
  );
