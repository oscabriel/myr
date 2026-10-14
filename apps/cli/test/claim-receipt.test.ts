import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Contracts } from "@repo/protocol/contracts";
import { ClaimView } from "@repo/protocol/domain/claim";
import { keyOf, ProjectName } from "@repo/protocol/ids";
import { unanswered } from "@repo/protocol/testing";
import { gitOk } from "@repo/testkit/git";
import { Effect, FileSystem, Layer, Schema } from "effect";

import { claimReceipt, placeOf } from "../src/render.ts";
import { runProgram } from "./remote-server.ts";

const platform = "https://platform.example.dev";

const project = "oscabriel/datekit";

const ask = "fix-week";

const fork = `${platform}/${project}--${ask}--alice.git`;

const held = Schema.decodeUnknownSync(ClaimView)({
  ask,
  base: "4444444444444444444444444444444444444444",
  checkCommand: "bun test test/asks/fix-week.test.ts",
  claimant: "alice",
  fork: `${keyOf(ProjectName.make(project))}--${ask}--alice`,
  lapsesAt: "2026-10-08T12:00:00.000Z",
  openedAt: "2026-10-07T12:00:00.000Z",
  project,
  remote: fork,
  state: "live",
  warnsAt: "2026-10-07T14:00:00.000Z",
});

const stepsOf = (text: string | undefined) =>
  (text ?? "")
    .split("\n")
    .filter((line) => line.startsWith("  "))
    .map((line) => line.trim());

describe(placeOf, () => {
  it("outside any clone of the project, starts with a clone and names the remote by the brand", () => {
    expect(placeOf(held, [])).toStrictEqual({
      addRemote: true,
      inClone: false,
      remoteName: Brand.slug,
    });
    expect(
      placeOf(held, [
        { name: "origin", url: "https://github.com/someone/other.git" },
      ])
    ).toStrictEqual({
      addRemote: true,
      inClone: false,
      remoteName: Brand.slug,
    });
  });

  it("in a clone of the project, or of one of its forks, clones nothing", () => {
    expect(
      placeOf(held, [{ name: "origin", url: `${platform}/${project}.git` }])
        .inClone
    ).toBeTruthy();
    expect(
      placeOf(held, [
        { name: "origin", url: `${platform}/${project}--me--bob.git` },
      ]).inClone
    ).toBeTruthy();
  });

  it("names the remote after the ask when one of the brand's name already points elsewhere", () => {
    expect(
      placeOf(held, [
        { name: "origin", url: `${platform}/${project}.git` },
        { name: Brand.slug, url: `${platform}/${project}.git` },
      ])
    ).toStrictEqual({
      addRemote: true,
      inClone: true,
      remoteName: `${Brand.slug}-${ask}`,
    });
  });

  it("adds no remote when the brand's already points at the fork", () => {
    expect(placeOf(held, [{ name: Brand.slug, url: fork }])).toStrictEqual({
      addRemote: false,
      inClone: true,
      remoteName: Brand.slug,
    });
  });
});

describe(claimReceipt, () => {
  it("outside a clone: clone, add the remote, fetch, check, push", () => {
    expect(
      stepsOf(
        claimReceipt(held, {
          addRemote: true,
          inClone: false,
          remoteName: Brand.slug,
        }).text
      )
    ).toStrictEqual([
      `git clone ${platform}/${project}.git && cd datekit`,
      `git remote add ${Brand.slug} ${fork}`,
      `git fetch ${Brand.slug}`,
      `${Brand.cli} check`,
      `git push ${Brand.slug} HEAD:main`,
    ]);
  });

  it("in a clone whose brand remote points elsewhere: the ask's own remote, no clone", () => {
    expect(
      stepsOf(
        claimReceipt(held, {
          addRemote: true,
          inClone: true,
          remoteName: `${Brand.slug}-${ask}`,
        }).text
      )
    ).toStrictEqual([
      `git remote add ${Brand.slug}-${ask} ${fork}`,
      `git fetch ${Brand.slug}-${ask}`,
      `${Brand.cli} check`,
      `git push ${Brand.slug}-${ask} HEAD:main`,
    ]);
  });

  it("puts the same steps in the markdown's shell block", () => {
    const view = claimReceipt(held, {
      addRemote: false,
      inClone: true,
      remoteName: Brand.slug,
    });

    expect(view.markdown).toContain(
      ["```sh", `git fetch ${Brand.slug}`, `${Brand.cli} check`].join("\n")
    );
    expect(view.markdown).not.toContain("git clone");
  });
});

const claiming = Layer.mergeAll(
  unanswered,
  Contracts.toLayerHandler("claim", () => Effect.succeed({ claim: held }))
);

describe(`${Brand.cli} claim's receipt`, () => {
  it.live("reads the repo it is printed in", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const outside = yield* fs.makeTempDirectoryScoped();
      const clone = yield* fs.makeTempDirectoryScoped();

      yield* gitOk(clone, "init", "--quiet");
      yield* gitOk(
        clone,
        "remote",
        "add",
        "origin",
        `${platform}/${project}.git`
      );
      yield* gitOk(
        clone,
        "remote",
        "add",
        Brand.slug,
        `${platform}/${project}.git`
      );

      const argv = ["claim", ask, "--project", project];

      const away = yield* runProgram(argv, {
        cwd: outside,
        handlers: claiming,
      });

      const inside = yield* runProgram(argv, {
        cwd: clone,
        handlers: claiming,
      });

      expect({
        away: away.out
          .join("\n")
          .includes(`git clone ${platform}/${project}.git`),
        inside: inside.out
          .join("\n")
          .includes(`git push ${Brand.slug}-${ask} HEAD:main`),
        insideClones: inside.out.join("\n").includes("git clone"),
      }).toStrictEqual({ away: true, inside: true, insideClones: false });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});
