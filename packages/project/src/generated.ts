/**
 * A project's generated files after a landing: the
 * contribute skill and the AGENTS.md block a stranger's agent reads, kept
 * current without anyone writing them. When a landing changes what they say
 * (the run block, the kinds, the judge closure, anything the generator reads
 * from the policy), the platform follows it with a landing of its own that
 * holds only the regenerated files: never folded into the landing that
 * changed the config ("land only the checked tree"), and never made when
 * nothing they say changed.
 *
 * Host-free and generator-free: the generator comes in as a function
 * (`Generate`), since `packages/project` may not import `@repo/agent-kit`.
 * The platform gives the project its generator through
 * `ProjectGenerator`; a project given none generates nothing.
 */
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

/** One file a generator makes: where it goes, and every byte of it. */
export interface GeneratedFile {
  readonly path: string;
  readonly content: string;
}

/** A file's text in the tree a landing left, if the tree has it. */
export type ReadAt = (path: string) => Effect.Effect<Option.Option<string>>;

/**
 * Every generated file for one policy at one landing. `read` gives a file's
 * text at that landing, for a file the generator writes into rather than
 * over (AGENTS.md, whose text outside its block is the project's own).
 */
export type Generate = (input: {
  readonly project: ProjectName;
  readonly policy: Policy;
  readonly landed: LandedSha;
  readonly read: ReadAt;
}) => Effect.Effect<readonly GeneratedFile[]>;

/** The platform's landing that follows another with the regenerated files. */
export interface FollowUp {
  /** The platform: it writes the files, nobody's answer does. */
  readonly author: Handle;
  /** `Decided-by` the decider whose landing changed what the files say. */
  readonly credits: readonly Credit[];
  /** The files whose text the tree does not hold yet, and only those. */
  readonly files: Array.NonEmptyReadonlyArray<GeneratedFile>;
  /** The whole commit message, trailers included. */
  readonly message: string;
  /** `gen-<landed>`: the same follow-up landed again finds the first one. */
  readonly requestId: RequestId;
}

/**
 * How a host gives a project its generator (`@repo/agent-kit`'s, in the
 * platform). The default makes no files, so a project given none follows
 * no landing with one of its own.
 */
export const ProjectGenerator = Context.Reference<Generate>(
  "project/ProjectGenerator",
  { defaultValue: () => () => Effect.succeed([]) }
);

/** The request a follow-up of the landing at `landed` lands as. */
export const generatedRequestId = (landed: LandedSha) =>
  RequestId.make(`gen-${landed}`);

/** Where the config lives: whoever decides for it decides what the files say. */
const configPath = RepoPath.make(`${Brand.configDir}/project.ts`);

/**
 * Who the follow-up credits: the landing's `Decided-by`, else its author
 * when they decide for the config, else the person who made the project.
 */
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

/** Whether two generations say the same, file for file. */
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
 * The landing that follows `landing` with the regenerated files, or none.
 * None when the generator makes nothing, when the policy before the landing
 * gave the same files as the policy after it (the landing changed nothing
 * they say), or when the landed tree already holds every file as generated
 * (a replay after the follow-up landed, or a landing that brought them).
 * The first adoption has no policy before it, so it is followed unless its
 * tree holds the files already. The same input always gives the same files.
 */
export const generatedFollowUp = (
  input: {
    readonly project: ProjectName;
    /** The person who made the project: credited when no one else decided. */
    readonly initializer: Handle;
    /** The policy before the landing; none for the first adoption. */
    readonly before: Option.Option<Policy>;
    /** The policy read at the landing. */
    readonly after: Policy;
    readonly landing: LandingView;
    /** A file's text at the landed SHA. */
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
