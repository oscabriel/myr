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
import { CallFailure } from "../shared/call-failure.tsx";
import type { Importer } from "./import-form.tsx";

export const afterImport = (made: ProjectName, at?: ProjectName) =>
  made === at
    ? Option.none()
    : Option.some({
        params: { owner: ownerOf(made), project: made },
        to: "/$owner/$project" as const,
      });

export const useImporter = (at?: ProjectName): Importer => {
  const navigate = useNavigate();
  const router = useRouter();
  const here = useLocation({ select: hereOf });
  const who = useAtomValue(whoAtom);
  const [imported, send] = useAtom(importAtom);
  const [sent, setSent] = useState(false);
  const made = sent ? Option.getOrUndefined(importMade(imported)) : undefined;

  useEffect(() => {
    if (made === undefined) {
      return;
    }

    Option.match(afterImport(made, at), {
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
        <CallFailure cause={imported.cause} doing="import it" here={here} />
      </div>
    ) : undefined,
  };
};
