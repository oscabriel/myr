import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Effect, Option } from "effect";

import { frontmatter, isStale, readManaged } from "../src/generated-file.ts";
import { projectSkill } from "../src/project-skill.ts";
import {
  landed,
  later,
  policy,
  policyWithNewLint,
  project,
} from "./fixtures.ts";

/** `sha256("hello\n")`, as every tool that hashes prints it. */
const helloDigest =
  "sha256:5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03";

/** The hash a file's frontmatter records, read with a pattern of its own. */
const recordedHash = (file: string) =>
  /^ {2}content-hash: "(?<hash>sha256:[0-9a-f]{64})"$/mu.exec(file)?.groups
    ?.hash ?? "";

const contributeSkill = (input: {
  readonly policy: typeof policy;
  readonly landed: typeof landed;
}) =>
  projectSkill({ ...input, project }).pipe(
    Effect.map((files) => files[0] ?? { content: "", path: "" })
  );

describe(frontmatter, () => {
  it.effect(
    "says who manages the file, the landing it came from and its body's SHA-256",
    () =>
      Effect.gen(function* () {
        const file = yield* frontmatter({
          body: "hello\n",
          description: "Say hello: politely.",
          landed: Option.some(landed),
          name: "hello",
        });

        expect(file).toBe(
          [
            "---",
            "name: hello",
            'description: "Say hello: politely."',
            "metadata:",
            `  managed-by: "${Brand.slug}"`,
            `  landed: "${landed}"`,
            `  content-hash: "${helloDigest}"`,
            "---",
            "hello",
            "",
          ].join("\n")
        );
      })
  );

  it.effect("leaves the landing out when the file came from none", () =>
    Effect.gen(function* () {
      const file = yield* frontmatter({
        body: "hello\n",
        description: "Say hello.",
        landed: Option.none(),
        name: "hello",
      });

      expect(file).not.toContain("landed:");
      expect(recordedHash(file)).toBe(helloDigest);
    })
  );
});

describe(readManaged, () => {
  it.effect("reads back the landing, the hash and the body", () =>
    Effect.gen(function* () {
      const file = yield* frontmatter({
        body: "hello\n",
        description: "Say hello.",
        landed: Option.some(landed),
        name: "hello",
      });

      expect(readManaged(file)).toStrictEqual(
        Option.some({
          body: "hello\n",
          hash: helloDigest,
          landed: Option.some(landed),
        })
      );
    })
  );

  it("is None for a file without the frontmatter", () => {
    expect(readManaged("# Contribute\n\nBy hand.\n")).toStrictEqual(
      Option.none()
    );
  });

  it("is None for a file someone else manages", () => {
    const file = [
      "---",
      "name: hello",
      'description: "Say hello."',
      "metadata:",
      '  managed-by: "someone-else"',
      `  content-hash: "${helloDigest}"`,
      "---",
      "hello",
      "",
    ].join("\n");

    expect(readManaged(file)).toStrictEqual(Option.none());
  });
});

describe(isStale, () => {
  it.effect("is None for a fresh copy", () =>
    Effect.gen(function* () {
      const current = yield* contributeSkill({ landed, policy });

      expect(yield* isStale(current.content, current)).toStrictEqual(
        Option.none()
      );
    })
  );

  it.effect(
    "is None for a copy from an earlier landing that left the policy's text alone",
    () =>
      Effect.gen(function* () {
        const onDisk = yield* contributeSkill({ landed, policy });
        const current = yield* contributeSkill({ landed: later, policy });

        expect(onDisk.content).not.toBe(current.content);
        expect(yield* isStale(onDisk.content, current)).toStrictEqual(
          Option.none()
        );
      })
  );

  it.effect(
    "names the copy's landing and hash when the run block changed since",
    () =>
      Effect.gen(function* () {
        const onDisk = yield* contributeSkill({ landed, policy });

        const current = yield* contributeSkill({
          landed: later,
          policy: policyWithNewLint,
        });

        expect(recordedHash(onDisk.content)).not.toBe(
          recordedHash(current.content)
        );
        expect(yield* isStale(onDisk.content, current)).toStrictEqual(
          Option.some({
            hash: recordedHash(onDisk.content),
            landed: Option.some(landed),
          })
        );
      })
  );

  it.effect(
    "names the copy's landing and hash when its body was edited by hand",
    () =>
      Effect.gen(function* () {
        const current = yield* contributeSkill({ landed, policy });
        const edited = current.content.replace("bun test {path}", "npm test");

        expect(edited).not.toBe(current.content);
        expect(yield* isStale(edited, current)).toStrictEqual(
          Option.some({
            hash: recordedHash(current.content),
            landed: Option.some(landed),
          })
        );
      })
  );

  it.effect(
    "is Some, with no landing and the file's own hash, for a copy without the frontmatter",
    () =>
      Effect.gen(function* () {
        const current = yield* contributeSkill({ landed, policy });

        expect(yield* isStale("hello\n", current)).toStrictEqual(
          Option.some({ hash: helloDigest, landed: Option.none() })
        );
      })
  );
});
