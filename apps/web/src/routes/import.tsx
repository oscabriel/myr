import { useAtom, useAtomValue } from "@effect/atom-react";
import { ownerOf } from "@repo/protocol/ids";
import {
  createFileRoute,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { Option, Predicate } from "effect";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useState } from "react";

import { importAtom, importMade } from "../client/import.ts";
import { hereOf } from "../features/auth/session-slot.tsx";
import { whoAtom } from "../features/auth/who.ts";
import { ImportView } from "../features/import/import-page.tsx";
import { ProposalFailure } from "../features/proposal/failure.tsx";
import { pageHead } from "../features/shared/head.ts";
import { personalPage } from "../server/cache-headers.ts";

// `/import`: import a public repo as a project. Who is signed in is read
// in the browser (the server paints the page while it checks); an import
// made goes to the project's page, a refusal shows under the form.
// `?url=<https URL>` fills the form; nothing is imported until Import is
// pressed. A page about its reader, kept by no cache.

/** A page about its reader, kept by no cache. */
export const importHeaders = () => personalPage;

const ImportPage = () => {
  const navigate = useNavigate();
  const { url } = Route.useSearch();
  const here = useLocation({ select: hereOf });
  const who = useAtomValue(whoAtom);
  const [imported, send] = useAtom(importAtom);
  // Set once this form sends: a project the atom still holds from an
  // earlier visit never moves the page.
  const [sent, setSent] = useState(false);
  const made = sent ? Option.getOrUndefined(importMade(imported)) : undefined;

  useEffect(() => {
    if (made !== undefined) {
      void navigate({
        params: { owner: ownerOf(made), project: made },
        to: "/$owner/$project",
      });
    }
  }, [made, navigate]);

  return (
    <ImportView
      busy={imported.waiting}
      checking={!AsyncResult.isSuccess(who)}
      handle={AsyncResult.isSuccess(who) ? who.value : Option.none()}
      here={here}
      onImport={(payload) => {
        setSent(true);
        send(payload);
      }}
      url={url}
    >
      {AsyncResult.isFailure(imported) ? (
        <div aria-live="polite">
          <ProposalFailure
            cause={imported.cause}
            doing="import it"
            here={here}
          />
        </div>
      ) : null}
    </ImportView>
  );
};

/** The address's search: the URL to fill the form with, when it is text. */
export const importSearch = ({
  url,
}: {
  readonly url?: unknown;
}): { readonly url?: string } => (Predicate.isString(url) ? { url } : {});

export const Route = createFileRoute("/import")({
  validateSearch: importSearch,
  headers: importHeaders,
  head: () => pageHead({ title: "Import a repo" }),
  component: ImportPage,
});
