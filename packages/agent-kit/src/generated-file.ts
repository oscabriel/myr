import { Brand } from "@repo/brand";
import { LandedSha } from "@repo/protocol/ids";
import { Array as Arr, Effect, Option, Schema } from "effect";

export interface GeneratedFile {
  readonly path: string;
  readonly content: string;
}

export interface Managed {
  readonly landed: Option.Option<LandedSha>;
  readonly hash: string;
  readonly body: string;
}

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

export const contentHash = (text: string): Effect.Effect<string> =>
  Effect.tryPromise(() =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  ).pipe(
    Effect.orDie,
    Effect.map((digest) => `sha256:${hex(digest)}`)
  );

// Values are JSON-quoted: a description has colons, and YAML would read a
// SHA made only of digits as a number.
const quoted = (value: string) => JSON.stringify(value);

export const frontmatter = (input: {
  readonly name: string;
  readonly description: string;
  readonly landed: Option.Option<LandedSha>;
  readonly body: string;
}): Effect.Effect<string> =>
  contentHash(input.body).pipe(
    Effect.map((hash) =>
      [
        "---",
        `name: ${input.name}`,
        `description: ${quoted(input.description)}`,
        "metadata:",
        `  managed-by: ${quoted(Brand.slug)}`,
        ...Option.toArray(input.landed).map(
          (sha) => `  landed: ${quoted(sha)}`
        ),
        `  content-hash: ${quoted(hash)}`,
        "---",
        input.body,
      ].join("\n")
    )
  );

const OPEN = "---\n";

const CLOSE = "\n---\n";

const decodeQuoted = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.String)
);

const valueOf = (raw: string) =>
  raw.startsWith('"') ? decodeQuoted(raw) : Option.some(raw);

const metadataOf = (head: string) => {
  const lines = head.split("\n");
  const start = lines.indexOf("metadata:");

  const nested =
    start === -1
      ? []
      : Arr.takeWhile(lines.slice(start + 1), (line) => line.startsWith("  "));

  return new Map(
    nested.flatMap((line) => {
      const { key, raw } =
        /^ {2}(?<key>[a-z-]+): (?<raw>.+)$/u.exec(line)?.groups ?? {};

      return key === undefined || raw === undefined
        ? []
        : Option.toArray(valueOf(raw)).map((value) => [key, value] as const);
    })
  );
};

const decodeLanded = Schema.decodeUnknownOption(LandedSha);

const sections = (file: string) => {
  if (!file.startsWith(OPEN)) {
    return Option.none();
  }

  const close = file.indexOf(CLOSE, OPEN.length - 1);

  return close === -1
    ? Option.none()
    : Option.some({
        body: file.slice(close + CLOSE.length),
        head: file.slice(OPEN.length, close),
      });
};

const DESCRIPTION = "description: ";

export const describedIn = (file: string): Option.Option<string> =>
  Option.flatMap(sections(file), ({ head }) =>
    Arr.findFirst(head.split("\n"), (line) =>
      line.startsWith(DESCRIPTION)
    ).pipe(
      Option.map((line) => line.slice(DESCRIPTION.length).trim()),
      Option.filter((raw) => raw !== ""),
      Option.flatMap(valueOf)
    )
  );

export const readManaged = (file: string): Option.Option<Managed> => {
  const split = sections(file);

  if (Option.isNone(split)) {
    return Option.none();
  }

  const { body, head } = split.value;
  const metadata = metadataOf(head);
  const hash = metadata.get("content-hash");

  if (metadata.get("managed-by") !== Brand.slug || hash === undefined) {
    return Option.none();
  }

  return Option.some({
    body,
    hash,
    landed: Option.fromNullishOr(metadata.get("landed")).pipe(
      Option.flatMap(decodeLanded)
    ),
  });
};

export const isStale = (
  onDisk: string,
  current: GeneratedFile
): Effect.Effect<
  Option.Option<{
    readonly landed: Option.Option<LandedSha>;
    readonly hash: string;
  }>
> =>
  Effect.gen(function* () {
    const copy = readManaged(onDisk);

    if (Option.isNone(copy)) {
      return onDisk === current.content
        ? Option.none()
        : Option.some({
            hash: yield* contentHash(onDisk),
            landed: Option.none(),
          });
    }

    const wanted = yield* Option.match(readManaged(current.content), {
      onNone: () => contentHash(current.content),
      onSome: ({ hash }) => Effect.succeed(hash),
    });

    const { body, hash, landed } = copy.value;
    const actual = yield* contentHash(body);

    return actual === hash && hash === wanted
      ? Option.none()
      : Option.some({ hash, landed });
  });
