/**
 * The one link between the web's pages: the router's `Link`, so a click
 * moves without reloading the document, and a hover or focus fetches the
 * page's code and loader data first (the router's `defaultPreload` is
 * "intent", `src/router.tsx`). The router marks the link to the page being
 * read with `aria-current="page"` and `data-status="active"`.
 *
 * `to` is a path built whole, as `paths.ts` builds them (`askPath(project,
 * ask)`), with its search as `search`; the router reads its params from it
 * as it reads them from a typed address.
 *
 * A view rendered with no router around it (its own test, with
 * `renderToStaticMarkup`) draws the same address as a plain anchor, so its
 * markup reads the same either way; the shell's own test renders inside a
 * router (`test/render.tsx`) and checks its links are the router's.
 *
 * Only pages the router serves take an `AppLink`. A server route (sign-in,
 * a raw file, a `.md` twin, `llms.txt`) is a plain `<a>`, or the router would
 * look for a page that is not there.
 */
import {
  defaultStringifySearch,
  Link,
  useRouter,
} from "@tanstack/react-router";
import type { ActiveOptions, AnyRouter } from "@tanstack/react-router";
import { Predicate } from "effect";
import { createElement } from "react";
import type { AnchorHTMLAttributes, ReactNode } from "react";

/** An `AppLink`'s props: an anchor's, with the address as `to`. */
export interface AppLinkProps extends Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "href" | "target"
> {
  /** The path, built whole: `/datekit/ledger`. */
  readonly to: string;
  /** The address's search, each value a string. */
  readonly search?: Readonly<Record<string, string>>;
  /** The fragment, without its `#`. */
  readonly hash?: string;
  /** How the router decides the link leads to the page being read. */
  readonly activeOptions?: ActiveOptions;
  /** `false` keeps the router from fetching the page ahead of a click. */
  readonly preload?: false;
  /** Replace the history entry rather than push one (a selection). */
  readonly replace?: boolean;
  /** Keep each pane's scroll where it is (a selection in a list). */
  readonly resetScroll?: boolean;
}

/**
 * `path` with the router's own marks escaped: a `$` (a param, or the splat)
 * and the braces of an optional segment are, in a path built whole, part of
 * a name (a file at `routes/$project/$.tsx`), never a param for the router
 * to fill from the page being read. Escaped, they reach the address as
 * written, and the router decodes them back when it reads the page's params.
 */
export const literalPath = (path: string): string =>
  path.replaceAll("$", "%24").replaceAll("{", "%7B").replaceAll("}", "%7D");

/** The address an `AppLink` names, as the router would write it. */
export const hrefOf = ({
  hash,
  search,
  to,
}: Pick<AppLinkProps, "hash" | "search" | "to">): string =>
  `${literalPath(to)}${
    search === undefined || Object.keys(search).length === 0
      ? ""
      : defaultStringifySearch(search)
  }${hash === undefined ? "" : `#${hash}`}`;

/**
 * `Link` over any router, whose `to` is any path: the router reads a path
 * built whole as it reads a typed address.
 */
const PathLink = Link<AnyRouter, string, string>;

export const AppLink = (props: AppLinkProps): ReactNode => {
  const router = useRouter({ warn: false });

  if (Predicate.isNotNullish(router)) {
    return <PathLink {...props} to={literalPath(props.to)} />;
  }

  // A router is always there in the app; only a view rendered alone has none.
  const {
    activeOptions: _active,
    hash: _hash,
    preload: _preload,
    replace: _replace,
    resetScroll: _reset,
    search: _search,
    to: _to,
    ...anchor
  } = props;

  return createElement("a", { ...anchor, href: hrefOf(props) });
};
