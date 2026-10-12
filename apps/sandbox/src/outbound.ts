// The Checker container's only ways out: the outbound handler is the
// credential boundary, and the container never sees a gateway's props.
import { WorkerEntrypoint } from "cloudflare:workers";
import { Option } from "effect";

import { allows, CLONE_HOST } from "./checker/network.ts";

export interface CloneProps {
  readonly remote: string;
  readonly token: string;
}

export interface EgressProps {
  readonly allow: readonly string[];
}

export const refused = (text: string) =>
  new Response(text, {
    headers: { "content-type": "text/plain; charset=utf-8" },
    status: 403,
  });

/** Redirects go back to the container, so a followed one passes a gateway too. */
export const forward = (request: Request): Promise<Response> =>
  // @effect-diagnostics-next-line globalFetch:off -- an outbound entrypoint is the Worker's own network edge: workerd hands it a Request and takes back a Response, and its only way to the internet is the runtime's fetch; sandbox code may not use effect/http.
  fetch(request, { redirect: "manual" });

export const resent = (url: string, request: Request, headers: Headers) => {
  // Node sends a streamed body only with `duplex: "half"`; the Workers types
  // lack the key, and workerd ignores it.
  const init = {
    body: request.body,
    duplex: "half",
    headers,
    method: request.method,
  };

  return new Request(url, init);
};

/** Only `git-upload-pack` reads of the job's repo pass; a push or any other query does not. */
const cloneRequestFor = (
  request: Request,
  props: CloneProps
): Option.Option<Request> => {
  const url = new URL(request.url);
  const remote = new URL(props.remote);
  const repo = remote.pathname.replace(/\/$/u, "");

  const reads =
    (request.method === "GET" &&
      url.pathname === `${repo}/info/refs` &&
      url.search === "?service=git-upload-pack") ||
    (request.method === "POST" &&
      url.pathname === `${repo}/git-upload-pack` &&
      url.search === "");

  if (url.hostname !== CLONE_HOST || !reads) {
    return Option.none();
  }

  const headers = new Headers(request.headers);

  headers.set("authorization", `Bearer ${props.token}`);

  return Option.some(
    resent(`${remote.origin}${url.pathname}${url.search}`, request, headers)
  );
};

/** The container clones with no credential; the token is added here, on the Worker's side. */
export class CloneGateway extends WorkerEntrypoint<Env, CloneProps> {
  override fetch(request: Request): Promise<Response> {
    return Option.match(cloneRequestFor(request, this.ctx.props), {
      onNone: () =>
        Promise.resolve(
          refused("the clone route serves reads of this job's repo only\n")
        ),
      onSome: forward,
    });
  }
}

export class EgressGateway extends WorkerEntrypoint<Env, EgressProps> {
  override fetch(request: Request): Promise<Response> {
    const { hostname } = new URL(request.url);

    return allows(this.ctx.props.allow, hostname)
      ? forward(request)
      : Promise.resolve(
          refused(
            `egress refused: ${hostname} is not on this check's allow-list\n`
          )
        );
  }
}
