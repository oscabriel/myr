import type {
  Layer,
  LayerKind,
  VisibilityPolicy,
} from "@repo/protocol/domain/visibility";
import type { Posture } from "@repo/protocol/posture";
import { Array, Option, Order } from "effect";

/**
 * Licences on the OSI's list that the platform knows by SPDX id, without
 * their `-only`, `-or-later` or `+` suffix. A licence off this list is read
 * as not OSI-approved: the label errs towards closed, never towards open.
 */
const OSI = new Set([
  "agpl-3.0",
  "apache-2.0",
  "bsd-2-clause",
  "bsd-3-clause",
  "gpl-2.0",
  "gpl-3.0",
  "isc",
  "lgpl-2.1",
  "lgpl-3.0",
  "mit",
  "mpl-2.0",
]);

const isOsi = (id: string) =>
  OSI.has(
    id
      .toLowerCase()
      .replace(/\+$/u, "")
      .replace(/-(?:only|or-later)$/u, "")
  );

// An open licence and the token after the expression read so far.
type Step = Option.Option<readonly [open: boolean, next: number]>;

const OPERATORS = new Set(["(", ")", "AND", "OR", "WITH"]);

/**
 * Whether an SPDX licence expression leaves the code open: a choice (`OR`)
 * is open when any side is, a conjunction (`AND`) when every side is, and
 * an exception (`WITH`) never closes a licence. An expression that does not
 * parse is not open.
 */
const isOpen = (expression: string): boolean => {
  const tokens = expression.match(/[()]|[^\s()]+/gu) ?? [];
  const word = (at: number) => tokens[at]?.toUpperCase() ?? ")";
  const isId = (at: number) => at < tokens.length && !OPERATORS.has(word(at));

  const joined =
    (
      operand: (at: number) => Step,
      operator: string,
      combine: (left: boolean, right: boolean) => boolean
    ) =>
    (at: number): Step => {
      let step = operand(at);

      while (Option.isSome(step) && word(step.value[1]) === operator) {
        const [left, next] = step.value;

        step = Option.map(
          operand(next + 1),
          ([right, after]) => [combine(left, right), after] as const
        );
      }

      return step;
    };

  // One licence: an id, maybe `WITH` an exception, or `inner` parenthesised.
  const atom =
    (inner: (at: number) => Step) =>
    (at: number): Step => {
      if (tokens[at] === "(") {
        return Option.filter(
          inner(at + 1),
          ([, next]) => tokens[next] === ")"
        ).pipe(Option.map(([open, next]) => [open, next + 1] as const));
      }

      if (!isId(at)) {
        return Option.none();
      }

      const open = isOsi(tokens[at] ?? "");

      if (word(at + 1) !== "WITH") {
        return Option.some([open, at + 1]);
      }

      return isId(at + 2) ? Option.some([open, at + 3]) : Option.none();
    };

  // Choices (`OR`) of conjunctions (`AND`) of licences, from `from`.
  const anyOf = (from: number): Step =>
    joined(
      joined(atom(anyOf), "AND", (left, right) => left && right),
      "OR",
      (left, right) => left || right
    )(from);

  return Option.exists(
    anyOf(0),
    ([open, next]) => open && next === tokens.length
  );
};

// Kinds whose files would ship: a layer holding one keeps shipped code closed.
const SHIPPED: ReadonlySet<LayerKind> = new Set(["fix", "source"]);

/**
 * A layer that narrows what the public sees: neither a personal layer, which
 * gates nothing, nor a public one, which everyone reads.
 */
const narrowing = (layer: Layer) =>
  layer.audience !== "personal" && layer.audience !== "public";

const ships = (layer: Layer) => layer.holds.some((kind) => SHIPPED.has(kind));

const sorted = (names: readonly string[]) =>
  Array.dedupe(Array.sort(names, Order.String)).join(", ");

const days = (count: number) => (count === 1 ? "1 day" : `${count} days`);

const labelled = (posture: Posture, label: string) => ({ label, posture });

/** The posture from the layers alone (OSR §2.6's first four rows). */
const fromLayers = (visibility: VisibilityPolicy) => {
  const layers = visibility.layers.filter(narrowing);
  const shipping = layers.filter(ships);

  // A layer of shipped files with no limit on its wait never promises to open.
  const closed = shipping.filter((layer) => layer.maxDays === undefined);
  const waits = shipping.flatMap((layer) => layer.maxDays ?? []);

  if (Array.isReadonlyArrayNonEmpty(closed)) {
    return labelled(
      "openCore",
      `Open core · closed: ${sorted(closed.map((layer) => layer.name))}`
    );
  }

  if (Array.isReadonlyArrayNonEmpty(waits)) {
    return labelled(
      "openOnSchedule",
      `Open on schedule · embargo ≤ ${days(Math.max(...waits))}`
    );
  }

  if (layers.length === 0) {
    return labelled("open", "Open");
  }

  const areas = Object.keys(visibility.checks?.areas ?? {});

  return labelled(
    "openWithSealedEvidence",
    areas.length === 0
      ? "Open with sealed evidence"
      : `Open with sealed evidence · sealed checks in ${sorted(areas)}`
  );
};

/**
 * A project's posture and the label it is shown as, computed from its
 * visibility config and its licence (OSR §2.6): Open; Open with sealed
 * evidence, naming the sealed areas; Open on schedule, naming the longest
 * embargo; Open core, naming the closed layers; Source available, under a
 * licence that is not OSI-approved, whatever the layers. `licence` is the
 * SPDX id or expression from the landed `LICENSE` or `package.json`; none
 * found leaves the layers to decide.
 */
export const postureOf = (input: {
  readonly visibility: Option.Option<VisibilityPolicy>;
  readonly licence: Option.Option<string>;
}): { readonly posture: Posture; readonly label: string } =>
  Option.exists(input.licence, (licence) => !isOpen(licence))
    ? labelled("sourceAvailable", "Source available")
    : Option.match(input.visibility, {
        onNone: () => labelled("open", "Open"),
        onSome: fromLayers,
      });

// OSR §2.6's table, from Open down.
const FURTHER_FROM_OPEN: readonly Posture[] = [
  "open",
  "openWithSealedEvidence",
  "openOnSchedule",
  "openCore",
  "sourceAvailable",
];

/**
 * Whether moving from one posture to another narrows what the public sees.
 * Narrowing is a `PostureChange` decision with a notice period; widening is
 * a release (OSR §2.6's ratchet).
 */
export const narrows = (from: Posture, to: Posture): boolean =>
  FURTHER_FROM_OPEN.indexOf(to) > FURTHER_FROM_OPEN.indexOf(from);
