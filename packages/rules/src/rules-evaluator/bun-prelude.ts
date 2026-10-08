/**
 * The env var through which the `/bun` adapter hands the prelude the frozen
 * clock and seed, as JSON `{"now": "<ISO time>", "seed": <int>}`.
 */
export const clockVariable = "RULES_CLOCK";

/**
 * The preload the `/bun` adapter runs before any config code (principle 8):
 * `Date.now()`, `new Date()` with no argument, `Math.random()`,
 * `crypto.getRandomValues()`, `crypto.randomUUID()` and `performance.now()`
 * give values derived from the injected clock and seed, `fetch` is gone, and
 * config code's own logging goes to stderr so stdout carries only the
 * evaluator's one result. It is plain JavaScript written beside the modules:
 * source text here, not host code. The Worker's prelude is its own module.
 */
export const bunPrelude = `
const clock = JSON.parse(process.env.${clockVariable} ?? "{}");
delete process.env.${clockVariable};

const RealDate = Date;
const frozen = RealDate.parse(clock.now ?? "1970-01-01T00:00:00.000Z");

// mulberry32: a small seeded generator, the same numbers for the same seed.
let state = (clock.seed ?? 0) >>> 0;
const next = () => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

function FrozenDate(...args) {
  if (new.target === undefined) {
    return new RealDate(frozen).toString();
  }
  return Reflect.construct(RealDate, args.length === 0 ? [frozen] : args, new.target);
}
FrozenDate.prototype = RealDate.prototype;
// A date's own constructor must not lead back to the wall clock.
Object.defineProperty(RealDate.prototype, "constructor", {
  configurable: true,
  value: FrozenDate,
  writable: true,
});
FrozenDate.now = () => frozen;
FrozenDate.parse = RealDate.parse;
FrozenDate.UTC = RealDate.UTC;
globalThis.Date = FrozenDate;

Math.random = next;

const fill = (array) => {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(next() * 256);
  }
  return array;
};
crypto.getRandomValues = fill;
crypto.randomUUID = () => {
  const bytes = fill(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
};
performance.now = () => 0;

delete globalThis.fetch;

for (const level of ["debug", "info", "log"]) {
  console[level] = (...values) => console.error(...values);
}
`;
