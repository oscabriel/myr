import { useAtomValue } from "@effect/atom-react";
import { Handle } from "@repo/protocol/ids";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { Effect, Option, Schema } from "effect";
import { AsyncResult } from "effect/reactivity";

import { creditsAtom } from "../../client/people.ts";
import { Reading, Unreachable } from "../../features/front/reading.tsx";
import {
  NoSuchPersonView,
  PersonView,
} from "../../features/people/person-page.tsx";
import { pageTitle } from "../../features/shared/layout.tsx";

// A person's page: their credit by project, area and role, read once by the
// browser. An address whose last part cannot be a handle is a 404.

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
  head: ({ params }) => ({ meta: [{ title: pageTitle(params.handle) }] }),
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
