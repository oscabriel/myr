/**
 * The projects' contribute skills where agents look for skills (issue 505,
 * spec D12): `/.well-known/agent-skills/index.json`, in the Agent Skills
 * discovery shape (`wellKnownSkills`), lists every project whose landed
 * tree holds `.agents/skills/<project>-contribute/SKILL.md`, with the
 * SHA-256 of the file's bytes, and
 * `/.well-known/agent-skills/<project>-contribute/SKILL.md` serves that
 * file as it landed. Nothing is generated here: the platform serves what
 * landed (W4 410 lands the regenerated skill). The web host forwards these
 * paths unchanged, and the index's URLs are path-absolute, so they work on
 * either host.
 *
 * Projects come from the front page (`listProjects` reads the same), each
 * read at its landed SHA: the mirror ref the platform moves after each of
 * its own landings (spec D22), or `main` for a project whose only landing
 * is its initializer's first push, which writes no mirror.
 */
import {
  contributeDescription,
  contributeSkillName,
  contributeSkillPaths,
} from "@repo/agent-kit/project-skill";
import { wellKnownSkills } from "@repo/agent-kit/well-known";
import { RefName, RepoHost, Revision } from "@repo/artifacts/repo-host";
import { FrontPage } from "@repo/project/front-page";
import { landedRef } from "@repo/project/lander";
import { ProjectName, RepoName, RepoPath } from "@repo/protocol/ids";
import type { Layer } from "effect";
import { Array as Arr, Context, Effect, Option, Order, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

/** Where the index and the skills are served. */
const ROOT = "/.well-known/agent-skills";

const INDEX = `${ROOT}/index.json`;

/** The suffix every contribute skill's name ends in (`contributeSkillName`). */
const CONTRIBUTE = "-contribute";

/** How many projects are read at once while the index is made. */
const FAN_OUT = 8;

/** A minute: the index changes only when a landing changes a skill. */
const BRIEFLY = "public, max-age=60";

const notFound = () =>
  new Response(null, { headers: { "cache-control": "no-store" }, status: 404 });

/** Where a project's skill is served, path-absolute. */
const skillUrl = (project: ProjectName) =>
  `${ROOT}/${contributeSkillName(project)}/SKILL.md`;

const mainRef = RefName.make("refs/heads/main");

/** UTF-8 that round-trips byte for byte, so the digest is the file's. */
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** The bytes as text, unless they are not UTF-8. */
const textOf = (bytes: Uint8Array) =>
  Option.liftThrowable(() => utf8.decode(bytes))();

/**
 * A project's contribute skill as it landed: none for a project never
 * made, one with no landing, or one whose landed tree has no such file.
 */
const landedSkill = (
  project: ProjectName
): Effect.Effect<Option.Option<string>, never, RepoHost> =>
  Effect.gen(function* () {
    const host = yield* RepoHost;
    const repo = RepoName.make(project);
    const refs = yield* host.refs(repo);

    const landed = Option.orElse(
      Option.fromUndefinedOr(refs.get(landedRef)),
      () => Option.fromUndefinedOr(refs.get(mainRef))
    );

    if (Option.isNone(landed)) {
      return Option.none();
    }

    const [path] = contributeSkillPaths(project);

    const bytes = yield* host.readFile(
      repo,
      Revision.Commit({ sha: landed.value }),
      RepoPath.make(path)
    );

    return Option.flatMap(bytes, textOf);
  }).pipe(Effect.catchTag("RepoNotFound", () => Effect.succeedNone));

const decodeQuoted = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.String)
);

/**
 * The `description` a skill's frontmatter gives, as agent-kit writes it (a
 * JSON-quoted string) or as a plain scalar; none without one.
 */
const describedIn = (file: string) => {
  const head = /^---\n(?<head>[\s\S]*?)\n---\n/u.exec(file)?.groups?.head;

  const line = (head ?? "")
    .split("\n")
    .find((each) => each.startsWith("description: "));

  const raw = line?.slice("description: ".length).trim() ?? "";

  if (raw === "") {
    return Option.none<string>();
  }

  return raw.startsWith('"') ? decodeQuoted(raw) : Option.some(raw);
};

const decodeProject = Schema.decodeUnknownOption(ProjectName);

/** The index: every listed project's landed skill, by name. */
const index = Effect.gen(function* () {
  const listed = yield* FrontPage.use((frontPage) => frontPage.projects());

  const projects = Arr.sort(
    Arr.dedupe(listed.map(({ project }) => project)),
    Order.String
  );

  const found = yield* Effect.forEach(
    projects,
    (project) =>
      Effect.map(
        landedSkill(project),
        Option.map((content) => ({
          content,
          description: Option.getOrElse(describedIn(content), () =>
            contributeDescription(project)
          ),
          name: contributeSkillName(project),
          url: skillUrl(project),
        }))
      ),
    { concurrency: FAN_OUT }
  );

  const file = yield* wellKnownSkills(Arr.getSomes(found));

  return new Response(file.content, {
    headers: { "cache-control": BRIEFLY, "content-type": "application/json" },
  });
});

/** The project whose skill `name` names: `<project>-contribute`. */
const projectNamed = (name: string) =>
  name.endsWith(CONTRIBUTE)
    ? decodeProject(name.slice(0, -CONTRIBUTE.length))
    : Option.none();

/** One project's skill file, as it landed. */
const skillFile = (project: ProjectName) =>
  Effect.map(
    landedSkill(project),
    Option.match({
      onNone: notFound,
      onSome: (content) =>
        new Response(content, {
          headers: {
            "cache-control": BRIEFLY,
            "content-type": "text/markdown; charset=utf-8",
          },
        }),
    })
  );

/**
 * `/.well-known/agent-skills/*`: the index, or one project's skill; 404
 * for any other path under it, read from the request's own path, however
 * the router matched it.
 */
export const agentSkills = (
  request: Request
): Effect.Effect<Response, never, FrontPage | RepoHost> => {
  const { pathname } = new URL(request.url);

  if (pathname === INDEX) {
    return index;
  }

  const [name = "", file = "", ...rest] = pathname
    .slice(ROOT.length + 1)
    .split("/");

  const project = projectNamed(name);

  if (
    !pathname.startsWith(`${ROOT}/`) ||
    file !== "SKILL.md" ||
    rest.length > 0 ||
    Option.isNone(project)
  ) {
    return Effect.succeed(notFound());
  }

  return skillFile(project.value);
};

/** The skills are only read here; anything but GET and HEAD is refused. */
const readOnly = HttpServerResponse.empty({
  headers: { allow: "GET, HEAD", "cache-control": "no-store" },
  status: 405,
});

/**
 * `/.well-known/agent-skills/*` on the platform's router, for anyone: GET
 * and HEAD (the router serves HEAD as GET, without the body) through
 * `agentSkills`, with the front page and the repos taken once when the
 * router is built.
 */
export const agentSkillRoutes: Layer.Layer<
  never,
  never,
  HttpRouter.HttpRouter | FrontPage | RepoHost
> = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const services = Context.make(FrontPage, yield* FrontPage).pipe(
      Context.add(RepoHost, yield* RepoHost)
    );

    yield* router.add("*", `${ROOT}/*`, (request) =>
      request.method !== "GET" && request.method !== "HEAD"
        ? Effect.succeed(readOnly)
        : HttpServerRequest.toWeb(request).pipe(
            Effect.flatMap((web) => Effect.provide(agentSkills(web), services)),
            Effect.map(HttpServerResponse.fromWeb),
            Effect.orElseSucceed(() =>
              HttpServerResponse.empty({ status: 400 })
            )
          )
    );
  })
);
