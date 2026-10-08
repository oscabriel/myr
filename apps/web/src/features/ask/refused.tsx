/**
 * The page for an address that names no ask, or no answer: a 404 whose body
 * is the refusal the platform gave (`UnknownProject`, `UnknownAsk`), as
 * `git push` printed it, so a person reads what an agent reads in Markdown.
 * The refusals travel from the server in a not-found's data, encoded as
 * `Refusals`; the route decodes them (AGENTS.md principle 2).
 */
import { Refusal } from "@repo/protocol/refusal";
import { notFound } from "@tanstack/react-router";
import { Effect, Schema } from "effect";
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

export const NotFoundView = ({
  refusals,
  title,
}: {
  readonly refusals: Array.NonEmptyReadonlyArray<Refusal> | undefined;
  readonly title: string;
}) => (
  <PageShell title={title}>
    {refusals === undefined ? (
      <EmptyState title="Nothing is at this address: a project's and an ask's names are lowercase words joined by single dashes." />
    ) : (
      <RefusalView refusals={refusals} />
    )}
  </PageShell>
);
