// Values stay on the Worker's side: placeholders are swapped in on the way
// out, and values scrubbed back to placeholders on the way in (headers and
// uncompressed text bodies only, as varlock's proxy does).
import type { EnvProxy } from "@repo/checks/check-runner";
import type { EnvKey } from "@repo/protocol/ids";
import { WorkerEntrypoint } from "cloudflare:workers";
import { Effect, Option, Order, Result, Stream } from "effect";

import { forward, refused, resent } from "./outbound.ts";

export interface EnvSwapProps {
  readonly key: EnvKey;
  readonly placeholder: string;
  readonly value: string;
}

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

const methodMatches = (methods: string, method: string) =>
  methods
    .split(",")
    .map((each) => each.trim().toUpperCase())
    .includes(method.toUpperCase());

const ruleMatches = (rule: EnvProxy, url: URL, method: string) =>
  hostMatches(rule.host, url.host) &&
  (rule.path === undefined || pathMatches(rule.path, url.pathname)) &&
  (rule.method === undefined || methodMatches(rule.method, method));

type Swap = readonly [from: string, to: string];

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

const replaced = (text: string, pairs: readonly Swap[]) => {
  let done = text;

  for (const [from, to] of pairs.toSorted(longestFirst)) {
    done = done.replaceAll(from, to);
  }

  return done;
};

const headersReplaced = (headers: Headers, pairs: readonly Swap[]) => {
  const copy = new Headers();

  for (const [name, value] of headers) {
    copy.append(name, replaced(value, pairs));
  }

  return copy;
};

const sent = (request: Request, swaps: readonly Swap[]) =>
  resent(request.url, request, headersReplaced(request.headers, swaps));

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

/** How much of `text`'s end may begin a value: held back for the next chunk. */
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

/** A scrubbed body's length may change, so its `content-length` goes. */
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

const answer = (props: EnvGatewayProps, request: Request) =>
  Result.match(swapsFor(props, request), {
    onFailure: (reason) => Effect.succeed(refused(`${reason}\n`)),
    onSuccess: (swaps) =>
      Effect.map(
        Effect.promise(() => forward(sent(request, swaps))),
        (response) => scrubbed(response, props)
      ),
  });

export class EnvGateway extends WorkerEntrypoint<Env, EnvGatewayProps> {
  override fetch(request: Request): Promise<Response> {
    return Effect.runPromise(answer(this.ctx.props, request));
  }
}
