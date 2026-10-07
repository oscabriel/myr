/**
 * What MCP serves beside the contracts' tools (spec §3.3): each ask's brief
 * as a resource at `<scheme>ask/<project>/<ask>`, the projects as one at
 * `<scheme>projects`, and a skill as the prompt `contribute`. Each reads
 * through the `Client` the tools call through, so a host that sends the
 * tools' calls as its caller sends these as the caller too. A refusal comes
 * back as an MCP error whose message is the refusal as `render` explains it
 * to git and the CLI.
 *
 * The skill is an argument: protocol never imports the generator that
 * writes it (`@repo/agent-kit`); each app passes the one it made.
 */
import { Brand } from "@repo/brand";
import { DateTime, Effect, Layer, Option, Schema } from "effect";
import { McpSchema, McpServer } from "effect/ai";

import { Client } from "./contracts.ts";
import type { AskListing } from "./domain/ask.ts";
import type { ProjectListing } from "./domain/front-page.ts";
import { AskId, ProjectName } from "./ids.ts";
import { Refusal } from "./refusal.ts";
import { explain } from "./render.ts";

const MARKDOWN = "text/markdown";

/** Where an ask's brief is read: `<scheme>ask/<project>/<ask>`. */
const briefUri = (project: ProjectName, ask: AskId) =>
  `${Brand.urlScheme}ask/${project}/${ask}`;

/** Where the platform's projects are read. */
const projectsUri = `${Brand.urlScheme}projects`;

/** One resource's text, as Markdown. */
const markdown = (uri: string, text: string) => ({
  contents: [{ mimeType: MARKDOWN, text, uri }],
});

const isRefusal = Schema.is(Refusal);

/**
 * A refusal as the MCP error a read fails with: its message is what
 * `render` says of it, tag first, so the client reads the same lines git
 * and the CLI print. Any other failure is left to the server.
 */
const refusedAsText = <A, E, R>(read: Effect.Effect<A, E, R>) =>
  Effect.catchIf(read, isRefusal, (refusal) =>
    Effect.fail(
      new McpSchema.InternalError({ message: explain([refusal]).join("\n") })
    )
  );

/**
 * The projects as a Markdown table. Every cell is a decoded value whose
 * schema already keeps out `|` and line breaks (a `ProjectName`, a
 * `Posture`, a count, an ISO time), so none needs escaping.
 */
const projectsTable = (projects: readonly ProjectListing[]) =>
  projects.length === 0
    ? "No projects yet."
    : [
        "| project | posture | open asks | landed |",
        "| --- | --- | --- | --- |",
        ...projects.map(
          ({ landedAt, openAsks, posture, project }) =>
            `| ${[
              project,
              posture,
              String(openAsks),
              landedAt === undefined ? "never" : DateTime.formatIso(landedAt),
            ].join(" | ")} |`
        ),
      ].join("\n");

/**
 * The URI template of a brief: the tagged-template parts of
 * `<scheme>ask/{project}/{ask}`. The scheme is a value, so it joins the
 * first part rather than being a parameter.
 */
const briefParts = [`${Brand.urlScheme}ask/`, "/", ""];

const briefTemplate: TemplateStringsArray = Object.assign(briefParts, {
  raw: briefParts,
});

/** An ask's brief, read as `showAsk` gives it. */
const askBrief = McpServer.resource(
  briefTemplate,
  McpSchema.param("project", ProjectName),
  McpSchema.param("ask", AskId)
)({
  content: (uri, project, ask) =>
    Effect.gen(function* () {
      const client = yield* Client;
      const { brief } = yield* client.showAsk({ ask, project });

      return markdown(uri, brief);
    }).pipe(refusedAsText),
  description:
    "An ask's brief, in Markdown: what an answerer reads before claiming it.",
  mimeType: MARKDOWN,
  name: "ask brief",
});

/** Every project, as `listProjects` gives them. */
const projectList = McpServer.resource({
  content: Effect.gen(function* () {
    const client = yield* Client;
    const { projects } = yield* client.listProjects({});

    return markdown(
      projectsUri,
      [
        "# Projects",
        "",
        projectsTable(projects),
        "",
        `A project's open asks: the prompt \`contribute\` with its name, or \`${Brand.cli} asks --project <project>\`.`,
        "",
      ].join("\n")
    );
  }).pipe(refusedAsText),
  description:
    "Every project on the platform, with its posture and how many asks it has open.",
  mimeType: MARKDOWN,
  name: "projects",
  uri: projectsUri,
});

/** Each ask's brief, and the projects, as resources over the `Client`. */
export const briefResources: Layer.Layer<never, never, Client> = Layer.mergeAll(
  askBrief,
  projectList
);

// --- The skill as a prompt ----------------------------------------------------

/** A skill, as the prompt `contribute` serves it. */
export interface Skill {
  readonly name: string;
  readonly description: string;
  /** Its Markdown, after the frontmatter. */
  readonly body: string;
}

const OPEN = "---\n";

const CLOSE = "\n---\n";

const decodeQuoted = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.String)
);

/** A frontmatter value: a double-quoted one as JSON reads it, a plain one as it stands. */
const scalar = (raw: string) =>
  raw.startsWith('"') ? decodeQuoted(raw) : Option.some(raw);

/** The frontmatter's top-level `key: value` lines, by key. */
const fieldsOf = (head: string) =>
  new Map(
    head.split("\n").flatMap((line) => {
      const { key, raw } =
        /^(?<key>[a-z-]+): (?<raw>.+)$/u.exec(line)?.groups ?? {};

      return key === undefined || raw === undefined ? [] : [[key, raw]];
    })
  );

/**
 * A skill as its `SKILL.md` states it (Agent Skills frontmatter, as
 * `@repo/agent-kit` writes it): the frontmatter's `name` and `description`,
 * and the Markdown after it. None for a file without them.
 */
const skillOf = (file: string): Option.Option<Skill> => {
  const close = file.startsWith(OPEN)
    ? file.indexOf(CLOSE, OPEN.length - 1)
    : -1;

  if (close === -1) {
    return Option.none();
  }

  const fields = fieldsOf(file.slice(OPEN.length, close));

  const field = (key: string) =>
    Option.flatMap(Option.fromNullishOr(fields.get(key)), scalar);

  return Option.all({
    body: Option.some(file.slice(close + CLOSE.length)),
    description: field("description"),
    name: field("name"),
  });
};

/**
 * The skill in the one `SKILL.md` a generator makes, such as agent-kit's
 * `platformSkill`. A generator that writes none, or one without its
 * frontmatter, is a defect.
 */
export const skillIn = <E, R>(
  generated: Effect.Effect<readonly { readonly content: string }[], E, R>
): Effect.Effect<Skill, E, R> =>
  Effect.flatMap(generated, ([file]) =>
    Option.match(
      Option.flatMap(Option.fromNullishOr(file), ({ content }) =>
        skillOf(content)
      ),
      {
        onNone: () =>
          Effect.die("the generator made no SKILL.md with its frontmatter"),
        onSome: Effect.succeed,
      }
    )
  );

/** One open ask, as the prompt lists it: its want, its kind and territory, and where its brief is. */
const askLines =
  (project: ProjectName) =>
  ({ ask, blockedBy, claimed, kind, territory, want }: AskListing) => {
    const notes = [
      kind,
      `in ${territory}`,
      ...(claimed ? ["claimed"] : []),
      ...(blockedBy.length === 0 ? [] : [`waits on ${blockedBy.join(", ")}`]),
    ];

    return [
      `- \`${ask}\` (${notes.join("; ")}): ${want}`,
      `  Brief: \`${briefUri(project, ask)}\``,
    ];
  };

/** A project's open asks, as a section after the skill. */
const openAsks = (project: ProjectName) =>
  Effect.gen(function* () {
    const client = yield* Client;
    const { asks } = yield* client.listAsks({ project });

    return [
      `## Open asks in ${project}`,
      "",
      ...(asks.length === 0
        ? [`${project} has no open asks.`]
        : [
            ...asks.flatMap(askLines(project)),
            "",
            `Claim one with \`${Brand.cli} claim <ask> --project ${project}\`.`,
          ]),
      "",
    ].join("\n");
  });

/**
 * The prompt `contribute`: the skill's Markdown, and, when the client names
 * a project, that project's open asks after it.
 */
export const skillPrompt = (skill: Skill): Layer.Layer<never, never, Client> =>
  McpServer.prompt({
    content: ({ project }) =>
      project === undefined
        ? Effect.succeed(skill.body)
        : openAsks(project).pipe(
            Effect.map((section) => `${skill.body}\n${section}`),
            refusedAsText
          ),
    description: skill.description,
    name: "contribute",
    parameters: {
      project: Schema.optionalKey(
        ProjectName.annotate({
          description: "A project whose open asks to list after the skill",
        })
      ),
    },
    title: `Contribute (the ${skill.name} skill)`,
  });
