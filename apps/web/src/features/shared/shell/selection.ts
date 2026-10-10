/**
 * A list's selected row, kept in the address's search (`?ask=format-ordinal`,
 * `?decision=dec-000001`), so the server renders the row selected with its
 * facts in the inspector, and a link to them can be shared. Selecting
 * replaces the history entry and keeps every pane's scroll; `Escape` clears
 * it (`useEscapeClears`).
 *
 * A route whose list selects keeps the param out of its loader: `loaderDeps`
 * leaves it out, so a selection never reads the list again, and
 * `shouldReload: reloadOnEnter` keeps a list from reading again on every
 * selection once it is stale.
 *
 * ```tsx
 * const { selected, select } = useSelection("ask");
 * const { focused } = useListKeys(ids, select);
 * <Workspace facts={selected === undefined ? <ProjectFacts /> : <AskFacts ask={selected} />} factsKey={selected} … />
 * ```
 */
import {
  defaultStringifySearch,
  useLocation,
  useRouter,
} from "@tanstack/react-router";
import { Effect, Option, Schema } from "effect";
import { useCallback } from "react";

import { useEscapeClears } from "../keys.tsx";

/** The search params a list selects by. */
export type SelectionParam = "ask" | "decision";

/** A selection as an address's search carries it. */
const Selection = Schema.Struct({
  ask: Schema.optionalKey(Schema.String),
  decision: Schema.optionalKey(Schema.String),
});

const decodeSelection = Schema.decodeUnknownOption(Selection);

/**
 * `searchStr` (`?filter=…&ask=…`) with `param` set to `id`, or without it,
 * each value written as the router writes it.
 */
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

/**
 * A route's `shouldReload` for a list that selects: read the list when the
 * reader comes to it (or a link to it is preloaded), not again on each
 * selection; its atoms keep it live.
 */
export const reloadOnEnter = ({ cause }: { readonly cause: string }) =>
  cause !== "stay";
