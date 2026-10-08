/**
 * The Checker container's only ways out, as outbound entrypoints of this Worker
 * (the outbound handler is the credential boundary). The container starts with
 * the internet off; its Durable Object routes the clone's host to
 * `CloneGateway` and every other host to `EgressGateway` (`checker/sdk.ts`),
 * each told what it may do through its props, which the container never sees.
 *
 * Both are reached through `ctx.exports`, which holds one loopback per export
 * of the Worker's main module, so `worker.ts` must export them.
 */
import { WorkerEntrypoint } from "cloudflare:workers";
import { Option } from "effect";

import { allows, CLONE_HOST } from "./checker/network.ts";

/** One job's remote and the read token the platform minted for it alone. */
export interface CloneProps {
  readonly remote: string;
  readonly token: string;
}

/** The hosts the container may reach right now; `[]` is none. */
export interface EgressProps {
  readonly allow: readonly string[];
}

/** A 403 whose plain-text body says why; `text` ends with its own newline. */
export const refused = (text: string) =>
  new Response(text, {
    headers: { "content-type": "text/plain; charset=utf-8" },
    status: 403,
  });

/**
 * Sends a request on to the internet. Redirects come back to the container,
 * so the request that follows one goes through a gateway too.
 */
export const forward = (request: Request): Promise<Response> =>
  // @effect-diagnostics-next-line globalFetch:off -- an outbound entrypoint is the Worker's own network edge: workerd hands it a Request and takes back a Response, and its only way to the internet is the runtime's fetch; sandbox code may not use effect/http.
  fetch(request, { redirect: "manual" });

/**
 * `request` as a new request to `url` with `headers`: its method, and its
 * body streamed through as it comes.
 */
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

/**
 * The request the clone gateway sends for one from the container: a read of
 * the job's repo (`git-upload-pack`, as a clone or fetch makes) at the clone
 * host, exactly as git asks for one, sent to the remote with the token
 * added. Anything else, a push or a query git never sends included, is none.
 */
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

/**
 * The clone's way out: the container clones the job's repo from the clone
 * host with no credential, and this entrypoint sends each read on to the
 * repo's real remote with `Authorization: Bearer <token>` (as the Artifacts
 * probes sent it, and as it works live). The token lives
 * in its props, on the Worker's side.
 */
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

/**
 * Every other way out: a request to a host its props allow goes on as it
 * is, and any other is refused with a 403 that names the host, so a setup
 * that fails on one says which.
 */
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
