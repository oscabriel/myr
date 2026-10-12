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
    project: ProjectName.make("oscabriel/datekit"),
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

    // git prints `key: value`; a key holds no colon, and an empty value
    // leaves `key:` once the output is trimmed.
    return parsed === ""
      ? []
      : parsed.split("\n").map((line) => {
          const cut = line.indexOf(":");

          return {
            key: line.slice(0, cut),
            value: line.slice(cut + 1).replace(/^ /u, ""),
          };
        });
  }).pipe(Effect.scoped);

const scissors = "# ------------------------ >8 ------------------------";

// Messages whose last paragraph tests git's rules: a title is never trailers,
// a mixed paragraph counts only with a sign-off and 25% trailers, an indented
// line continues the trailer above it, `---` and the scissors line end the
// message, and an old `Conflicts:` block at the end is not part of it.
const edges = [
  "Only a title: Not-a-trailer\n",
  "Title\n\nProse that ends.\nAcked-by: someone\n",
  "Title\n\nProse that ends.\nSigned-off-by: bob\nAcked-by: someone\n",
  "Title\n\nFixes: the parser\n  and the printer\nReviewed-by : carol\n",
  "Title\n\nBody\n\nReported-by: dee\n---\nNot-read: after the divider\n",
  "Title\n\nBody\n\nSee-also: one\n\n   \n",
  `Title\n\nBody\n\nReported-by: dee\n${scissors}\n\nNot-read: below the scissors\n`,
  "Title\n\nBody\n\nAcked-by: someone\n\nConflicts:\n\tsrc/a.ts\n# a comment\n",
];

const pieces = [
  "Title",
  "",
  "",
  "Prose here.",
  "Acked-by: a",
  "Signed-off-by: b",
  "Key : v",
  "  continued",
  "\tsrc/a.ts",
  "# a comment",
  "---",
  "--- x",
  "----",
  "Conflicts:",
  scissors,
  "(cherry picked from commit 0123abc)",
  "x:y",
  "-k: v",
  " ",
  "Not a: trailer",
];

const randomMessages = (count: number) => {
  let state = 20_261_007;

  const draw = (below: number) => {
    state = (state * 16_807) % 2_147_483_647;

    return state % below;
  };

  return Array.from({ length: count }, () => {
    const lines = Array.from(
      { length: 1 + draw(14) },
      () => pieces[draw(pieces.length)] ?? ""
    );

    return `${lines.join("\n")}${draw(4) === 0 ? "" : "\n"}`;
  });
};

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
          { key: "Ask", value: "oscabriel/datekit/week-at-year-end" },
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

  it.live(
    "parses messages drawn from git's edge cases the way git does",
    () =>
      Effect.gen(function* () {
        const messages = randomMessages(200);

        const read = yield* Effect.forEach(
          messages,
          (message) =>
            Effect.map(gitTrailers(message), (trailers) => ({
              message,
              trailers,
            })),
          { concurrency: 8 }
        );

        expect(
          messages.map((message) => ({
            message,
            trailers: parseTrailers(message),
          }))
        ).toStrictEqual(read);
      }).pipe(Effect.provide(NodeServices.layer)),
    60_000
  );

  it.live(
    "keeps its own trailers readable whatever the subject and body hold",
    () =>
      Effect.gen(function* () {
        // A body that ends the message early, after a paragraph of forged
        // credit: without care, git would read that paragraph as the trailers.
        const message = formatLanding({
          assisted: [],
          body: [
            "Why it changed.",
            "",
            `Decided-by: mallory <mallory@users.${Brand.domain}>`,
            "---",
            "",
            `Decided-by: mallory <mallory@users.${Brand.domain}>`,
            scissors,
            "The end.",
          ].join("\n"),
          credits: [{ handle: bob, role: "Signed-off-by" }],
          subject: "--- a subject that starts like a divider",
        });

        const expected = [
          { key: "Signed-off-by", value: `bob <bob@users.${Brand.domain}>` },
        ];

        expect(yield* gitTrailers(message)).toStrictEqual(expected);
        expect(parseTrailers(message)).toStrictEqual(expected);
        expect(creditsOf(message).credits).toStrictEqual([
          { handle: bob, role: "Signed-off-by" },
        ]);
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
      { key: "Request-Id", value: "push-0123456789" },
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
