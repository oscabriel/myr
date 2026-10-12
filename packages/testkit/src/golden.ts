import { Brand } from "@repo/brand";
import { Config, Context, Effect, FileSystem } from "effect";

export const GoldenDir = Context.Reference<string>("testkit/GoldenDir", {
  defaultValue: () => "test/golden",
});

// A directory made under the system's temporary folder, up to and including
// the random name it was made with: Linux's `/tmp/x1y2z3`, macOS's
// `/var/folders/ab/cd/T/x1y2z3`, as given or as resolved through `/private`.
const TEMP_PATH =
  /(?<![\w.-])(?:\/private)?(?:\/var\/folders\/[^\s/'"]+\/[^\s/'"]+\/T|\/var\/tmp|\/tmp)\/[^\s/'"]+/gu;

// A full SHA-1 object id, and nothing longer: a SHA-256 stays as it is.
const OBJECT_ID = /(?<![0-9a-f])[0-9a-f]{40}(?![0-9a-f])/gu;

// A server a test started on this machine, whose port changes every run.
const LOCAL_SERVER = /\b(?:127\.0\.0\.1|localhost):\d+/gu;

/**
 * What a terminal shows of one line git rewrote with carriage returns (a
 * progress meter): the last version of it. A carriage return with nothing
 * after it only moves the cursor, so the version before it still shows.
 */
const lastRewrite = (line: string) =>
  line.split("\r").findLast((version) => version !== "") ?? "";

/**
 * Without the spaces git pads side-band lines with when stderr is not a
 * terminal, with temporary folders as `<tmp>`, object ids as `<sha>`, a local
 * server as `<host>`, and each carriage-return line as a terminal leaves it.
 */
export const normaliseGitOutput = (text: string): string =>
  text
    .split(/\r?\n/u)
    .map((line) =>
      lastRewrite(line)
        .replaceAll(TEMP_PATH, "<tmp>")
        .replaceAll(LOCAL_SERVER, "<host>")
        .replaceAll(OBJECT_ID, "<sha>")
        .trimEnd()
    )
    .join("\n");

// Letters on either side make it another word, not the product's name:
// the rule `brand:check` applies.
const NAME = new RegExp(`(?<![a-z])${Brand.slug}(?![a-z])`, "giu");

/** The product's name as placeholders, so no golden file names it (`brand:check`). */
const unbranded = (text: string) =>
  text.replaceAll(Brand.configDir, "<configDir>").replaceAll(NAME, "<brand>");

const difference = (golden: string, actual: string) => {
  const was = golden.split("\n");
  const now = actual.split("\n");

  return Array.from({ length: Math.max(was.length, now.length) }, (_, at) =>
    was[at] === now[at]
      ? []
      : [
          ...(was[at] === undefined ? [] : [`- ${was[at]}`]),
          ...(now[at] === undefined ? [] : [`+ ${now[at]}`]),
        ]
  )
    .flat()
    .join("\n");
};

/** With `UPDATE_GOLDEN=1` it writes the file instead: run the tests that way once, then read the diff. */
export const expectGolden = (
  name: string,
  text: string
): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dir = yield* GoldenDir;
    const file = `${dir}/${name}.txt`;
    const actual = unbranded(text);

    const update = yield* Config.Boolean("UPDATE_GOLDEN").pipe(
      Config.withDefault(false)
    );

    if (update) {
      yield* fs.makeDirectory(file.slice(0, file.lastIndexOf("/")), {
        recursive: true,
      });

      return yield* fs.writeFileString(file, actual);
    }

    if (!(yield* fs.exists(file))) {
      return yield* Effect.die(
        new Error(
          `no golden file ${file} yet: run this package's tests with UPDATE_GOLDEN=1 to write it`
        )
      );
    }

    const golden = yield* fs.readFileString(file);

    return yield* golden === actual
      ? Effect.void
      : Effect.die(
          new Error(
            `${file} differs from the output (rerun with UPDATE_GOLDEN=1 to accept it):\n${difference(golden, actual)}`
          )
        );
  }).pipe(Effect.orDie);
