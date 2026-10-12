/**
 * A server route (sign-in, a raw file, a `.md` twin, `llms.txt`) is a plain
 * `<a>`, or the router would look for a page that is not there.
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

export interface AppLinkProps extends Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "href" | "target"
> {
  readonly to: string;
  readonly search?: Readonly<Record<string, string>> | undefined;
  readonly hash?: string;
  readonly activeOptions?: ActiveOptions;
  readonly preload?: false;
  readonly replace?: boolean;
  readonly resetScroll?: boolean;
}

/**
 * `$` and the braces of an optional segment are, in a path built whole, part of
 * a name (`routes/$project/$.tsx`), never a param for the router to fill.
 * Escaped, they reach the address as written.
 */
export const literalPath = (path: string): string =>
  path.replaceAll("$", "%24").replaceAll("{", "%7B").replaceAll("}", "%7D");

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

const PathLink = Link<AnyRouter, string, string>;

export const AppLink = (props: AppLinkProps): ReactNode => {
  const router = useRouter({ warn: false });

  if (Predicate.isNotNullish(router)) {
    return <PathLink {...props} to={literalPath(props.to)} />;
  }

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
