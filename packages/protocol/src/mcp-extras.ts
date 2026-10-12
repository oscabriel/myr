import { Brand } from "@repo/brand";
import { DateTime, Effect, Layer, Option, Schema } from "effect";
import { McpSchema, McpServer } from "effect/ai";

import { Client } from "./contracts.ts";
import type { AskListing } from "./domain/ask.ts";
import type { ProjectListing } from "./domain/front-page.ts";
import { AskId, keyOf, ProjectName, ProjectNameFromKey } from "./ids.ts";
import { Refusal } from "./refusal.ts";
import { explain } from "./render.ts";

const MARKDOWN = "text/markdown";

// By the project's key: a resource template's parameter is one segment, and
// a name has two or three.
const briefUri = (project: ProjectName, ask: AskId) =>
  `${Brand.urlScheme}ask/${keyOf(project)}/${ask}`;

const projectsUri = `${Brand.urlScheme}projects`;

const markdown = (uri: string, text: string) => ({
  contents: [{ mimeType: MARKDOWN, text, uri }],
});

const isRefusal = Schema.is(Refusal);

const refusedAsText = <A, E, R>(read: Effect.Effect<A, E, R>) =>
  Effect.catchIf(read, isRefusal, (refusal) =>
    Effect.fail(
      new McpSchema.InternalError({ message: explain([refusal]).join("\n") })
    )
  );

// Every cell's schema already keeps out `|` and line breaks, so none is escaped.
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

const briefParts = [`${Brand.urlScheme}ask/`, "/", ""];

const briefTemplate: TemplateStringsArray = Object.assign(briefParts, {
  raw: briefParts,
});

const askBrief = McpServer.resource(
  briefTemplate,
  McpSchema.param("project", ProjectNameFromKey),
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
        `A project's open asks: the prompt \`contribute\` with its name, or \`${Brand.cli} asks --project <owner>/<name>\`.`,
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

export const briefResources: Layer.Layer<never, never, Client> = Layer.mergeAll(
  askBrief,
  projectList
);

export interface Skill {
  readonly name: string;
  readonly description: string;
  readonly body: string;
}

const OPEN = "---\n";

const CLOSE = "\n---\n";

const decodeQuoted = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.String)
);

const scalar = (raw: string) =>
  raw.startsWith('"') ? decodeQuoted(raw) : Option.some(raw);

const fieldsOf = (head: string) =>
  new Map(
    head.split("\n").flatMap((line) => {
      const { key, raw } =
        /^(?<key>[a-z-]+): (?<raw>.+)$/u.exec(line)?.groups ?? {};

      return key === undefined || raw === undefined ? [] : [[key, raw]];
    })
  );

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
