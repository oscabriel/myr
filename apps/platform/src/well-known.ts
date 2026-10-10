/**
 * The projects' contribute skills where agents look for skills:
 * `/.well-known/agent-skills/index.json`, in the Agent Skills discovery shape
 * (`wellKnownSkills`), lists every project whose landed tree holds
 * `.agents/skills/<project>-contribute/SKILL.md`, with the SHA-256 of the
 * file's bytes, and `/.well-known/agent-skills/<project>-contribute/SKILL.md`
 * serves that file as it landed. Nothing is generated here: the platform serves
 * what landed (a follow-up landing lands the regenerated skill). The web host
 * forwards these paths unchanged, and the index's URLs are path-absolute, so
 * they work on either host.
 *
 * Projects come from the front page (`listProjects` reads the same), each
 * read at its landed SHA as its own record says it (`ProjectApi.head`: its
 * last landing, or its initializer's first push); for a project whose
 * record names none, at its repo's refs: the mirror ref the platform moves
 * after each of its own landings, or `main`.
 *
 * What a landed commit holds never changes, so each project's skill (or
 * that it has none) is kept by its landed SHA, in the isolate's code cache
 * and in the code store (`<repo>/skill/v<SKILL_VERSION>/<sha>`): a request
 * costs one record read per project, and a file read only for a project
 * whose main moved.
 */
import { describedIn } from "@repo/agent-kit/generated-file";
import {
  contributeDescription,
  contributeSkillName,
  contributeSkillPaths,
} from "@repo/agent-kit/project-skill";
import { wellKnownSkills } from "@repo/agent-kit/well-known";
import { RefName, RepoHost, Revision } from "@repo/artifacts/repo-host";
import { CodeStore } from "@repo/project/code-store";
import { CodeCache } from "@repo/project/code/cache";
import { FrontPage } from "@repo/project/front-page";
import { landedRef } from "@repo/project/lander";
import { Projects } from "@repo/project/projects";
import { ProjectName, RepoName, RepoPath } from "@repo/protocol/ids";
import type { CommitSha } from "@repo/protocol/ids";
import type { Layer } from "effect";
import {
  Array as Arr,
  Cause,
  Context,
  Effect,
  Option,
  Order,
  Schema,
} from "effect";
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

/** The kept skill's version, in its key: it moves when what is kept changes. */
const SKILL_VERSION = 1;

/** A project's skill at a landed commit as the store keeps it: its text, or none. */
const KeptSkill = Schema.fromJsonString(
  Schema.Struct({ content: Schema.optionalKey(Schema.String) })
);

const decodeKept = Schema.decodeOption(KeptSkill);

const encodeKept = Schema.encodeEffect(KeptSkill);

/**
 * Where `project`'s main landed: as its record says, or, for a project whose
 * record names none (or that the platform never made), at its repo's refs.
 */
const landedOf = (
  project: ProjectName
): Effect.Effect<Option.Option<CommitSha>, never, Projects | RepoHost> =>
  Effect.gen(function* () {
    const projects = yield* Projects;

    const recorded = yield* Effect.suspend(() => projects.get(project)).pipe(
      Effect.flatMap((api) => api.head()),
      Effect.map(({ landed }) => Option.fromUndefinedOr(landed)),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause) ? Effect.interrupt : Effect.succeedNone
      )
    );

    if (Option.isSome(recorded)) {
      return Option.some<CommitSha>(recorded.value);
    }

    const host = yield* RepoHost;
    const refs = yield* host.refs(RepoName.make(project));

    return Option.orElse(Option.fromUndefinedOr(refs.get(landedRef)), () =>
      Option.fromUndefinedOr(refs.get(mainRef))
    );
  }).pipe(Effect.catchTag("RepoNotFound", () => Effect.succeedNone));

/** `project`'s skill file at `landed`, read from its repo: none when it has none. */
const skillAt = (project: ProjectName, landed: CommitSha) =>
  Effect.gen(function* () {
    const host = yield* RepoHost;
    const [path] = contributeSkillPaths(project);

    const bytes = yield* host.readFile(
      RepoName.make(project),
      Revision.Commit({ sha: landed }),
      RepoPath.make(path)
    );

    return Option.flatMap(bytes, textOf);
  }).pipe(Effect.catchTag("RepoNotFound", () => Effect.succeedNone));

/**
 * `project`'s skill at `landed`: the isolate's cache first, then the code
 * store, then its repo, whose answer is kept in both. A store that fails is
 * a miss.
 */
const keptSkillAt = (project: ProjectName, landed: CommitSha) =>
  Effect.gen(function* () {
    const cache = yield* CodeCache;
    const store = yield* CodeStore;
    const key = `${RepoName.make(project)}/skill/v${SKILL_VERSION}/${landed}`;

    return yield* cache.through(
      key,
      Effect.gen(function* () {
        const kept = Option.flatMap(yield* store.get(key), decodeKept);

        if (Option.isSome(kept)) {
          return Option.fromUndefinedOr(kept.value.content);
        }

        const read = yield* skillAt(project, landed);

        yield* encodeKept(
          Option.match(read, {
            onNone: () => ({}),
            onSome: (content) => ({ content }),
          })
        ).pipe(
          Effect.flatMap((text) => store.put(key, text)),
          Effect.catch((error) =>
            Effect.logWarning(`${project}'s skill was not kept`, error)
          )
        );

        return read;
      })
    );
  });

/**
 * A project's contribute skill as it landed: none for a project never
 * made, one with no landing, or one whose landed tree has no such file.
 */
const landedSkill = (
  project: ProjectName
): Effect.Effect<Option.Option<string>, never, Projects | RepoHost> =>
  Effect.flatMap(landedOf(project), (landed) =>
    Option.match(landed, {
      onNone: () => Effect.succeedNone,
      onSome: (sha) => keptSkillAt(project, sha),
    })
  );

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
): Effect.Effect<Response, never, FrontPage | Projects | RepoHost> => {
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
 * `agentSkills`, with the front page, the projects, the repos and the
 * code reads' cache and store taken once when the router is built (the
 * last two are `Context.Reference`s: without them every request reads
 * every file).
 */
export const agentSkillRoutes: Layer.Layer<
  never,
  never,
  HttpRouter.HttpRouter | FrontPage | Projects | RepoHost
> = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const services = Context.make(FrontPage, yield* FrontPage).pipe(
      Context.add(Projects, yield* Projects),
      Context.add(RepoHost, yield* RepoHost),
      Context.add(CodeCache, yield* CodeCache),
      Context.add(CodeStore, yield* CodeStore)
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
