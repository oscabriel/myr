import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Effect, Schema } from "effect";

import { agentsBlock, upsertAgentsBlock } from "../src/agents-block.ts";
import type { GeneratedFile } from "../src/generated-file.ts";
import type { HookEvent } from "../src/hook-events.ts";
import { claudeEventOf } from "../src/hook-events.ts";
import {
  agentPluginsBundle,
  claudePlugin,
  platformSkill,
} from "../src/platform.ts";
import { projectSkill } from "../src/project-skill.ts";
import { wellKnownSkills } from "../src/well-known.ts";
import { commands, landed, platformUrl, policy, project } from "./fixtures.ts";
import { expectGolden, transcript } from "./golden.ts";

const plugin = `plugins/${Brand.slug}`;

const skill = `${project}-contribute`;

/** `sha256("hello\n")`, as every tool that hashes prints it. */
const helloDigest =
  "sha256:5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03";

interface Case {
  /** Its golden file: `test/golden/<golden>.txt`. */
  readonly golden: string;
  readonly what: string;
  readonly paths: readonly string[];
  readonly run: Effect.Effect<readonly GeneratedFile[]>;
}

const cases: readonly Case[] = [
  {
    golden: "project-skill",
    paths: [
      `.agents/skills/${skill}/SKILL.md`,
      `.claude/skills/${skill}/SKILL.md`,
    ],
    run: projectSkill({ landed, policy, project }),
    what: "the contribute skill, in both skill folders",
  },
  {
    golden: "agents-block",
    paths: ["AGENTS.md"],
    run: agentsBlock({ landed, policy, project }).pipe(
      Effect.map((block) => [
        { content: upsertAgentsBlock("", block), path: "AGENTS.md" },
      ])
    ),
    what: "the AGENTS.md block, alone in a new AGENTS.md",
  },
  {
    golden: "platform-skill",
    paths: [`skills/${Brand.slug}/SKILL.md`],
    run: platformSkill({ commands, platformUrl }),
    what: "the platform's own skill",
  },
  {
    golden: "claude-plugin",
    paths: [
      `${plugin}/.claude-plugin/plugin.json`,
      `${plugin}/skills/${Brand.slug}/SKILL.md`,
      `${plugin}/.mcp.json`,
      `${plugin}/hooks/hooks.json`,
    ],
    run: claudePlugin({ commands, platformUrl }),
    what: "the Claude Code plugin, reaching the platform's MCP over HTTP",
  },
  {
    golden: "claude-plugin-stdio",
    paths: [
      `${plugin}/.claude-plugin/plugin.json`,
      `${plugin}/skills/${Brand.slug}/SKILL.md`,
      `${plugin}/.mcp.json`,
      `${plugin}/hooks/hooks.json`,
    ],
    run: claudePlugin({ commands }),
    what: "the Claude Code plugin, reaching MCP through the CLI without a URL",
  },
  {
    golden: "agent-plugins",
    paths: [
      `${plugin}/plugin.json`,
      `${plugin}/skills/${Brand.slug}/SKILL.md`,
      `${plugin}/mcp.json`,
    ],
    run: agentPluginsBundle({ commands, platformUrl }),
    what: "the Agent Plugins bundle, reaching the platform's MCP over HTTP",
  },
  {
    golden: "agent-plugins-stdio",
    paths: [
      `${plugin}/plugin.json`,
      `${plugin}/skills/${Brand.slug}/SKILL.md`,
      `${plugin}/mcp.json`,
    ],
    run: agentPluginsBundle({ commands }),
    what: "the Agent Plugins bundle, reaching MCP through the CLI without a URL",
  },
  {
    golden: "well-known",
    paths: [".well-known/agent-skills/index.json"],
    run: wellKnownSkills([
      {
        content: "hello\n",
        description: "Contribute to datekit.",
        name: skill,
        url: `/.well-known/agent-skills/${skill}/SKILL.md`,
      },
      {
        content: "hello\n",
        description: "Contribute to calendar.",
        name: "calendar-contribute",
        url: "/.well-known/agent-skills/calendar-contribute/SKILL.md",
      },
    ]).pipe(Effect.map((file) => [file])),
    what: "the well-known skills index",
  },
];

const byPath = (files: readonly GeneratedFile[], path: string) =>
  files.find((file) => file.path === path)?.content ?? "";

const JsonObject = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Json)
);

const parsed = Schema.decodeSync(JsonObject);

const eventsOf = Schema.decodeUnknownSync(
  Schema.Struct({ hooks: Schema.Record(Schema.String, Schema.Unknown) })
);

/** A SKILL.md's frontmatter keys: top level, and under `metadata`. */
const frontmatterKeys = (content: string) => {
  const [, head = ""] = content.split("---\n");
  const lines = head.split("\n");

  return {
    metadata: lines.flatMap(
      (line) => /^ {2}(?<key>[a-z-]+):/u.exec(line)?.groups?.key ?? []
    ),
    top: lines.flatMap(
      (line) => /^(?<key>[a-z-]+):/u.exec(line)?.groups?.key ?? []
    ),
  };
};

/** The hook entry that runs `<cli> hook <event> --json`. */
const hookCommand = (event: HookEvent) => [
  { command: `${Brand.cli} hook ${event} --json`, type: "command" },
];

describe("each generator", () => {
  for (const { golden, paths, run, what } of cases) {
    it.effect(`makes ${what}, as its golden file holds it`, () =>
      Effect.gen(function* () {
        const files = yield* run;

        expect(files.map(({ path }) => path)).toStrictEqual(paths);

        yield* expectGolden(golden, transcript(files));
      }).pipe(Effect.provide(NodeServices.layer))
    );

    it.effect(`makes ${what} the same way twice`, () =>
      Effect.gen(function* () {
        const first = yield* run;
        const second = yield* run;

        expect(first.length).toBeGreaterThan(0);
        expect(second).toStrictEqual(first);
      })
    );
  }
});

describe("the contribute skill", () => {
  it.effect("is the same file in .agents and in .claude", () =>
    Effect.gen(function* () {
      const [agents, claude] = yield* projectSkill({
        landed,
        policy,
        project,
      });

      expect(agents?.content).toBeDefined();
      expect(claude?.content).toBe(agents?.content);
    })
  );
});

describe("every SKILL.md", () => {
  const skills = Effect.all([
    projectSkill({ landed, policy, project }),
    platformSkill({ commands }),
    claudePlugin({ commands }),
    agentPluginsBundle({ commands }),
  ]).pipe(
    Effect.map((all) =>
      all.flat().filter(({ path }) => path.endsWith("/SKILL.md"))
    )
  );

  it.effect(
    "keeps to the Agent Skills spec's six fields, with who manages it and its hash under metadata",
    () =>
      Effect.gen(function* () {
        const files = yield* skills;

        expect(files.length).toBeGreaterThan(0);

        expect(
          files.map(({ content, path }) => {
            const { metadata, top } = frontmatterKeys(content);

            return {
              managed: ["managed-by", "content-hash"].every((key) =>
                metadata.includes(key)
              ),
              path,
              top,
            };
          })
        ).toStrictEqual(
          files.map(({ path }) => ({
            managed: true,
            path,
            top: ["name", "description", "metadata"],
          }))
        );
      })
  );

  it.effect("names the landing it came from when it came from one", () =>
    Effect.gen(function* () {
      const [contribute] = yield* projectSkill({ landed, policy, project });
      const [own] = yield* platformSkill({ commands });

      expect(frontmatterKeys(contribute?.content ?? "").metadata).toStrictEqual(
        ["managed-by", "landed", "content-hash"]
      );
      expect(frontmatterKeys(own?.content ?? "").metadata).toStrictEqual([
        "managed-by",
        "content-hash",
      ]);
    })
  );
});

describe("the Claude Code plugin's hooks", () => {
  it.effect(
    "send PreToolUse on edits, Stop and SessionStart to the CLI's hook command",
    () =>
      Effect.gen(function* () {
        const files = yield* claudePlugin({ commands });

        expect(files.map(({ path }) => path)).toContain(
          `${plugin}/hooks/hooks.json`
        );

        const hooks = parsed(byPath(files, `${plugin}/hooks/hooks.json`));

        expect(hooks).toStrictEqual({
          hooks: {
            [claudeEventOf["pre-tool-use"]]: [
              {
                hooks: hookCommand("pre-tool-use"),
                matcher: "Edit|Write|MultiEdit|NotebookEdit",
              },
            ],
            [claudeEventOf["session-start"]]: [
              { hooks: hookCommand("session-start") },
            ],
            [claudeEventOf.stop]: [{ hooks: hookCommand("stop") }],
          },
        });
        expect(Object.keys(eventsOf(hooks).hooks).toSorted()).toStrictEqual([
          "PreToolUse",
          "SessionStart",
          "Stop",
        ]);
      })
  );
});

describe("the MCP entries", () => {
  it.effect("reach the platform's /mcp when given a URL", () =>
    Effect.gen(function* () {
      const claude = yield* claudePlugin({ commands, platformUrl });
      const portable = yield* agentPluginsBundle({ commands, platformUrl });

      expect([...claude, ...portable].map(({ path }) => path)).toStrictEqual(
        expect.arrayContaining([`${plugin}/.mcp.json`, `${plugin}/mcp.json`])
      );

      expect(parsed(byPath(claude, `${plugin}/.mcp.json`))).toStrictEqual({
        mcpServers: {
          [Brand.slug]: { type: "http", url: `${platformUrl}/mcp` },
        },
      });
      expect(parsed(byPath(portable, `${plugin}/mcp.json`))).toStrictEqual({
        $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
        mcpServers: {
          [Brand.slug]: { type: "streamable-http", url: `${platformUrl}/mcp` },
        },
      });
    })
  );

  it.effect("run the CLI's mcp command without one", () =>
    Effect.gen(function* () {
      const claude = yield* claudePlugin({ commands });
      const portable = yield* agentPluginsBundle({ commands });

      expect([...claude, ...portable].map(({ path }) => path)).toStrictEqual(
        expect.arrayContaining([`${plugin}/.mcp.json`, `${plugin}/mcp.json`])
      );

      expect(parsed(byPath(claude, `${plugin}/.mcp.json`))).toStrictEqual({
        mcpServers: { [Brand.slug]: { args: ["mcp"], command: Brand.cli } },
      });
      expect(parsed(byPath(portable, `${plugin}/mcp.json`))).toStrictEqual({
        $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
        mcpServers: {
          [Brand.slug]: { args: ["mcp"], command: Brand.cli, type: "stdio" },
        },
      });
    })
  );
});

describe("the well-known skills index", () => {
  it.effect(
    "lists each skill by name with the SHA-256 digest of its file",
    () =>
      Effect.gen(function* () {
        const index = yield* wellKnownSkills([
          {
            content: "hello\n",
            description: "Say hello.",
            name: "hello",
            url: "/.well-known/agent-skills/hello/SKILL.md",
          },
        ]);

        expect(index.path).toBe(".well-known/agent-skills/index.json");
        expect(parsed(index.content)).toStrictEqual({
          $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
          skills: [
            {
              description: "Say hello.",
              digest: helloDigest,
              name: "hello",
              type: "skill-md",
              url: "/.well-known/agent-skills/hello/SKILL.md",
            },
          ],
        });
      })
  );

  it.effect("cuts a description to the 1024 characters the index allows", () =>
    Effect.gen(function* () {
      const index = yield* wellKnownSkills([
        {
          content: "hello\n",
          description: "a".repeat(2000),
          name: "hello",
          url: "/.well-known/agent-skills/hello/SKILL.md",
        },
      ]);

      expect(index.path).toBe(".well-known/agent-skills/index.json");

      const { skills } = yield* Schema.decodeUnknownEffect(
        Schema.Struct({
          skills: Schema.Array(Schema.Struct({ description: Schema.String })),
        })
      )(parsed(index.content));

      const [entry] = skills;

      expect(entry?.description).toHaveLength(1024);
      expect(entry?.description.endsWith("a…")).toBeTruthy();
    })
  );
});
