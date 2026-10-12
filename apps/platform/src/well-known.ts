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
import {
  keyOf,
  nameOfKey,
  ProjectKey,
  RepoName,
  RepoPath,
} from "@repo/protocol/ids";
import type { ProjectName, CommitSha } from "@repo/protocol/ids";
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

const ROOT = "/.well-known/agent-skills";

const INDEX = `${ROOT}/index.json`;

const CONTRIBUTE = "-contribute";

const FAN_OUT = 8;

const BRIEFLY = "public, max-age=60";

const notFound = () =>
  new Response(null, { headers: { "cache-control": "no-store" }, status: 404 });

const skillUrl = (project: ProjectName) =>
  `${ROOT}/${contributeSkillName(project)}/SKILL.md`;

const mainRef = RefName.make("refs/heads/main");

// UTF-8 that round-trips byte for byte, so the digest is the file's.
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

const textOf = (bytes: Uint8Array) =>
  Option.liftThrowable(() => utf8.decode(bytes))();

const SKILL_VERSION = 1;

const KeptSkill = Schema.fromJsonString(
  Schema.Struct({ content: Schema.optionalKey(Schema.String) })
);

const decodeKept = Schema.decodeOption(KeptSkill);

const encodeKept = Schema.encodeEffect(KeptSkill);

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
    const refs = yield* host.refs(RepoName.make(keyOf(project)));

    return Option.orElse(Option.fromUndefinedOr(refs.get(landedRef)), () =>
      Option.fromUndefinedOr(refs.get(mainRef))
    );
  }).pipe(Effect.catchTag("RepoNotFound", () => Effect.succeedNone));

const skillAt = (project: ProjectName, landed: CommitSha) =>
  Effect.gen(function* () {
    const host = yield* RepoHost;
    const [path] = contributeSkillPaths(project);

    const bytes = yield* host.readFile(
      RepoName.make(keyOf(project)),
      Revision.Commit({ sha: landed }),
      RepoPath.make(path)
    );

    return Option.flatMap(bytes, textOf);
  }).pipe(Effect.catchTag("RepoNotFound", () => Effect.succeedNone));

const keptSkillAt = (project: ProjectName, landed: CommitSha) =>
  Effect.gen(function* () {
    const cache = yield* CodeCache;
    const store = yield* CodeStore;
    const key = `${keyOf(project)}/skill/v${SKILL_VERSION}/${landed}`;

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

const landedSkill = (
  project: ProjectName
): Effect.Effect<Option.Option<string>, never, Projects | RepoHost> =>
  Effect.flatMap(landedOf(project), (landed) =>
    Option.match(landed, {
      onNone: () => Effect.succeedNone,
      onSome: (sha) => keptSkillAt(project, sha),
    })
  );

const decodeKey = Schema.decodeUnknownOption(ProjectKey);

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

const projectNamed = (name: string) =>
  name.endsWith(CONTRIBUTE)
    ? Option.flatMap(decodeKey(name.slice(0, -CONTRIBUTE.length)), nameOfKey)
    : Option.none();

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

const readOnly = HttpServerResponse.empty({
  headers: { allow: "GET, HEAD", "cache-control": "no-store" },
  status: 405,
});

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
