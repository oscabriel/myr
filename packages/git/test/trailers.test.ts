import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import {
  AskId,
  CheckVersion,
  Handle,
  PatchId,
  ProjectName,
  RequestId,
} from "@repo/protocol/ids";
import { gitOk } from "@repo/testkit/git";
import { Effect, FileSystem } from "effect";

import {
  authorLine,
  committerLine,
  creditsOf,
  formatLanding,
  parseTrailers,
} from "../src/trailers.ts";

const alice = Handle.make("alice");

const bob = Handle.make("bob");

const carol = Handle.make("carol");

const landing = formatLanding({
  ask: {
    ask: AskId.make("week-at-year-end"),
    project: ProjectName.make("datekit"),
  },
  assisted: [{ harness: "claude-code", model: "opus-4", verified: true }],
  body: "The ISO week of December 31 was one too high.\nNow it rolls over.",
  credits: [
    { handle: alice, role: "Asked-by" },
    { handle: bob, role: "Signed-off-by" },
    { handle: carol, role: "Decided-by" },
  ],
  subject: "Give December 31 the week it belongs to",
});

/** What git itself reads as `message`'s trailers, one `key: value` per line. */
const gitTrailers = (message: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dir = yield* fs.makeTempDirectoryScoped().pipe(Effect.orDie);

    yield* fs.writeFileString(`${dir}/message`, message).pipe(Effect.orDie);

    const parsed = yield* gitOk(
      dir,
      "interpret-trailers",
      "--parse",
      "message"
    );

    return parsed === ""
      ? []
      : parsed.split("\n").map((line) => {
          const cut = line.indexOf(": ");

          return { key: line.slice(0, cut), value: line.slice(cut + 2) };
        });
  }).pipe(Effect.scoped);

// Messages whose last paragraph tests git's rules: a title is never trailers,
// a mixed paragraph counts only with a sign-off and 25% trailers, an indented
// line continues the trailer above it, and `---` ends the message.
const edges = [
  "Only a title: Not-a-trailer\n",
  "Title\n\nProse that ends.\nAcked-by: someone\n",
  "Title\n\nProse that ends.\nSigned-off-by: bob\nAcked-by: someone\n",
  "Title\n\nFixes: the parser\n  and the printer\nReviewed-by : carol\n",
  "Title\n\nBody\n\nReported-by: dee\n---\nNot-read: after the divider\n",
  "Title\n\nBody\n\nSee-also: one\n\n   \n",
];

describe("landing trailers", () => {
  it.live(
    "git reads a landing's trailers as the platform wrote them, in order",
    () =>
      Effect.gen(function* () {
        const expected = [
          { key: "Asked-by", value: `alice <alice@users.${Brand.domain}>` },
          { key: "Signed-off-by", value: `bob <bob@users.${Brand.domain}>` },
          { key: "Decided-by", value: `carol <carol@users.${Brand.domain}>` },
          { key: "Assisted-by", value: "claude-code:opus-4 (verified)" },
          { key: "Ask", value: "datekit/week-at-year-end" },
        ];

        expect(yield* gitTrailers(landing)).toStrictEqual(expected);
        expect(parseTrailers(landing)).toStrictEqual(expected);
        expect(landing.split("\n\n")[0]).toBe(
          "Give December 31 the week it belongs to"
        );
      }).pipe(Effect.provide(NodeServices.layer)),
    20_000
  );

  it.live(
    "parses any message's trailers the way git does",
    () =>
      Effect.gen(function* () {
        const read = yield* Effect.forEach(edges, (message) =>
          Effect.map(gitTrailers(message), (trailers) => ({
            message,
            trailers,
          }))
        );

        expect(
          edges.map((message) => ({
            message,
            trailers: parseTrailers(message),
          }))
        ).toStrictEqual(read);
      }).pipe(Effect.provide(NodeServices.layer)),
    20_000
  );

  it("credits people and only people; Assisted-by is never credit", () => {
    expect(creditsOf(landing)).toStrictEqual({
      assisted: [{ harness: "claude-code", model: "opus-4", verified: true }],
      credits: [
        { handle: alice, role: "Asked-by" },
        { handle: bob, role: "Signed-off-by" },
        { handle: carol, role: "Decided-by" },
      ],
    });
  });

  it("cites the verdict, the held-back result and the request", () => {
    expect(
      parseTrailers(
        formatLanding({
          assisted: [{ harness: "pi", verified: false }],
          credits: [{ handle: bob, role: "Signed-off-by" }],
          heldBack: `export 7/7 @ sha256:${"a".repeat(64)}`,
          requestId: RequestId.make("push-0123456789"),
          subject: "Land it",
          verdict: {
            checkVersion: CheckVersion.make("redThenGreen@0.0.0+abc"),
            patchId: PatchId.make("b".repeat(64)),
          },
        })
      )
    ).toStrictEqual([
      { key: "Signed-off-by", value: `bob <bob@users.${Brand.domain}>` },
      { key: "Assisted-by", value: "pi (claimed)" },
      { key: "Verdict", value: `${"b".repeat(64)} redThenGreen@0.0.0+abc` },
      { key: "Held-back", value: `export 7/7 @ sha256:${"a".repeat(64)}` },
      { key: "Request-id", value: "push-0123456789" },
    ]);
  });

  it("names the answerer by handle and the platform as committer", () => {
    expect(authorLine(alice)).toStrictEqual({
      email: `alice@users.${Brand.domain}`,
      name: "alice",
    });
    expect(committerLine).toStrictEqual({
      email: `platform@${Brand.domain}`,
      name: Brand.name,
    });
  });
});
