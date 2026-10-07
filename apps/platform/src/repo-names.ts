/**
 * What a repo's name says it is (spec §4.5): a project's canonical repo
 * `<project>`, a claim's fork `<project>--<ask>--<handle>`, or a person's
 * working fork `<project>--me--<handle>`, each handle in lowercase. `--`
 * occurs in no project or ask name, so a name splits back into its parts.
 * Pure: the gateway (303), the handlers (312) and OnPush (313) read names
 * with it.
 */
import { forkName } from "@repo/project/claim";
import { AskId, Handle, ProjectName, RepoName } from "@repo/protocol/ids";
import { Data, Option, Schema } from "effect";

/** What a repo is, read from its name alone. */
export type RepoKind =
  | { readonly _tag: "Canonical"; readonly project: ProjectName }
  | {
      readonly _tag: "ClaimFork";
      readonly project: ProjectName;
      readonly ask: AskId;
      /** As the name spells it: in lowercase. */
      readonly handle: Handle;
    }
  | {
      readonly _tag: "WorkingFork";
      readonly project: ProjectName;
      /** As the name spells it: in lowercase. */
      readonly handle: Handle;
    }
  | { readonly _tag: "Unknown" };

export const RepoKind = Data.taggedEnum<RepoKind>();

const asProject = Schema.decodeOption(ProjectName);

const asAsk = Schema.decodeOption(AskId);

const asHandle = Schema.decodeOption(Handle);

/** The word that names a working fork where a claim's fork names its ask. */
const WORKING = "me";

/** What `name` says it is; `Unknown` for any name the platform never makes. */
export const repoKind = (name: RepoName): RepoKind => {
  const [first = "", second, third, ...rest] = name.split("--");

  const kind = Option.flatMap(
    asProject(first),
    (project): Option.Option<RepoKind> => {
      if (second === undefined) {
        return Option.some(RepoKind.Canonical({ project }));
      }

      if (third === undefined || rest.length > 0) {
        return Option.none();
      }

      const handle = Option.filter(
        asHandle(third),
        (spelled) => spelled === spelled.toLowerCase()
      );

      return second === WORKING
        ? Option.map(handle, (owner) =>
            RepoKind.WorkingFork({ handle: owner, project })
          )
        : Option.map(
            Option.all({ ask: asAsk(second), handle }),
            ({ ask, handle: claimant }) =>
              RepoKind.ClaimFork({ ask, handle: claimant, project })
          );
    }
  );

  return Option.getOrElse(kind, () => RepoKind.Unknown());
};

/** A claim's fork: `<project>--<ask>--<handle in lowercase>`. */
export const claimForkName: (
  project: ProjectName,
  ask: AskId,
  handle: Handle
) => RepoName = forkName;

/** A person's working fork: `<project>--me--<handle in lowercase>`. */
export const workingForkName = (project: ProjectName, handle: Handle) =>
  RepoName.make(`${project}--${WORKING}--${handle.toLowerCase()}`);
