/**
 * Stage 1, shape: what the push's changes do, read from the change list and
 * the added lines alone. It accumulates, so one push hears about every
 * problem at once, in the order of the refusal union's Shape group.
 *
 * The stage's value is `scan` (lint keeps "shape" out of symbol names); its
 * `name` is the stage's, `shape`.
 */
import type { Ask } from "@repo/protocol/domain/ask";
import { CheckSpec } from "@repo/protocol/domain/check";
import { RepoPath } from "@repo/protocol/ids";
import {
  groups,
  OutOfScope,
  PrivatePathInPublicTree,
  ReachedInternals,
  TouchedJudge,
  Weakened,
} from "@repo/protocol/refusal";
import type { Refusal } from "@repo/protocol/refusal";
import { Array, Effect, Option, Order } from "effect";

import type { AddedLine, PushFacts } from "../facts.ts";
import { matchAny } from "../glob.ts";
import { importSpecifiers, reachedInternals as reachInto } from "../imports.ts";
import { markersOf, scanMarkers } from "../markers.ts";
import type { Stage } from "../stage.ts";

/** The one JSON pointer the gate is told about: whether the scripts changed. */
const SCRIPTS = "package.json#/scripts";

/** The ask's own files: its file in the config folder, and its check's file. */
const ownFiles = (ask: Ask): ReadonlySet<string> =>
  new Set([
    ask.file,
    ...(CheckSpec.guards.RedThenGreen(ask.check) ? [ask.check.path] : []),
  ]);

/** Each path once, in a fixed order, if there are any. */
const someOf = (
  paths: Iterable<RepoPath>
): Option.Option<Array.NonEmptyReadonlyArray<RepoPath>> => {
  const each = [...new Set(paths)].toSorted();

  return Array.isReadonlyArrayNonEmpty(each)
    ? Option.some(each)
    : Option.none();
};

/**
 * Whether a path judges the push. An answer may not touch its ask's own
 * files, which judge it; a decider opening the ask writes them.
 */
const judges = (facts: PushFacts) => (path: RepoPath) => {
  const own = Option.exists(facts.ask, (ask) => ownFiles(ask).has(path));

  return facts.opensAsk && own
    ? false
    : own || matchAny(facts.policy.judge.paths, path);
};

/**
 * Whether a path is the push's to change: inside the ask's territory, or one
 * of the ask's own files when a decider opens it. With no ask (a decider's
 * own landing) there is no territory to leave.
 */
const inScope = (facts: PushFacts) => (path: RepoPath) =>
  Option.match(facts.ask, {
    onNone: () => true,
    onSome: (ask) =>
      matchAny(ask.territory.paths, path) ||
      (facts.opensAsk && ownFiles(ask).has(path)),
  });

/** Changed paths outside the territory. A judged path is TouchedJudge's to name. */
const outOfScope = (facts: PushFacts): readonly Refusal[] => {
  const judged = judges(facts);
  const allowed = inScope(facts);

  return Option.match(
    someOf(
      facts.changes
        .map((change) => change.path)
        .filter((path) => !allowed(path) && !judged(path))
    ),
    {
      onNone: () => [],
      onSome: (paths) => [new OutOfScope({ paths })],
    }
  );
};

/** Changed paths in the judge closure, and the scripts pointer when it moved. */
const touchedJudge = (facts: PushFacts): readonly Refusal[] => {
  const scripts =
    facts.scriptsChanged && facts.policy.judge.pointers.includes(SCRIPTS)
      ? [RepoPath.make(SCRIPTS)]
      : [];

  return Option.match(
    someOf([
      ...facts.changes.map((change) => change.path).filter(judges(facts)),
      ...scripts,
    ]),
    {
      onNone: () => [],
      onSome: (paths) => [new TouchedJudge({ paths })],
    }
  );
};

/** Every marker added with no reason; a reasoned one is an escape, for `escapeDecisions`. */
const weakened = (facts: PushFacts): readonly Refusal[] =>
  scanMarkers(facts.addedLines, markersOf(facts.policy)).flatMap(
    ({ line, marker, path, reason }) =>
      Option.isNone(reason)
        ? [new Weakened({ at: { line, path }, weakening: { marker } })]
        : []
  );

/** Added or changed paths a layer holds: nothing from a layer enters a public tree. */
const privatePaths = (facts: PushFacts): readonly Refusal[] =>
  Option.match(
    someOf(
      facts.changes.flatMap((change) =>
        change.status !== "deleted" && facts.layerPaths.has(change.path)
          ? [change.path]
          : []
      )
    ),
    {
      onNone: () => [],
      onSome: (paths) => [new PrivatePathInPublicTree({ paths })],
    }
  );

// The files whose imports are read: JavaScript and TypeScript sources.
const SCRIPT = /\.[cm]?[jt]sx?$/u;

/**
 * Each run of consecutive added lines as one text, with the number of the
 * line before it, so an import over several lines is read whole.
 */
const runsOf = (lines: readonly AddedLine[]) => {
  // Consecutive lines keep the same difference from their place in order.
  const placed = lines
    .toSorted((one, other) => one.line - other.line)
    .map((added, index) => ({ ...added, run: added.line - index }));

  return Array.isReadonlyArrayNonEmpty(placed)
    ? Array.groupWith(placed, (one, other) => one.run === other.run).map(
        (run) => ({
          offset: Array.headNonEmpty(run).line - 1,
          text: run.map((added) => added.text).join("\n"),
        })
      )
    : [];
};

/**
 * Imports the answer adds to a script inside its territory that reach into
 * another module's internals, each on its line. A push that answers no ask
 * (a decider's own landing) is not judged.
 */
const reachedInternals = (facts: PushFacts): readonly Refusal[] =>
  Option.match(facts.ask, {
    onNone: () => [],
    onSome: ({ territory }) =>
      [...facts.addedLines]
        .filter(
          ([path]) => SCRIPT.test(path) && matchAny(territory.paths, path)
        )
        .flatMap(([from, lines]) =>
          runsOf(lines).flatMap(({ offset, text }) =>
            importSpecifiers(text).flatMap(({ line, specifier }) =>
              Option.match(
                reachInto({
                  from,
                  modules: facts.policy.modules,
                  specifier,
                }),
                {
                  onNone: () => [],
                  onSome: ({ to }) => [
                    new ReachedInternals({
                      at: { line: offset + line, path: from },
                      from,
                      to,
                    }),
                  ],
                }
              )
            )
          )
        ),
  });

// The Shape group's tags, in union order.
const unionOrder: readonly string[] =
  groups
    .find((group) => group.name === "Shape")
    ?.members.map((member) => member.identifier) ?? [];

/** Union group order, then path, then line. */
const byUnionOrder = Order.combineAll<Refusal>([
  Order.mapInput(Order.Number, (refusal) => unionOrder.indexOf(refusal._tag)),
  Order.mapInput(Order.String, (refusal) => refusal.at?.path ?? ""),
  Order.mapInput(Order.Number, (refusal) => refusal.at?.line ?? 0),
]);

/**
 * Stage 1: every problem the push's changes have, in the union's Shape
 * order, then by path, then by line.
 */
export const scan: Stage<never> = {
  accumulate: true,
  name: "shape",
  run: (facts) =>
    Effect.succeed(
      [
        ...outOfScope(facts),
        ...touchedJudge(facts),
        ...weakened(facts),
        ...privatePaths(facts),
        ...reachedInternals(facts),
      ].toSorted(byUnionOrder)
    ),
};
