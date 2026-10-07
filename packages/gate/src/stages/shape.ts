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
  OutOfScope,
  PrivatePathInPublicTree,
  ReachedInternals,
  TouchedJudge,
  Weakened,
} from "@repo/protocol/refusal";
import type { Refusal } from "@repo/protocol/refusal";
import { Array, Effect, Option, Order } from "effect";

import type { PushFacts } from "../facts.ts";
import { matchAny } from "../glob.ts";
import { findMarkers, markersOf } from "../markers.ts";
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

/** Every marker added with no reason; a reasoned one is the ratchet stage's. */
const weakened = (facts: PushFacts): readonly Refusal[] =>
  findMarkers(markersOf(facts.policy), facts.addedLines).flatMap((hit) =>
    Option.isNone(hit.reason)
      ? [new Weakened({ at: hit.at, weakening: { marker: hit.marker } })]
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

// A module specifier on an import or re-export line: `from "…"` (also the
// last line of a multi-line import), a bare `import "…"`, or `import("…")`.
const SPECIFIERS = [
  /^\s*(?:import|export|\})\b.*?\bfrom\s*["'](?<specifier>[^"']+)["']/u,
  /^\s*import\s*["'](?<specifier>[^"']+)["']/u,
  /\bimport\s*\(\s*["'](?<specifier>[^"']+)["']\s*\)/u,
];

const specifierIn = (text: string) =>
  Array.findFirst(SPECIFIERS, (pattern) =>
    Option.fromNullishOr(pattern.exec(text)?.groups?.specifier)
  );

/** `from`'s folder joined with a relative specifier, `.` and `..` resolved. */
const resolve = (from: string, specifier: string) => {
  const parts = from.split("/").slice(0, -1);

  for (const part of specifier.split("/")) {
    if (part === "..") {
      parts.pop();
    } else if (part !== "." && part !== "") {
      parts.push(part);
    }
  }

  return parts.join("/");
};

/** A module file's path with its extension and a trailing `/index` dropped. */
const bare = (path: string) =>
  path.replace(/\.[cm]?[jt]sx?$/u, "").replace(/\/index$/u, "");

/**
 * Whether `target` is a file of a module other than `own` that the module
 * does not export. A module that lists no public files is not judged.
 */
const isInternal = (facts: PushFacts, own: string, target: string) =>
  facts.policy.modules.some(
    (module) =>
      module.module !== own &&
      module.publicFiles !== undefined &&
      matchAny(module.paths, target) &&
      !module.publicFiles.some((file) => bare(file) === bare(target))
  );

/**
 * Imports the answer adds, inside its territory, of another module's file
 * that the module does not export. W2's rule reads relative specifiers only.
 */
const reachedInternals = (facts: PushFacts): readonly Refusal[] =>
  Option.match(facts.ask, {
    onNone: () => [],
    onSome: ({ territory }) =>
      [...facts.addedLines]
        .toSorted(([one], [other]) => Order.String(one, other))
        .filter(([path]) => matchAny(territory.paths, path))
        .flatMap(([from, lines]) =>
          lines.flatMap(({ line, text }) =>
            Option.match(specifierIn(text), {
              onNone: () => [],
              onSome: (to) =>
                to.startsWith(".") &&
                isInternal(facts, territory.module, resolve(from, to))
                  ? [
                      new ReachedInternals({
                        at: { line, path: from },
                        from,
                        to,
                      }),
                    ]
                  : [],
            })
          )
        ),
  });

/** Stage 1: every problem the push's changes have, in the union's Shape order. */
export const scan: Stage<never> = {
  accumulate: true,
  name: "shape",
  run: (facts) =>
    Effect.succeed([
      ...outOfScope(facts),
      ...touchedJudge(facts),
      ...weakened(facts),
      ...privatePaths(facts),
      ...reachedInternals(facts),
    ]),
};
