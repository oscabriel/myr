import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Cause, ConfigProvider, Effect, Exit, FileSystem } from "effect";

import { git, gitOk } from "../src/git.ts";
import { expectGolden, GoldenDir, normaliseGitOutput } from "../src/golden.ts";

const id = "0123456789abcdef0123456789abcdef01234567";

/**
 * One push of one fixed commit to a new bare repo, through a pre-receive hook
 * that prints what it received: git's whole stderr, as it printed it.
 */
const pushOnce = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped().pipe(Effect.orDie);
  const remote = `${root}/remote.git`;
  const work = `${root}/work`;
  const hook = `${remote}/hooks/pre-receive`;

  yield* gitOk(
    root,
    "init",
    "--quiet",
    "--bare",
    "--initial-branch=main",
    remote
  );
  yield* fs
    .writeFileString(
      hook,
      '#!/bin/sh\nwhile read old new ref; do echo "received $new for $ref"; done\n'
    )
    .pipe(Effect.orDie);
  yield* fs.chmod(hook, 0o755).pipe(Effect.orDie);
  yield* gitOk(root, "init", "--quiet", "--initial-branch=main", work);
  yield* fs.writeFileString(`${work}/a.txt`, "a\n").pipe(Effect.orDie);
  yield* gitOk(work, "add", "--all");
  yield* gitOk(work, "commit", "--quiet", "--message", "first");

  return yield* git(work, "push", remote, "HEAD:refs/heads/main");
}).pipe(Effect.scoped);

/** What a failed expectation says, or nothing when it passed. */
const complaint = (exit: Exit.Exit<void>) =>
  Exit.isFailure(exit) ? String(Cause.squash(exit.cause)) : "";

/** Runs with golden files in a fresh folder, and `UPDATE_GOLDEN` as given. */
const inTempGoldens = <A, E, R>(
  update: string,
  run: (dir: string) => Effect.Effect<A, E, R>
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dir = yield* fs.makeTempDirectoryScoped().pipe(Effect.orDie);

    return yield* run(`${dir}/golden`).pipe(
      Effect.provideService(GoldenDir, `${dir}/golden`),
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromEnv({ env: { UPDATE_GOLDEN: update } })
        )
      )
    );
  }).pipe(Effect.scoped);

describe("git output, normalised", () => {
  it("drops the eight spaces git pads side-band lines with, and any other trailing space", () => {
    expect(
      normaliseGitOutput(
        "remote: StaleBase: main moved        \nremote:   next: git pull --rebase        \nTo here \t\n"
      )
    ).toBe(
      "remote: StaleBase: main moved\nremote:   next: git pull --rebase\nTo here\n"
    );
  });

  it("names temporary folders <tmp>, on Linux and on macOS", () => {
    expect(
      normaliseGitOutput(
        [
          "To /tmp/Ab3dE9/remote.git",
          "To /var/folders/x1/y2z3w4/T/Qq81Zk/remote.git",
          "To /private/var/folders/x1/y2z3w4/T/Qq81Zk/remote.git",
          "fatal: '/private/tmp/kk2/work' is not a git repository",
        ].join("\n")
      )
    ).toBe(
      [
        "To <tmp>/remote.git",
        "To <tmp>/remote.git",
        "To <tmp>/remote.git",
        "fatal: '<tmp>/work' is not a git repository",
      ].join("\n")
    );
  });

  it("names full object ids <sha>, and leaves short ids and longer hex alone", () => {
    expect(
      normaliseGitOutput(
        `remote: received ${id} for refs/heads/main\n   0123456..89abcde  main -> main\nsha256 ${id}0123`
      )
    ).toBe(
      `remote: received <sha> for refs/heads/main\n   0123456..89abcde  main -> main\nsha256 ${id}0123`
    );
  });

  it("names a local server's address <host>, since its port changes every run", () => {
    expect(
      normaliseGitOutput(
        "To http://127.0.0.1:43567/datekit--fix--bob.git\nTo http://localhost:8787/x.git"
      )
    ).toBe("To http://<host>/datekit--fix--bob.git\nTo http://<host>/x.git");
  });

  it("keeps what a terminal would show of a line rewritten with carriage returns", () => {
    expect(
      normaliseGitOutput(
        "Writing objects:  50% (1/2)\rWriting objects: 100% (2/2), done.\r\nTo x\r\n"
      )
    ).toBe("Writing objects: 100% (2/2), done.\nTo x\n");
  });

  it("keeps a progress line that ends in a carriage return, as a terminal still shows it", () => {
    expect(
      normaliseGitOutput(
        "Counting objects: 1\rCounting objects: 2\r\r\nTo x\nWriting objects:  50% (1/2)\r"
      )
    ).toBe("Counting objects: 2\nTo x\nWriting objects:  50% (1/2)");
  });

  it.live(
    "makes two runs of the same push compare equal, and match their golden file",
    () =>
      Effect.gen(function* () {
        const first = yield* pushOnce;
        const second = yield* pushOnce;

        expect([first.exitCode, second.exitCode]).toStrictEqual([0, 0]);
        expect(first.stderr).toContain("        \n");
        expect(first.stderr).not.toBe(second.stderr);
        expect(normaliseGitOutput(first.stderr)).toBe(
          normaliseGitOutput(second.stderr)
        );

        yield* expectGolden(
          "push-new-branch",
          normaliseGitOutput(first.stderr)
        );
      }).pipe(Effect.provide(NodeServices.layer)),
    20_000
  );
});

describe("golden files", () => {
  it.effect("pass when the text matches the file", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;

      yield* inTempGoldens("0", (dir) =>
        Effect.gen(function* () {
          yield* fs.makeDirectory(dir, { recursive: true }).pipe(Effect.orDie);
          yield* fs
            .writeFileString(`${dir}/same.txt`, "To <tmp>/remote.git\n")
            .pipe(Effect.orDie);

          const exit = yield* Effect.exit(
            expectGolden("same", "To <tmp>/remote.git\n")
          );

          expect(complaint(exit)).toBe("");
        })
      );
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.effect(
    "fail, naming the file and how to accept the change, when the text differs",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;

        yield* inTempGoldens("0", (dir) =>
          Effect.gen(function* () {
            yield* fs
              .makeDirectory(dir, { recursive: true })
              .pipe(Effect.orDie);
            yield* fs
              .writeFileString(`${dir}/changed.txt`, "line one\nline two\n")
              .pipe(Effect.orDie);

            const exit = yield* Effect.exit(
              expectGolden("changed", "line one\nline 2\n")
            );

            expect(complaint(exit)).toContain(`${dir}/changed.txt`);
            expect(complaint(exit)).toContain("UPDATE_GOLDEN=1");
            expect(complaint(exit)).toContain("- line two");
            expect(complaint(exit)).toContain("+ line 2");
          })
        );
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.effect("fail when there is no file yet", () =>
    inTempGoldens("0", () =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(expectGolden("absent", "text\n"));

        expect(complaint(exit)).toContain("absent.txt");
        expect(complaint(exit)).toContain("UPDATE_GOLDEN=1");
      })
    ).pipe(Effect.provide(NodeServices.layer))
  );

  it.effect("are written, folder and all, under UPDATE_GOLDEN=1", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;

      yield* inTempGoldens("1", (dir) =>
        Effect.gen(function* () {
          yield* fs.makeDirectory(dir, { recursive: true }).pipe(Effect.orDie);
          yield* fs
            .writeFileString(`${dir}/rewritten.txt`, "old\n")
            .pipe(Effect.orDie);

          yield* expectGolden("rewritten", "new\n");
          yield* expectGolden("nested/fresh", "fresh\n");

          expect(yield* fs.exists(`${dir}/nested/fresh.txt`)).toBeTruthy();
          expect(
            yield* fs.readFileString(`${dir}/rewritten.txt`).pipe(Effect.orDie)
          ).toBe("new\n");
          expect(
            yield* fs
              .readFileString(`${dir}/nested/fresh.txt`)
              .pipe(Effect.orDie)
          ).toBe("fresh\n");
        })
      );
    }).pipe(Effect.provide(NodeServices.layer))
  );

  it.effect(
    "never spell the product's name: its config folder and name are written as placeholders",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;

        yield* inTempGoldens("1", (dir) =>
          Effect.gen(function* () {
            yield* expectGolden(
              "brand",
              `wrote ${Brand.configDir}/project.ts; next: ${Brand.cli} status, then ${Brand.name} lands it\n`
            );

            expect(yield* fs.exists(`${dir}/brand.txt`)).toBeTruthy();
            expect(
              yield* fs.readFileString(`${dir}/brand.txt`).pipe(Effect.orDie)
            ).toBe(
              "wrote <configDir>/project.ts; next: <brand> status, then <brand> lands it\n"
            );
          })
        );
      }).pipe(Effect.provide(NodeServices.layer))
  );
});
