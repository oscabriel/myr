/**
 * The `OnPush` Workflow: Artifacts starts one for every pushed ref in the
 * public namespace (`triggers.events`, S1 #12), with the event's id as its
 * instance id. A stub until W3 313 builds it: it has no `run` yet, so an
 * instance fails at once. The class name is frozen.
 */
import { WorkflowEntrypoint } from "cloudflare:workers";

/** A commit in a push event, as Artifacts sends it. */
interface PushedCommit {
  readonly id: string;
  readonly message: string;
  readonly messageTruncated: boolean;
  readonly timestamp: string;
  readonly author: { readonly name: string; readonly email: string };
  readonly committer: { readonly name: string; readonly email: string };
  readonly parents: readonly string[];
}

/**
 * The `cf.artifacts.repo.pushed` event as S1 #15 recorded it, typed loosely
 * until 313 decodes it with a schema.
 */
export interface OnPushEventEncoded {
  readonly id: string;
  readonly type: "cf.artifacts.repo.pushed";
  readonly source: { readonly namespace: string; readonly repoName: string };
  readonly payload: {
    readonly ref: string;
    readonly before: string;
    readonly after: string;
    readonly commits: readonly PushedCommit[];
    readonly totalCommitsCount: number;
    readonly commitsTruncated: boolean;
  };
}

export class OnPush extends WorkflowEntrypoint<Env, OnPushEventEncoded> {}
