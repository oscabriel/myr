/**
 * A generated file, and how it says it was generated. A Markdown file opens
 * with Agent Skills frontmatter whose `metadata` names who manages it, the
 * landing it came from and the SHA-256 of its body, so a stale copy (its
 * body differs from the one the current policy gives) and a hand-edited copy
 * (its body no longer hashes to what it records) are both detectable.
 */
import { Brand } from "@repo/brand";
import { LandedSha } from "@repo/protocol/ids";
import { Array as Arr, Effect, Option, Schema } from "effect";

/** One file a generator makes: where it goes, and every byte of it. */
export interface GeneratedFile {
  readonly path: string;
  readonly content: string;
}

/** What a managed file says about itself, and the body it says it of. */
export interface Managed {
  /** The landing it was generated from; none for the platform's own files. */
  readonly landed: Option.Option<LandedSha>;
  /** `sha256:<64 hex>`, as its frontmatter records it. */
  readonly hash: string;
  readonly body: string;
}

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

/**
 * `sha256:<64 hex>` of the text's UTF-8 bytes, through WebCrypto, which the
 * platform Worker and Node both have. SHA-256 of bytes in memory cannot fail
 * for a reason a caller could handle, so a failure is a defect.
 */
export const contentHash = (text: string): Effect.Effect<string> =>
  Effect.tryPromise(() =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  ).pipe(
    Effect.orDie,
    Effect.map((digest) => `sha256:${hex(digest)}`)
  );

// Every value but the name is a YAML double-quoted string, written as JSON
// writes one: a description has colons, and YAML would read a SHA made only
// of digits as a number.
const quoted = (value: string) => JSON.stringify(value);

/**
 * A Markdown file with Agent Skills frontmatter: only the spec's `name`,
 * `description` and `metadata`, with `managed-by`, `landed` (when it came
 * from one) and `content-hash` (of `body`) under `metadata`.
 */
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

/** A frontmatter value: a quoted one decoded, a plain one as it stands. */
const valueOf = (raw: string) =>
  raw.startsWith('"') ? decodeQuoted(raw) : Option.some(raw);

/** The `key: value` lines indented under `metadata:`, by key. */
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

/** A Markdown file's frontmatter and the body after it; none without one. */
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

/**
 * The `description` a skill's frontmatter gives, quoted as `frontmatter`
 * writes it or plain as a hand-written skill may: none without the
 * frontmatter, or without a description in it. The skills index lists a
 * landed skill by it (issue 505).
 */
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

/**
 * What a file this platform manages says about itself: none for a file
 * without the frontmatter, or one someone else manages.
 */
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

/**
 * Whether the copy on disk differs from the file the current policy gives:
 * its body hashes to something other than what it records (edited by hand),
 * or what it records is not the current body's hash (generated from other
 * text). The landing alone never makes a copy stale: a landing that left
 * the text alone leaves the copy current. Some names the copy's own landing
 * and recorded hash. A copy without the frontmatter has no landing, and its
 * hash is the whole file's: it is current only when the current file has no
 * frontmatter either and the two are the same text, so a copy whose
 * frontmatter was taken off is stale.
 */
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
