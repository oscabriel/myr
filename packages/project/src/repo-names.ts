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

export { claimForkName } from "@repo/protocol/ids";

export type RepoKind =
  | { readonly _tag: "Canonical"; readonly project: ProjectName }
  | {
      readonly _tag: "ClaimFork";
      readonly project: ProjectName;
      readonly ask: AskId;
      readonly handle: Handle;
    }
  | {
      readonly _tag: "WorkingFork";
      readonly project: ProjectName;
      readonly handle: Handle;
    }
  | { readonly _tag: "Unknown" };

export const RepoKind = Data.taggedEnum<RepoKind>();

const asKey = Schema.decodeOption(ProjectKey);

const asProject = (first: string) => Option.flatMap(asKey(first), nameOfKey);

const asAsk = Schema.decodeOption(AskId);

const asHandle = Schema.decodeOption(Handle);

const WORKING = "me";

export const repoKind = (name: RepoName): RepoKind => {
  // `--` occurs in no key or ask name, so a name splits back into its parts.
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

export const workingForkName = (project: ProjectName, handle: Handle) =>
  RepoName.make(`${keyOf(project)}--${WORKING}--${handle.toLowerCase()}`);
