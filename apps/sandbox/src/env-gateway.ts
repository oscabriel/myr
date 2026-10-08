/**
 * The env gateway: the outbound entrypoint each `@proxy` host's
 * HTTPS requests reach from the Checker's container
 * (`interceptOutboundHttps(host, EnvGateway)`, `checker/sdk.ts`), as in
 * Cloudflare's "call an authenticated API from a sandbox": the credential
 * stays on the Worker's side, and the entrypoint lets out only the requests
 * it allows.
 *
 * Its props are one job's rules and, for a job of landed code alone, the
 * values the platform opened for it (never in the container, and gone with
 * the job). A request that matches no rule, matches a `block` rule, is not
 * HTTPS, or matches two rules that would put two values in one placeholder,
 * is answered 403 and sent nowhere. One it allows goes on as the container
 * sent it, its headers' placeholders swapped for values where the gateway
 * holds them, with no header added; for an unlanded job it holds none, so
 * the placeholder goes on unchanged. The answer comes back with every value
 * the gateway holds scrubbed back to its placeholder, from the headers and
 * from an uncompressed text body (varlock's proxy does the same, VD proxy
 * l.145). A compressed or binary body comes back as it is.
 */
import type { EnvProxy } from "@repo/checks/check-runner";
import type { EnvKey } from "@repo/protocol/ids";
import { WorkerEntrypoint } from "cloudflare:workers";
import { Effect, Option, Order, Result, Stream } from "effect";

import { forward, refused, resent } from "./outbound.ts";

/** A value the gateway may swap in, with the placeholder the process sees for it. */
export interface EnvSwapProps {
  readonly key: EnvKey;
  readonly placeholder: string;
  readonly value: string;
}

/** One job's env route, as the gateway gets it: plain data, on the Worker's side. */
export interface EnvGatewayProps {
  readonly rules: readonly EnvProxy[];
  /** Empty unless the job runs landed code. */
  readonly values: readonly EnvSwapProps[];
}

const escaped = (text: string) =>
  text.replaceAll(/[.+?^${}()|[\]\\]/gu, String.raw`\$&`);

/** A host glob, as the container's intercept reads one: `*` is any run of characters. */
const hostMatches = (pattern: string, host: string) =>
  new RegExp(
    `^${escaped(pattern.toLowerCase()).replaceAll("*", ".*")}$`,
    "u"
  ).test(host.toLowerCase());

/** A path glob, as varlock reads one: `**` crosses segments, `*` stays in one. */
const pathMatches = (pattern: string, path: string) =>
  new RegExp(
    `^${escaped(pattern).replaceAll(/\*\*|\*/gu, (star) =>
      star === "**" ? ".*" : "[^/]*"
    )}$`,
    "u"
  ).test(path);

/** A rule's methods, written as one or a list (`GET, POST`); none allows any. */
const methodMatches = (methods: string, method: string) =>
  methods
    .split(",")
    .map((each) => each.trim().toUpperCase())
    .includes(method.toUpperCase());

const ruleMatches = (rule: EnvProxy, url: URL, method: string) =>
  hostMatches(rule.host, url.host) &&
  (rule.path === undefined || pathMatches(rule.path, url.pathname)) &&
  (rule.method === undefined || methodMatches(rule.method, method));

/**
 * Text and what replaces it: a placeholder and its value on the way out, a
 * value and its placeholder on the way back.
 */
type Swap = readonly [from: string, to: string];

/**
 * Whether `request` goes on, and with which swaps: the placeholder of each
 * rule it matches, for the value the gateway holds for that rule's key.
 * Refused, with the reason, when it is not HTTPS, matches no rule, matches
 * a `block` rule (which wins over any other), or matches two rules whose
 * one placeholder stands for two keys (the gateway would not know which
 * value goes).
 */
const swapsFor = (
  props: EnvGatewayProps,
  request: Request
): Result.Result<readonly Swap[], string> => {
  const url = new URL(request.url);

  if (url.protocol !== "https:") {
    return Result.fail("the env gateway sends HTTPS only");
  }

  const matching = props.rules.filter((rule) =>
    ruleMatches(rule, url, request.method)
  );

  if (matching.length === 0) {
    return Result.fail(
      `${url.host}: ${request.method} ${url.pathname} is outside this project's proxy rules`
    );
  }

  if (matching.some(({ block }) => block)) {
    return Result.fail(`${url.host}: blocked by this project's proxy rules`);
  }

  const ambiguous = matching.some((rule) =>
    matching.some(
      (other) =>
        other.placeholder === rule.placeholder && other.key !== rule.key
    )
  );

  if (ambiguous) {
    return Result.fail(
      `${url.host}: two proxy rules here share one placeholder`
    );
  }

  return Result.succeed(
    matching.flatMap(({ key, placeholder }) =>
      props.values.flatMap((each) =>
        each.key === key ? [[placeholder, each.value] as const] : []
      )
    )
  );
};

/** Longest `from` first, so a value that holds another is replaced whole. */
const longestFirst = Order.mapInput(
  Order.flip(Order.Number),
  ([from]: Swap) => from.length
);

/**
 * `text` with every `[from, to]` pair's `from` replaced by its `to`, the
 * longest first: a `DATABASE_URL` that holds a `DB_PASSWORD` goes whole,
 * not as the rest of the URL around the password's placeholder.
 */
const replaced = (text: string, pairs: readonly Swap[]) => {
  let done = text;

  for (const [from, to] of pairs.toSorted(longestFirst)) {
    done = done.replaceAll(from, to);
  }

  return done;
};

/** A copy of `headers` with each value's text replaced through `pairs`. */
const headersReplaced = (headers: Headers, pairs: readonly Swap[]) => {
  const copy = new Headers();

  for (const [name, value] of headers) {
    copy.append(name, replaced(value, pairs));
  }

  return copy;
};

/** The request that goes on: the container's, its headers swapped. */
const sent = (request: Request, swaps: readonly Swap[]) =>
  resent(request.url, request, headersReplaced(request.headers, swaps));

/** A body the gateway can read as text and scrub: text-like, and not compressed. */
const scrubbable = (headers: Headers) => {
  const type = headers.get("content-type")?.toLowerCase() ?? "";
  const encoding = headers.get("content-encoding")?.trim().toLowerCase() ?? "";

  return (
    (encoding === "" || encoding === "identity") &&
    (type.startsWith("text/") ||
      ["json", "xml", "javascript", "x-www-form-urlencoded", "graphql"].some(
        (kind) => type.includes(kind)
      ))
  );
};

/**
 * The length of the longest end of `text` that begins one of `values` but
 * is not all of it: held back until the next chunk says whether the value
 * completes there.
 */
const carried = (text: string, values: readonly string[]) =>
  Math.max(
    0,
    ...values.flatMap((value) =>
      Array.from(
        { length: Math.min(value.length - 1, text.length) },
        (_, at) => (text.endsWith(value.slice(0, at + 1)) ? at + 1 : 0)
      )
    )
  );

/**
 * A text body with every value replaced by its placeholder, chunk by
 * chunk, carrying across a chunk's end any text that may begin a value.
 */
const scrubbedBody = (
  body: ReadableStream<unknown>,
  scrubs: readonly Swap[]
) => {
  const values = scrubs.map(([value]) => value);

  return Stream.fromReadableStream({
    evaluate: () => body,
    onError: (cause) => cause,
  }).pipe(
    // The Workers types leave a body's chunk type open; a fetched body
    // holds bytes, so anything else breaks the answer's stream.
    Stream.mapEffect((chunk) =>
      chunk instanceof Uint8Array
        ? Effect.succeed(chunk)
        : Effect.die("an answer held something other than bytes")
    ),
    Stream.decodeText,
    Stream.mapAccum(
      () => "",
      (carry: string, chunk: string) => {
        const text = replaced(`${carry}${chunk}`, scrubs);
        const kept = carried(text, values);

        return [
          text.slice(text.length - kept),
          [text.slice(0, text.length - kept)],
        ] as const;
      },
      { onHalt: (carry) => [carry] }
    ),
    Stream.encodeText,
    Stream.toReadableStream()
  );
};

/**
 * The answer as the container gets it: every value the gateway holds
 * scrubbed back to its placeholder, in the headers and in a text body it
 * can read, of any length (streamed, so nothing is buffered whole). A
 * scrubbed body's length may change, so its `content-length` goes.
 */
const scrubbed = (response: Response, props: EnvGatewayProps): Response => {
  if (props.values.length === 0) {
    return response;
  }

  const scrubs = props.values.map(({ placeholder, value }): Swap => [
    value,
    placeholder,
  ]);

  const headers = headersReplaced(response.headers, scrubs);

  const readable = Option.fromNullishOr(response.body).pipe(
    Option.filter(() => scrubbable(response.headers))
  );

  if (Option.isSome(readable)) {
    headers.delete("content-length");
  }

  return new Response(
    Option.match(readable, {
      onNone: () => response.body,
      onSome: (body) => scrubbedBody(body, scrubs),
    }),
    { headers, status: response.status, statusText: response.statusText }
  );
};

/** What the gateway answers one request from the container with. */
const answer = (props: EnvGatewayProps, request: Request) =>
  Result.match(swapsFor(props, request), {
    onFailure: (reason) => Effect.succeed(refused(`${reason}\n`)),
    onSuccess: (swaps) =>
      Effect.map(
        Effect.promise(() => forward(sent(request, swaps))),
        (response) => scrubbed(response, props)
      ),
  });

/**
 * The env gateway: one job's `@proxy` hosts reach it, and its props say
 * what it lets out and what it swaps in.
 */
export class EnvGateway extends WorkerEntrypoint<Env, EnvGatewayProps> {
  override fetch(request: Request): Promise<Response> {
    return Effect.runPromise(answer(this.ctx.props, request));
  }
}
