/**
 * The receive-pack side of git's smart HTTP (gitprotocol-pack): the command
 * list that opens a push, and the report-status that answers it.
 */
import { RefName } from "@repo/artifacts/repo-host";
import { CommitSha } from "@repo/protocol/ids";
import type { Refusal } from "@repo/protocol/refusal";
import { explain, headline } from "@repo/protocol/render";
import { Array, Data, Effect, Option, Schema, Stream } from "effect";

import type { Command } from "./custody.ts";
import { FLUSH, concat, packetAt, packets, pkt, utf8 } from "./pkt-line.ts";

/** The request is not a receive-pack request git would send. */
export class Malformed extends Data.TaggedError("Malformed")<{
  readonly reason: string;
}> {}

const ZERO = "0".repeat(40);

const COMMAND =
  /^(?<from>[0-9a-f]{40}) (?<to>[0-9a-f]{40}) (?<ref>[^\0\n ]+)(?:\0(?<capabilities>[^\n]*))?\n?$/u;

const objectId = (hex: string) =>
  hex === ZERO ? Option.none() : Option.some(CommitSha.make(hex));

const isRefName = Schema.is(RefName);

/** The opening of a push, and every byte read to find it. */
export interface Opening {
  readonly commands: readonly Command[];
  readonly capabilities: ReadonlySet<string>;
  readonly read: Uint8Array;
}

const parse = (lines: readonly string[]) =>
  Effect.gen(function* () {
    const commands: Command[] = [];
    let capabilities = new Set<string>();

    // A shallow clone names its shallow commits before its commands.
    for (const line of lines.filter((text) => !text.startsWith("shallow "))) {
      const fields = COMMAND.exec(line)?.groups;

      if (fields?.from === undefined || fields.to === undefined) {
        return yield* new Malformed({ reason: `not a push command: ${line}` });
      }

      if (fields.ref === undefined || !isRefName(fields.ref)) {
        return yield* new Malformed({
          reason: `not a ref this gateway carries: ${fields.ref ?? ""}`,
        });
      }

      if (commands.length === 0) {
        capabilities = new Set(
          (fields.capabilities ?? "").split(" ").filter((word) => word !== "")
        );
      }

      commands.push({
        from: objectId(fields.from),
        ref: fields.ref,
        to: objectId(fields.to),
      });
    }

    return { capabilities, commands };
  });

const packetIn = (bytes: Uint8Array, at: number) =>
  Effect.try({
    catch: () => new Malformed({ reason: `bad pkt-line at byte ${at}` }),
    try: () => packetAt(bytes, at),
  });

const chunkOf = (reader: ReadableStreamDefaultReader<Uint8Array>) =>
  Effect.tryPromise({
    catch: () => new Malformed({ reason: "the push could not be read" }),
    try: () => reader.read(),
  });

/**
 * Reads a push's command list, up to its flush, from the request body, then
 * lets the body go: the pack that follows stays unread in it. An empty list
 * is git's probe before a large push.
 */
export const readOpening = (body: ReadableStream<Uint8Array>) =>
  Effect.gen(function* () {
    const reader = body.getReader();
    const lines: string[] = [];
    let read = new Uint8Array(0);
    let at = 0;
    let flushed = false;

    while (!flushed) {
      const next = yield* packetIn(read, at);

      if (Option.isSome(next)) {
        const { packet } = next.value;

        at = next.value.next;
        flushed = packet === "Flush";

        if (packet !== "Flush") {
          lines.push(new TextDecoder().decode(packet));
        }
      } else {
        const chunk = yield* chunkOf(reader);

        if (chunk.done) {
          return yield* new Malformed({
            reason: "the push ended inside its command list",
          });
        }

        read = concat([read, chunk.value]);
      }
    }

    reader.releaseLock();

    const { capabilities, commands } = yield* parse(lines);

    return { capabilities, commands, read } satisfies Opening;
  });

const rest = (body: ReadableStream<Uint8Array>) =>
  Stream.fromReadableStream({
    evaluate: () => body,
    onError: () => new Malformed({ reason: "the push could not be read" }),
  });

/** Reads the rest of a body and drops it, so the client finishes sending. */
export const drain = (body: ReadableStream<Uint8Array>) =>
  Stream.runDrain(rest(body)).pipe(Effect.ignore);

/** The bytes already read, then the rest of the body, as one stream. */
export const resume = (read: Uint8Array, body: ReadableStream<Uint8Array>) =>
  Stream.toReadableStream(Stream.concat(Stream.succeed(read), rest(body)));

// The largest payload a side-band packet carries, by the client's capability.
const bandLimit = (capabilities: ReadonlySet<string>) => {
  if (capabilities.has("side-band-64k")) {
    return Option.some(65_515);
  }

  return capabilities.has("side-band") ? Option.some(995) : Option.none();
};

const band = (channel: 1 | 2, payload: Uint8Array) =>
  pkt(concat([Uint8Array.of(channel), payload]));

const chunks = (bytes: Uint8Array, limit: number) => {
  const parts: Uint8Array[] = [];

  for (let at = 0; at < bytes.length; at += limit) {
    parts.push(bytes.subarray(at, at + limit));
  }

  return parts;
};

/** One ref's line in a report: `None` if it landed, else git's reason. */
export interface RefStatus {
  readonly ref: string;
  readonly ng: Option.Option<string>;
}

/** The upstream's answer to a push, out of its side band. */
export interface UpstreamReport {
  /** Side-band messages, which git prints as `remote:` lines. */
  readonly messages: readonly Uint8Array[];
  /** `ok`, or why the pack did not unpack; `None` if no report came. */
  readonly unpack: Option.Option<string>;
  readonly refs: readonly RefStatus[];
}

const text = (bytes: Uint8Array) =>
  new TextDecoder().decode(bytes).replace(/\n$/u, "");

const STATUS = /^(?<verdict>ok|ng) (?<ref>\S+)(?: (?<reason>.*))?$/u;

/** Reads the upstream's reply to a push; throws if it is not pkt-lines. */
export const readReport = (
  capabilities: ReadonlySet<string>,
  reply: Uint8Array
): UpstreamReport => {
  const messages: Uint8Array[] = [];
  const status: Uint8Array[] = [];

  if (Option.isSome(bandLimit(capabilities))) {
    for (const packet of packets(reply)) {
      if (packet !== "Flush") {
        // Band 1 carries the report, 2 progress, 3 a fatal error.
        (packet[0] === 1 ? status : messages).push(packet.subarray(1));
      }
    }
  } else {
    status.push(reply);
  }

  const lines = packets(concat(status)).flatMap((packet) =>
    packet === "Flush" ? [] : [text(packet)]
  );

  const unpack = Option.fromNullishOr(
    lines.find((line) => line.startsWith("unpack "))?.slice("unpack ".length)
  );

  const refs = lines.flatMap((line): RefStatus[] => {
    const fields = STATUS.exec(line)?.groups;

    return fields?.ref === undefined
      ? []
      : [
          {
            ng:
              fields.verdict === "ng"
                ? Option.some(fields.reason ?? "")
                : Option.none(),
            ref: fields.ref,
          },
        ];
  });

  return { messages, refs, unpack };
};

/**
 * The reply a pusher gets: side-band messages, then every refusal explained,
 * as `remote:` lines; then `ok` or `ng <ref> <reason>` for every ref.
 */
export const writeReport = (
  capabilities: ReadonlySet<string>,
  messages: readonly Uint8Array[],
  refusals: readonly Refusal[],
  refs: readonly RefStatus[]
) => {
  const reports =
    capabilities.has("report-status") || capabilities.has("report-status-v2");

  const status = reports
    ? concat([
        pkt(utf8("unpack ok\n")),
        ...refs.map(({ ng, ref }) =>
          pkt(
            utf8(
              Option.match(ng, {
                onNone: () => `ok ${ref}\n`,
                onSome: (reason) => `ng ${ref} ${reason}\n`,
              })
            )
          )
        ),
        FLUSH,
      ])
    : new Uint8Array(0);

  const explained = Array.isReadonlyArrayNonEmpty(refusals)
    ? explain(refusals)
    : [];

  return Option.match(bandLimit(capabilities), {
    onNone: () => status,
    onSome: (limit) =>
      concat([
        ...messages.map((message) => band(2, message)),
        ...explained.map((line) => band(2, utf8(`${line}\n`))),
        ...chunks(status, limit).map((part) => band(1, part)),
        FLUSH,
      ]),
  });
};

const ADVERTISED = /^(?<oid>[0-9a-f]{40}) (?<ref>[^\0\n ]+)/u;

/** The refs in a ref advertisement (`info/refs`) and the commit each names. */
export const readAdvertisement = (advertisement: Uint8Array) =>
  new Map(
    packets(advertisement).flatMap((packet) => {
      const fields =
        packet === "Flush" ? undefined : ADVERTISED.exec(text(packet))?.groups;

      return fields?.oid === undefined || fields.ref === undefined
        ? []
        : [[fields.ref, CommitSha.make(fields.oid)] as const];
    })
  );

/** Every ref turned away for the same refusals. */
export const refuseAll = (
  commands: readonly Command[],
  refusals: Array.NonEmptyReadonlyArray<Refusal>
): RefStatus[] =>
  commands.map(({ ref }) => ({ ng: Option.some(headline(refusals)), ref }));
