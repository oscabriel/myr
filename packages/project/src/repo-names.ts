/**
 * What a repo's name says it is: a project's canonical repo
 * `<key>`, a claim's fork `<key>--<ask>--<handle>`, or a person's
 * working fork `<key>--me--<handle>`, each handle in lowercase, where the
 * key is the project's flat key (ADR 0032). `--` occurs in no key or ask
 * name, so a name splits back into its parts.
 * Pure: the platform's gateway, handlers and OnPush read names with it, and
 * a project lists its forks by it.
 */
import {
  AskId,
  Handle,
  keyOf,
  nameOfKey,
  ProjectKey,
  RepoName,
} from "@repo/protocol/ids";
import type { ProjectName } from "@repo/protocol/ids";
import { Data, Option, Schema } from "effect";

/** A claim's fork, as `@repo/protocol/ids` spells it. */
export { claimForkName } from "@repo/protocol/ids";

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

const asKey = Schema.decodeOption(ProjectKey);

/** The project a repo name's first part names: its key, read back (ADR 0032). */
const asProject = (first: string) => Option.flatMap(asKey(first), nameOfKey);

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

/** A person's working fork: `<key>--me--<handle in lowercase>`. */
export const workingForkName = (project: ProjectName, handle: Handle) =>
  RepoName.make(`${keyOf(project)}--${WORKING}--${handle.toLowerCase()}`);
