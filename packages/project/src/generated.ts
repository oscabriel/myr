import { Brand } from "@repo/brand";
import { formatLanding } from "@repo/git/trailers";
import type { Credit } from "@repo/protocol/domain/credit";
import type { LandingView } from "@repo/protocol/domain/landing";
import type { Policy } from "@repo/protocol/domain/policy";
import { RepoPath, RequestId, sameHandle } from "@repo/protocol/ids";
import type { Handle, LandedSha, ProjectName } from "@repo/protocol/ids";
import { Array, Context, Effect, Option } from "effect";

import { decidersFor } from "./attention/decisions.ts";
import { platformHandle } from "./attention/effects.ts";

export interface GeneratedFile {
  readonly path: string;
  readonly content: string;
}

export type ReadAt = (path: string) => Effect.Effect<Option.Option<string>>;

/**
 * `read` is for files written into rather than over (AGENTS.md: text outside
 * its block is the project's own).
 */
export type Generate = (input: {
  readonly project: ProjectName;
  readonly policy: Policy;
  readonly landed: LandedSha;
  readonly read: ReadAt;
}) => Effect.Effect<readonly GeneratedFile[]>;

export interface FollowUp {
  readonly author: Handle;
  readonly credits: readonly Credit[];
  readonly files: Array.NonEmptyReadonlyArray<GeneratedFile>;
  readonly message: string;
  /** The same follow-up landed again finds the first one. */
  readonly requestId: RequestId;
}

/**
 * The default makes no files, so a project given none gets no follow-up
 * landing.
 */
export const ProjectGenerator = Context.Reference<Generate>(
  "project/ProjectGenerator",
  { defaultValue: () => () => Effect.succeed([]) }
);

export const generatedRequestId = (landed: LandedSha) =>
  RequestId.make(`gen-${landed}`);

const configPath = RepoPath.make(`${Brand.configDir}/project.ts`);

const deciderOf = (input: {
  readonly after: Policy;
  readonly initializer: Handle;
  readonly landing: LandingView;
}): Handle => {
  const { author, credits } = input.landing;

  const decided = Array.findFirst(
    credits,
    ({ role }) => role === "Decided-by"
  ).pipe(Option.map(({ handle }) => handle));

  const authorDecides = decidersFor(input.after, [configPath]).some((each) =>
    sameHandle(each, author)
  );

  return Option.getOrElse(
    Option.orElse(decided, () =>
      authorDecides ? Option.some(author) : Option.none()
    ),
    () => input.initializer
  );
};

const sameFiles = (
  one: readonly GeneratedFile[],
  other: readonly GeneratedFile[]
) =>
  one.length === other.length &&
  one.every(
    ({ content, path }, index) =>
      other[index]?.path === path && other[index]?.content === content
  );

const messageOf = (input: {
  readonly credits: readonly Credit[];
  readonly files: readonly GeneratedFile[];
  readonly landed: LandedSha;
  readonly requestId: RequestId;
}) =>
  formatLanding({
    assisted: [],
    body: [
      `The config at ${input.landed} changed what these files say, so the platform wrote them again from it:`,
      "",
      ...input.files.map(({ path }) => `- ${path}`),
    ].join("\n"),
    credits: input.credits,
    requestId: input.requestId,
    subject: "Regenerate the contribute skill and the AGENTS.md block",
  });

/**
 * Never folded into the landing that changed the config: the follow-up holds
 * only the regenerated files, and is none when nothing they say changed.
 */
export const generatedFollowUp = (
  input: {
    readonly project: ProjectName;
    readonly initializer: Handle;
    readonly before: Option.Option<Policy>;
    readonly after: Policy;
    readonly landing: LandingView;
    readonly read: ReadAt;
  },
  generate: Generate
): Effect.Effect<Option.Option<FollowUp>> =>
  Effect.gen(function* () {
    const { landing, project, read } = input;
    const landed = landing.sha;
    const at = (policy: Policy) => generate({ landed, policy, project, read });
    const after = yield* at(input.after);

    if (Option.isSome(input.before)) {
      const before = yield* at(input.before.value);

      if (sameFiles(before, after)) {
        return Option.none();
      }
    }

    const differing = yield* Effect.filter(after, ({ content, path }) =>
      Effect.map(read(path), (held) => !Option.contains(held, content))
    );

    if (!Array.isReadonlyArrayNonEmpty(differing)) {
      return Option.none();
    }

    const credits: readonly Credit[] = [
      { handle: deciderOf(input), role: "Decided-by" },
    ];

    const requestId = generatedRequestId(landed);

    return Option.some({
      author: platformHandle,
      credits,
      files: differing,
      message: messageOf({ credits, files: differing, landed, requestId }),
      requestId,
    });
  });
