import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { agentsBlock, upsertAgentsBlock } from "@repo/agent-kit/agents-block";
import { projectSkill } from "@repo/agent-kit/project-skill";
import { Client } from "@repo/protocol/contracts";
import type { Policy } from "@repo/protocol/domain/policy";
import { RunBlock } from "@repo/protocol/domain/run";
import { Handle, LandedSha, ProjectName } from "@repo/protocol/ids";
import { gitOk } from "@repo/testkit/git";
import { Effect, Exit, FileSystem, Layer, Path, Schema } from "effect";
import { CliOutput } from "effect/cli";
import { TestConsole } from "effect/testing";

import { ConfigBundlerBun, localPolicy } from "../../src/local/local-policy.ts";
import { program } from "../../src/main.ts";
import { OutputPlain } from "../../src/output.ts";
import { SignedOut } from "../signed-out.ts";
import { aCheckRepo, handle, project } from "./fixture.ts";
import type { CheckRepo } from "./fixture.ts";

/** A platform no offline run may call. */
const unreachable = Layer.mock(Client)({});

const services = Layer.mergeAll(
  TestConsole.layer,
  CliOutput.layer(CliOutput.defaultFormatter({ colors: false })),
  unreachable,
  OutputPlain,
  SignedOut
).pipe(Layer.provideMerge(NodeServices.layer));

/** `check --offline --shape-only --json` in the repo: how it ended, and what it printed where. */
const checked = (root: string) =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(
      program(["check", "--dir", root, "--offline", "--shape-only", "--json"])
    );

    const [out = ""] = (yield* TestConsole.logLines).map(String);

    return {
      envelope: yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Json))(
        out
      ),
      err: (yield* TestConsole.errorLines).map(String).join("\n"),
      exit,
    };
  }).pipe(Effect.provide(services));

const name = ProjectName.make(project);

const skill = `.agents/skills/${project}-contribute/SKILL.md`;

/** The landing an older copy of the skill came from. */
const older = LandedSha.make("a".repeat(40));

/** The policy at the fixture's main, as `check` reads it. */
const policyAtMain = (repo: CheckRepo) =>
  localPolicy(repo.root, "main", {
    initializer: Handle.make(handle),
    project: name,
  }).pipe(Effect.provide(ConfigBundlerBun));

/** An older run block: one lane, `ok`, where main has two. */
const olderRun = Schema.decodeSync(RunBlock)({
  checks: { ok: "true" },
  test: "true {path}",
});

/** The policy at main with the older run block. */
const withOlderRun = (policy: Policy): Policy => ({ ...policy, run: olderRun });

/** Writes `content` at `file` in the repo's work tree, leaving it uncommitted. */
const writeFile = (repo: CheckRepo, file: string, content: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const at = path.join(repo.root, file);

    yield* fs.makeDirectory(path.dirname(at), { recursive: true });
    yield* fs.writeFileString(at, content);
  });

/** The fixture with HEAD on its clean answer, which the shape stage passes. */
const cleanRepo = Effect.gen(function* () {
  const repo = yield* aCheckRepo;

  yield* gitOk(repo.root, "checkout", "--quiet", "clean");

  return repo;
});

describe("check, on generated files", () => {
  it.live(
    "notes a contribute skill generated for an older run block, naming it and the landing it came from",
    () =>
      Effect.gen(function* () {
        const repo = yield* cleanRepo;
        const policy = yield* policyAtMain(repo);

        const [copy] = yield* projectSkill({
          landed: older,
          policy: withOlderRun(policy),
          project: name,
        });

        yield* writeFile(repo, skill, copy?.content ?? "");

        const printed = yield* checked(repo.root);

        expect(Exit.isSuccess(printed.exit)).toBeTruthy();
        expect(printed.envelope).toMatchObject({
          data: { stale: [{ landed: older, path: skill }] },
          ok: true,
        });
        expect(printed.err).toContain(`${skill} is out of date`);
        expect(printed.err).toContain(older);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live(
    "notes an AGENTS.md block that is not the one main's policy gives",
    () =>
      Effect.gen(function* () {
        const repo = yield* cleanRepo;
        const policy = yield* policyAtMain(repo);

        const block = yield* agentsBlock({
          landed: older,
          policy: withOlderRun(policy),
          project: name,
        });

        yield* writeFile(
          repo,
          "AGENTS.md",
          upsertAgentsBlock("# Fixture\n\nOur notes.\n", block)
        );

        const printed = yield* checked(repo.root);

        expect(printed.envelope).toMatchObject({
          data: { stale: [{ path: "AGENTS.md" }] },
          ok: true,
        });
        expect(printed.err).toContain("AGENTS.md");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );

  it.live("says nothing of copies generated from main's policy", () =>
    Effect.gen(function* () {
      const repo = yield* cleanRepo;
      const policy = yield* policyAtMain(repo);

      const copies = yield* projectSkill({
        landed: older,
        policy,
        project: name,
      });

      const block = yield* agentsBlock({
        landed: older,
        policy,
        project: name,
      });

      for (const copy of copies) {
        yield* writeFile(repo, copy.path, copy.content);
      }

      yield* writeFile(
        repo,
        "AGENTS.md",
        upsertAgentsBlock("# Fixture\n\nOur notes.\n", block)
      );

      const printed = yield* checked(repo.root);

      expect(Exit.isSuccess(printed.exit)).toBeTruthy();
      expect(printed.envelope).toStrictEqual({
        command: "check",
        data: {
          ask: "fix-a",
          base: repo.main,
          head: repo.clean,
          lanes: [],
          stage: "shape",
        },
        ok: true,
        v: 1,
      });
      expect(printed.err).not.toContain("out of date");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
});
