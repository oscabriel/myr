/**
 * A project's address on the web (ADR 0032): `/<owner>/<name>/…`, and for
 * a project at its source path `/<host>/<account>/<name>/…`. One route tree
 * serves both, `routes/$owner/$project/**`:
 *
 * - `addressRewrite` carries a source path into that tree and back. On the
 *   way in `/github.com/pallets/click/…` reads as
 *   `/github.com%2Fpallets/click/…`, so `$owner` is `github.com/pallets`;
 *   on the way out every link the router prints is the real address again.
 * - `projectParams` gives the project's pages its full name as `project`
 *   (`oscabriel/datekit`), the name every read takes, and splits it again
 *   when the router prints a link.
 * - `canonicalAddress` answers, before any page, a key a project kept from
 *   before owners (`/datekit/…`), a name spelled in another case
 *   (`/OscaBriel/datekit/…`) and one ending in `.git` with a 301 to the name's address, the rest of
 *   the path and the query kept.
 */
import {
  ProjectName,
  projectAddressOf,
  reservedProjectNames,
  sourceHosts,
} from "@repo/protocol/ids";
import type { LocationRewrite } from "@tanstack/react-router";
import { Option, Schema } from "effect";

import { segmentsOf } from "../features/shared/paths.ts";

const isSourceHost = (segment: string) =>
  sourceHosts.some((host) => host === segment.toLowerCase());

const isReserved = (segment: string) =>
  reservedProjectNames.some((reserved) => reserved === segment.toLowerCase());

/** `/github.com/pallets/…` as the route tree reads it: the owner in one segment. */
const intoTree = (pathname: string) => {
  const [, host, account, ...rest] = pathname.split("/");

  return host !== undefined && account !== undefined && isSourceHost(host)
    ? ["", `${host}%2F${account}`, ...rest].join("/")
    : pathname;
};

/** The route tree's one-segment owner as the address spells it. */
const outOfTree = (pathname: string) => {
  const [, owner, ...rest] = pathname.split("/");
  const slash = owner?.toUpperCase().indexOf("%2F") ?? -1;

  return owner === undefined ||
    slash === -1 ||
    !isSourceHost(owner.slice(0, slash))
    ? pathname
    : ["", `${owner.slice(0, slash)}/${owner.slice(slash + 3)}`, ...rest].join(
        "/"
      );
};

/** The router's rewrite pair: a source path in, the real address out. */
export const addressRewrite: LocationRewrite = {
  input: ({ url }) => {
    url.pathname = intoTree(url.pathname);

    return url;
  },
  output: ({ url }) => {
    url.pathname = outOfTree(url.pathname);

    return url;
  },
};

/**
 * What the `$owner/$project` route reads from its two segments. Start runs
 * `parse` for a server handler too, so a handler reads the full name as
 * `project` (`test/server-params.test.ts`).
 */
interface ProjectParams {
  readonly owner: string;
  readonly project: string;
}

/**
 * The `$owner/$project` route's params: `project` is the full name its
 * pages read (`oscabriel/datekit`), and a link that names the full name
 * prints its owner and short name as two params.
 */
export const projectParams = {
  parse: ({ owner, project }: ProjectParams): ProjectParams => ({
    owner,
    project: `${owner}/${project}`,
  }),
  stringify: ({ owner, project }: ProjectParams): ProjectParams => {
    const slash = project.lastIndexOf("/");

    return slash === -1
      ? { owner, project }
      : { owner: project.slice(0, slash), project: project.slice(slash + 1) };
  },
};

const decodeName = Schema.decodeOption(ProjectName);

/**
 * A permanent redirect to `location`. It reads as nobody and changes only
 * when the forty are keyed again, so a browser and the edge keep it a day.
 */
const movedTo = (location: string) =>
  new Response(null, {
    headers: { "cache-control": "public, max-age=86400", location },
    status: 301,
  });

/**
 * A name as spelled without a trailing `.git` on its last segment: an
 * address copied from a clone URL (`/github.com/pallets/click.git`) names
 * the project.
 */
const withoutGit = (spelled: string) => spelled.replace(/\.git$/iu, "");

/**
 * The 301 a request needs to reach its project's address, if any: a key a
 * project kept from before owners (`/datekit/tree/main?x=1` to
 * `/oscabriel/datekit/tree/main?x=1`) and a name in another case
 * (`/OscaBriel/datekit` to `/oscabriel/datekit`), and a name with a
 * trailing `.git` (`/github.com/pallets/click.git` to
 * `/github.com/pallets/click`). None for the web's own
 * pages and files, for an address already canonical, and for a name no
 * project could have, which its page says is unknown.
 */
export const canonicalAddress = (request: Request): Option.Option<Response> => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return Option.none();
  }

  const url = new URL(request.url);
  const segments = segmentsOf(url.pathname);
  const [first] = segments;

  if (first === undefined || isReserved(first)) {
    return Option.none();
  }

  return Option.flatMap(projectAddressOf(segments), (address) =>
    Option.flatMap(decodeName(withoutGit(address.spelled)), (name) =>
      name === address.spelled
        ? Option.none()
        : Option.some(
            movedTo(
              [
                "",
                name,
                ...address.rest.map((segment) => encodeURIComponent(segment)),
              ].join("/") + url.search
            )
          )
    )
  );
};

/** A Worker's `fetch`, as TanStack Start's server entry gives it. */
interface Entry<Rest extends readonly unknown[]> {
  readonly fetch: (
    request: Request,
    ...rest: Rest
  ) => Promise<Response> | Response;
}

/** `entry`, answering first with the 301 a request's address needs. */
export const addressedEntry = <Rest extends readonly unknown[]>(
  entry: Entry<Rest>
): Entry<Rest> => ({
  fetch: (request, ...rest) =>
    Option.getOrElse(canonicalAddress(request), () =>
      entry.fetch(request, ...rest)
    ),
});
