/**
 * A route whose list selects leaves the param out of `loaderDeps`, so a
 * selection never reads the list again.
 */
import {
  defaultStringifySearch,
  useLocation,
  useRouter,
} from "@tanstack/react-router";
import { Effect, Option, Schema } from "effect";
import { useCallback } from "react";

import { useEscapeClears } from "../keys.tsx";

export type SelectionParam = "ask" | "decision";

const Selection = Schema.Struct({
  ask: Schema.optionalKey(Schema.String),
  decision: Schema.optionalKey(Schema.String),
});

const decodeSelection = Schema.decodeUnknownOption(Selection);

export const searchWith = (
  searchStr: string,
  param: SelectionParam,
  id?: string
): string => {
  const params = new URLSearchParams(searchStr);

  params.delete(param);

  if (id !== undefined) {
    params.set(
      param,
      new URLSearchParams(defaultStringifySearch({ [param]: id })).get(param) ??
        id
    );
  }

  const next = params.toString();

  return next === "" ? "" : `?${next}`;
};

export const useSelection = (param: SelectionParam) => {
  const router = useRouter();
  const { pathname, search, searchStr } = useLocation();

  const selected = Option.getOrUndefined(
    Option.flatMapNullishOr(decodeSelection(search), (read) => read[param])
  );

  const move = useCallback(
    (id?: string) => {
      Effect.runFork(
        Effect.tryPromise(() =>
          router.navigate({
            href: `${pathname}${searchWith(searchStr, param, id)}`,
            replace: true,
            resetScroll: false,
          })
        ).pipe(Effect.ignore)
      );
    },
    [param, pathname, router, searchStr]
  );

  const select = useCallback(
    (id: string) => {
      move(id);
    },
    [move]
  );

  const clear = useCallback(() => {
    move();
  }, [move]);

  useEscapeClears(clear);

  return { clear, select, selected };
};

export const reloadOnEnter = ({ cause }: { readonly cause: string }) =>
  cause !== "stay";
