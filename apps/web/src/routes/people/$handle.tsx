import { useAtomValue } from "@effect/atom-react";
import { Handle } from "@repo/protocol/ids";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { Effect, Option, Schema } from "effect";
import { AsyncResult } from "effect/reactivity";

import { creditsAtom } from "../../client/people.ts";
import {
  NoSuchPersonView,
  PersonView,
} from "../../features/people/person-page.tsx";
import { pageHead } from "../../features/shared/head.ts";
import { Reading, Unreachable } from "../../features/shared/pending.tsx";

// A person's page: the roles they hold in each project's landings, by area,
// read once by the browser. An address whose last part cannot be a handle
// is a 404.

const decodeHandle = Schema.decodeUnknownOption(Handle);

const Credits = ({ handle }: { readonly handle: Handle }) =>
  AsyncResult.matchWithError(useAtomValue(creditsAtom(handle)), {
    onDefect: () => <Unreachable title={handle} />,
    onError: () => <Unreachable title={handle} />,
    onInitial: () => <Reading title={handle} />,
    onSuccess: ({ value }) => (
      <PersonView credits={value.credits} handle={handle} />
    ),
  });

const PersonPage = () => {
  const { handle } = Route.useParams();

  return Option.match(decodeHandle(handle), {
    onNone: () => <NoSuchPersonView />,
    onSome: (person) => <Credits handle={person} />,
  });
};

export const Route = createFileRoute("/people/$handle")({
  component: PersonPage,
  head: ({ params }) =>
    pageHead({
      description: `What ${params.handle} is credited for, by project and area.`,
      title: params.handle,
    }),
  // A 404 for an address that names no handle.
  loader: ({ params }) =>
    Effect.runPromise(
      Effect.asVoid(
        Effect.mapError(Schema.decodeEffect(Handle)(params.handle), () =>
          notFound()
        )
      )
    ),
  notFoundComponent: NoSuchPersonView,
});
