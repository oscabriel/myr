// A project at its source path is carried into the one route tree by `addressRewrite`: `/github.com/pallets/click/…`
// reads as `/github.com%2Fpallets/click/…`, so `$owner` is `github.com/pallets`, and every printed link is the real address.
import {
  ProjectName,
  projectAddressOf,
  reservedProjectNames,
  sourceHosts,
} from "@repo/protocol/ids";
import type { LocationRewrite } from "@tanstack/react-router";
import { Option, Schema } from "effect";

import {
  INBOX_PATH,
  MOVED_TO_POLICY,
  MOVED_TO_VISIBILITY,
  policyHref,
  segmentsOf,
  visibilityHref,
} from "../features/shared/paths.ts";
import { KEPT_NOWHERE } from "./edge-cache.ts";

const isSourceHost = (segment: string) =>
  sourceHosts.some((host) => host === segment.toLowerCase());

const isReserved = (segment: string) =>
  reservedProjectNames.some((reserved) => reserved === segment.toLowerCase());

const intoTree = (pathname: string) => {
  const [, host, account, ...rest] = pathname.split("/");

  return host !== undefined && account !== undefined && isSourceHost(host)
    ? ["", `${host}%2F${account}`, ...rest].join("/")
    : pathname;
};

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

// Start runs `parse` for a server handler too, so a handler reads the full name as `project`.
interface ProjectParams {
  readonly owner: string;
  readonly project: string;
}

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

// It reads as nobody and changes only when the projects are keyed again, so a browser and the edge keep it a day.
const movedTo = (location: string) =>
  new Response(null, {
    headers: { "cache-control": "public, max-age=86400", location },
    status: 301,
  });

const withoutGit = (spelled: string) => spelled.replace(/\.git$/iu, "");

// The web answers at its bare host only: a `www.` host is the same page there, and a write keeps its method with a 308.
// Workers Cache keys by path alone, so the edge must never keep this answer: kept, it would send the bare host to itself.
const bareHost = (url: URL, isRead: boolean): Option.Option<Response> => {
  if (!url.hostname.startsWith("www.")) {
    return Option.none();
  }

  const bare = new URL(url);
  bare.hostname = url.hostname.slice("www.".length);

  return Option.some(
    new Response(null, {
      headers: { "cache-control": KEPT_NOWHERE, location: bare.href },
      status: isRead ? 301 : 308,
    })
  );
};

// Pages the web served once and folded into another (ADR 0041). The query goes along as it was spelled, so a filter holds.
const MOVED_PAGES: ReadonlyMap<string, string> = new Map([
  ["home", INBOX_PATH],
  ["today", INBOX_PATH],
]);

const movedPage = (
  segments: readonly string[],
  search: string
): Option.Option<Response> => {
  const [first, ...rest] = segments;

  return rest.length > 0 || first === undefined
    ? Option.none()
    : Option.map(Option.fromUndefinedOr(MOVED_PAGES.get(first)), (to) =>
        movedTo(to + search)
      );
};

// A project's old ledger and env pages folded into its Visibility tab (ADR 0041), and its old `/people` is its policy
// page: one move from an old or miscased name too.
const movedProjectHref = (
  name: string,
  page: string,
  search: string
): Option.Option<string> =>
  page === MOVED_TO_POLICY
    ? Option.some(policyHref(name, search))
    : Option.map(
        Option.fromUndefinedOr(MOVED_TO_VISIBILITY.get(page)),
        (anchor) => visibilityHref(name, anchor, search)
      );

const movedProjectPage = (
  name: string,
  rest: readonly string[],
  search: string
): Option.Option<Response> => {
  const [page, ...below] = rest;

  return page === undefined || below.length > 0
    ? Option.none()
    : Option.map(movedProjectHref(name, page, search), movedTo);
};

export const canonicalAddress = (request: Request): Option.Option<Response> => {
  const url = new URL(request.url);
  const isRead = request.method === "GET" || request.method === "HEAD";
  const onBareHost = bareHost(url, isRead);

  if (Option.isSome(onBareHost) || !isRead) {
    return onBareHost;
  }

  const segments = segmentsOf(url.pathname);
  const [first] = segments;
  const moved = movedPage(segments, url.search);

  if (Option.isSome(moved) || first === undefined || isReserved(first)) {
    return moved;
  }

  return Option.flatMap(projectAddressOf(segments), (address) =>
    Option.flatMap(decodeName(withoutGit(address.spelled)), (name) =>
      Option.orElse(movedProjectPage(name, address.rest, url.search), () =>
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
    )
  );
};

interface Entry<Rest extends readonly unknown[]> {
  readonly fetch: (
    request: Request,
    ...rest: Rest
  ) => Promise<Response> | Response;
}

export const addressedEntry = <Rest extends readonly unknown[]>(
  entry: Entry<Rest>
): Entry<Rest> => ({
  fetch: (request, ...rest) =>
    Option.getOrElse(canonicalAddress(request), () =>
      entry.fetch(request, ...rest)
    ),
});
