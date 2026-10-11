/**
 * The import form's wiring, for the two pages that draw it (`/import` and
 * a source namespace's address nobody has made): who is signed in, read in
 * the browser; `importAtom`, sent only when Import is pressed; the move to
 * the project once it is made; and a refusal, drawn as the platform gave
 * it, under the form.
 */
import { useAtom, useAtomValue } from "@effect/atom-react";
import { ownerOf } from "@repo/protocol/ids";
import type { ProjectName } from "@repo/protocol/ids";
import { useLocation, useNavigate, useRouter } from "@tanstack/react-router";
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useState } from "react";

import { importAtom, importMade } from "../../client/import.ts";
import { hereOf } from "../auth/session-slot.tsx";
import { whoAtom } from "../auth/who.ts";
import { ProposalFailure } from "../proposal/failure.tsx";
import type { Importer } from "./import-form.tsx";

/**
 * Where an import that made `made` goes from a page at `at`: nowhere when
 * it is the project this address names (its page reads it again), else to
 * the project's page.
 */
export const afterImport = (made: ProjectName, at?: ProjectName) =>
  made === at
    ? Option.none()
    : Option.some({
        params: { owner: ownerOf(made), project: made },
        to: "/$owner/$project" as const,
      });

/**
 * Who is importing and what became of the last press. `at` is the project
 * this page's address names, if any: a project made there is read again
 * where it stands; any other is gone to.
 */
export const useImporter = (at?: ProjectName): Importer => {
  const navigate = useNavigate();
  const router = useRouter();
  const here = useLocation({ select: hereOf });
  const who = useAtomValue(whoAtom);
  const [imported, send] = useAtom(importAtom);
  // Set once this page sends: a project the atom still holds from an
  // earlier visit never moves the page.
  const [sent, setSent] = useState(false);
  const made = sent ? Option.getOrUndefined(importMade(imported)) : undefined;

  useEffect(() => {
    if (made === undefined) {
      return;
    }

    Option.match(afterImport(made, at), {
      // The loader read this address as no project: it reads it again.
      onNone: () => {
        void router.invalidate();
      },
      onSome: (to) => {
        void navigate(to);
      },
    });
  }, [at, made, navigate, router]);

  return {
    busy: imported.waiting,
    checking: !AsyncResult.isSuccess(who),
    handle: AsyncResult.isSuccess(who) ? who.value : Option.none(),
    onImport: (payload) => {
      setSent(true);
      send(payload);
    },
    refusal: AsyncResult.isFailure(imported) ? (
      <div aria-live="polite">
        <ProposalFailure cause={imported.cause} doing="import it" here={here} />
      </div>
    ) : undefined,
  };
};
