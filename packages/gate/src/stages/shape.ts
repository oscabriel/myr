// The stage's value is `scan` (lint keeps "shape" out of symbol names); its
// `name` is `shape`.
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

import type { AddedLine, Change, PushFacts } from "../facts.ts";
import { matchAny } from "../glob.ts";
import { importSpecifiers, reachedInternals as reachInto } from "../imports.ts";
import { markersOf, scanMarkers } from "../markers.ts";
import type { Stage } from "../stage.ts";

const SCRIPTS = "package.json#/scripts";

const ownFiles = (ask: Ask): ReadonlySet<string> =>
  new Set([
    ask.file,
    ...(CheckSpec.guards.RedThenGreen(ask.check) ? [ask.check.path] : []),
  ]);

const someOf = (
  paths: Iterable<RepoPath>
): Option.Option<Array.NonEmptyReadonlyArray<RepoPath>> => {
  const each = [...new Set(paths)].toSorted();

  return Array.isReadonlyArrayNonEmpty(each)
    ? Option.some(each)
    : Option.none();
};

const judges = (facts: PushFacts) => (path: RepoPath) => {
  const own = Option.exists(facts.ask, (ask) => ownFiles(ask).has(path));

  return facts.opensAsk && own
    ? false
    : own || matchAny(facts.policy.judge.paths, path);
};

const inScope = (facts: PushFacts) => (path: RepoPath) =>
  Option.match(facts.ask, {
    onNone: () => true,
    onSome: (ask) =>
      matchAny(ask.territory.paths, path) ||
      (facts.opensAsk && ownFiles(ask).has(path)),
  });

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

const weakened = (facts: PushFacts): readonly Refusal[] =>
  scanMarkers(facts.addedLines, markersOf(facts.policy)).flatMap(
    ({ line, marker, path, reason }) =>
      Option.isNone(reason)
        ? [new Weakened({ at: { line, path }, weakening: { marker } })]
        : []
  );

const inLayers =
  (layerPaths: ReadonlySet<RepoPath>) =>
  (path: RepoPath): boolean => {
    const held: ReadonlySet<string> = layerPaths;
    const parts = path.split("/");

    return parts.some((_, end) => held.has(parts.slice(0, end + 1).join("/")));
  };

/**
 * The refusal is no oracle on which paths are a layer's: to a pusher who
 * cannot read the layers it names every path they added or modified; only a
 * reader hears which collide. `pusherCanRead` must hold for every layer in
 * `layerPaths`, so reading one layer never names another's paths.
 */
export const layerPathRefusal = (input: {
  readonly changes: readonly Pick<Change, "path" | "status">[];
  readonly layerPaths: ReadonlySet<RepoPath>;
  readonly pusherCanRead: boolean;
}): Option.Option<PrivatePathInPublicTree> => {
  const written = input.changes.flatMap((change) =>
    change.status === "deleted" ? [] : [change.path]
  );

  const colliding = written.filter(inLayers(input.layerPaths));

  return colliding.length === 0
    ? Option.none()
    : Option.map(
        someOf(input.pusherCanRead ? colliding : written),
        (paths) => new PrivatePathInPublicTree({ paths })
      );
};

const privatePaths = (facts: PushFacts): readonly Refusal[] =>
  Option.toArray(
    layerPathRefusal({
      changes: facts.changes,
      layerPaths: facts.layerPaths,
      pusherCanRead: facts.canReadLayers === true,
    })
  );

const SCRIPT = /\.[cm]?[jt]sx?$/u;

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

const unionOrder: readonly string[] =
  groups
    .find((group) => group.name === "Shape")
    ?.members.map((member) => member.identifier) ?? [];

const byUnionOrder = Order.combineAll<Refusal>([
  Order.mapInput(Order.Number, (refusal) => unionOrder.indexOf(refusal._tag)),
  Order.mapInput(Order.String, (refusal) => refusal.at?.path ?? ""),
  Order.mapInput(Order.Number, (refusal) => refusal.at?.line ?? 0),
]);

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
