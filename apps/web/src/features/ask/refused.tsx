/**
 * The page for an address that names no ask, or no answer: a 404 whose body
 * is the refusal the platform gave (`UnknownProject`, `UnknownAsk`), as
 * `git push` printed it, so a person reads what an agent reads in Markdown.
 * The refusals travel from the server in a not-found's data, encoded as
 * `Refusals`; `NoSuchAsk` decodes them where they arrive (AGENTS.md
 * principle 2).
 */
import { Refusal } from "@repo/protocol/refusal";
import { notFound } from "@tanstack/react-router";
import { Effect, Option, Schema } from "effect";
import type { Array } from "effect";

import { EmptyState } from "../shared/empty.tsx";
import { PageShell } from "../shared/layout.tsx";
import { RefusalView } from "../shared/refusal.tsx";

/** Refusals as a not-found carries them. */
export const Refusals = Schema.NonEmptyArray(Refusal);

/** A loader's 404 for `refusal`: a not-found that carries it, encoded, to the page. */
export const notFoundFor = (refusal: Refusal) =>
  Effect.flatMap(Schema.encodeEffect(Refusals)([refusal]), (data) =>
    Effect.fail(notFound({ data }))
  );

/** What a 404 says when the address could name no ask, so no refusal came back. */
export const NAMES_ONLY =
  "Nothing is at this address: a project's and an ask's names are lowercase words joined by single dashes.";

export const NotFoundView = ({
  nothing = NAMES_ONLY,
  refusals,
  title,
}: {
  readonly nothing?: string;
  readonly refusals: Array.NonEmptyReadonlyArray<Refusal> | undefined;
  readonly title: string;
}) => (
  <PageShell title={title}>
    {refusals === undefined ? (
      <EmptyState title={nothing} />
    ) : (
      <RefusalView refusals={refusals} />
    )}
  </PageShell>
);

const decodeRefusals = Schema.decodeUnknownOption(Refusals);

/**
 * A route's not-found page: the refusals its loader's not-found carried,
 * decoded; `nothing` when it carried none (the address could name no ask).
 */
export const NoSuchAsk = ({
  data,
  nothing = NAMES_ONLY,
}: {
  readonly data?: unknown;
  readonly nothing?: string;
}) => (
  <NotFoundView
    nothing={nothing}
    refusals={Option.getOrUndefined(decodeRefusals(data))}
    title="No such ask"
  />
);
