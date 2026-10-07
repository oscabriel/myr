/**
 * git's pkt-line framing (gitprotocol-common): four hex digits giving the
 * line's length including themselves, then the payload; `0000` is a flush.
 */
import { Option } from "effect";

const encoder = new TextEncoder();

export const FLUSH = encoder.encode("0000");

export const concat = (parts: readonly Uint8Array[]) => {
  const all = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;

  for (const part of parts) {
    all.set(part, at);
    at += part.length;
  }

  return all;
};

export const utf8 = (text: string) => encoder.encode(text);

/** One pkt-line around `payload`. */
export const pkt = (payload: Uint8Array) =>
  concat([
    encoder.encode((payload.length + 4).toString(16).padStart(4, "0")),
    payload,
  ]);

/** A data line's payload, or `Flush`. */
export type Packet = Uint8Array | "Flush";

/**
 * The packet that starts at `at`, with where the next one starts; `None` if
 * the bytes stop before the packet does.
 */
export const packetAt = (
  bytes: Uint8Array,
  at: number
): Option.Option<{ readonly packet: Packet; readonly next: number }> => {
  if (bytes.length < at + 4) {
    return Option.none();
  }

  const length = Number.parseInt(
    new TextDecoder().decode(bytes.subarray(at, at + 4)),
    16
  );

  if (length === 0) {
    return Option.some({ next: at + 4, packet: "Flush" });
  }

  if (Number.isNaN(length) || length < 4) {
    throw new RangeError(`not a pkt-line length at byte ${at}`);
  }

  return bytes.length < at + length
    ? Option.none()
    : Option.some({
        next: at + length,
        packet: bytes.subarray(at + 4, at + length),
      });
};

/** Every packet in `bytes`, which must hold whole packets only. */
export const packets = (bytes: Uint8Array) => {
  const found: Packet[] = [];
  let at = 0;

  while (at < bytes.length) {
    const next = packetAt(bytes, at);

    if (Option.isNone(next)) {
      throw new RangeError(`a pkt-line runs past the end at byte ${at}`);
    }

    found.push(next.value.packet);
    at = next.value.next;
  }

  return found;
};
