import { Schema } from "effect";

// Lowercase words joined by single dashes: no `--`, which separates a fork's
// parts (`<project>--<ask>--<handle>`), and no leading or trailing dash.
const Words = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

// A name in the config folder: a kind, a layer, an area, a lane, a ratchet.
const ConfigName = /^[a-z][a-zA-Z0-9-]*$/u;

// A git object id in SHA-1 format: 40 lowercase hex digits.
const GitId = /^[0-9a-f]{40}$/u;

// What the platform mints from a project's sequence: `prop-000001`, `dec-0a1b2c`.
const Minted = /^[a-z]+-[0-9a-z]{6,26}$/u;

/**
 * Words an ask may not be named: `me` names a person's working fork
 * (`<project>--me--<handle>`), `layer` names a layer's repo, and `open` and
 * `flag` are subcommands of `<cli> ask <ask>`, which would shadow an ask so
 * named.
 */
const reservedAskIds = ["me", "layer", "open", "flag"] as const;

const isReserved = (name: string) =>
  reservedAskIds.some((reserved) => reserved === name);

/**
 * An ask's name. Lowercase words joined by single dashes, so a command that
 * names it (`<cli> claim <ask>`) is safe to paste into a shell and a fork's
 * name splits back into its parts. `me`, `layer`, `open` and `flag` are taken.
 */
export const AskId = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(Words),
    Schema.makeFilter(
      (name: string) =>
        isReserved(name)
          ? `${name} is reserved for working forks, layers and the CLI's ask commands, so no ask takes it`
          : true,
      {
        expected: `an ask name other than ${reservedAskIds.join(" or ")}`,
        toCode: () => ({
          runtime: `Schema.makeFilter((name: string) => !${JSON.stringify(reservedAskIds)}.includes(name))`,
        }),
        toJsonSchema: () => ({ not: { enum: [...reservedAskIds] } }),
      }
    )
  ),
  Schema.brand("AskId")
);

export type AskId = typeof AskId.Type;

/** A git commit id: 40 lowercase hex digits, git's SHA-1 object format. */
export const CommitSha = Schema.String.pipe(
  Schema.check(Schema.isPattern(GitId)),
  Schema.brand("CommitSha")
);

export type CommitSha = typeof CommitSha.Type;

/**
 * A commit the platform itself landed on main. Rules are read only from one
 * of these (ADR 0005), never from a commit someone pushed.
 */
export const LandedSha = CommitSha.pipe(Schema.brand("LandedSha"));

export type LandedSha = typeof LandedSha.Type;

/** A git tree id: the exact tree a check ran on. */
export const TreeSha = Schema.String.pipe(
  Schema.check(Schema.isPattern(GitId)),
  Schema.brand("TreeSha")
);

export type TreeSha = typeof TreeSha.Type;

/** A git blob id: one file's content at one moment. */
export const BlobSha = Schema.String.pipe(
  Schema.check(Schema.isPattern(GitId)),
  Schema.brand("BlobSha")
);

export type BlobSha = typeof BlobSha.Type;

/**
 * An answer's change set, as the platform identifies it: SHA-256 over the
 * sorted (path, blob before, blob after) triples it changes. It moves exactly
 * when a file the answer touches moved underneath it.
 */
export const PatchId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[0-9a-f]{64}$/u)),
  Schema.brand("PatchId")
);

export type PatchId = typeof PatchId.Type;

/**
 * The key that makes an answer, a finish or a landing request safe to send
 * twice: the second one with the same key converges on the first.
 */
export const RequestId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[A-Za-z0-9_-]{8,64}$/u)),
  Schema.brand("RequestId")
);

export type RequestId = typeof RequestId.Type;

/**
 * A per-claim credential, reserved: today the person's platform token is the
 * credential. It is redacted wherever it is printed, so it is never logged.
 */
export const ClaimToken = Schema.RedactedFromValue(Schema.String);

export type ClaimToken = typeof ClaimToken.Type;

/** A proposal's id, minted from its project's sequence: `prop-000001`. */
export const ProposalId = Schema.String.pipe(
  Schema.check(Schema.isPattern(Minted)),
  Schema.brand("ProposalId")
);

export type ProposalId = typeof ProposalId.Type;

/** A decision's id, minted from its project's sequence: `dec-000001`. */
export const DecisionId = Schema.String.pipe(
  Schema.check(Schema.isPattern(Minted)),
  Schema.brand("DecisionId")
);

export type DecisionId = typeof DecisionId.Type;

/** A landing's id, minted from its project's sequence: `land-000001`. */
export const LandingId = Schema.String.pipe(
  Schema.check(Schema.isPattern(Minted)),
  Schema.brand("LandingId")
);

export type LandingId = typeof LandingId.Type;

/** An ask kind's name, as the config folder declares it: `fix`, `lintToZero`. */
export const KindName = Schema.String.pipe(
  Schema.check(Schema.isPattern(ConfigName)),
  Schema.brand("KindName")
);

export type KindName = typeof KindName.Type;

/** A layer's name, as the config folder declares it: `maintainers`. */
export const LayerName = Schema.String.pipe(
  Schema.check(Schema.isPattern(ConfigName)),
  Schema.brand("LayerName")
);

export type LayerName = typeof LayerName.Type;

/** An area held-back checks are counted and reported by: `parse`. */
export const AreaName = Schema.String.pipe(
  Schema.check(Schema.isPattern(ConfigName)),
  Schema.brand("AreaName")
);

export type AreaName = typeof AreaName.Type;

/** One of the project's own check commands, by name: `lint`, `types`, `unit`. */
export const LaneName = Schema.String.pipe(
  Schema.check(Schema.isPattern(ConfigName)),
  Schema.brand("LaneName")
);

export type LaneName = typeof LaneName.Type;

/** A ratchet's name, as the config folder declares it: `anyCount`. */
export const RatchetName = Schema.String.pipe(
  Schema.check(Schema.isPattern(ConfigName)),
  Schema.brand("RatchetName")
);

export type RatchetName = typeof RatchetName.Type;

/** An item's key in a project's env shape: `PAYMENTS_KEY`. */
export const EnvKey = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/u)),
  Schema.brand("EnvKey")
);

export type EnvKey = typeof EnvKey.Type;

/** A commitment: the salted SHA-256 root of a held-back suite. */
export const SuiteRoot = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/u)),
  Schema.brand("SuiteRoot")
);

export type SuiteRoot = typeof SuiteRoot.Type;

/**
 * What a check run's result depends on besides the tree: the check kind, the
 * version of the rules it was declared with, and its commands
 * (`redThenGreen@0.0.0+<hash>`). A verdict is reused only for the same tree
 * and the same version.
 */
export const CheckVersion = Schema.NonEmptyString.pipe(
  Schema.brand("CheckVersion")
);

export type CheckVersion = typeof CheckVersion.Type;

/**
 * A repo's name in its namespace: letters, digits, dots, dashes, underscores.
 * A claim's fork is `<project>--<ask>--<handle>`, a layer's repo
 * `<project>--<layer>`.
 */
export const RepoName = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[A-Za-z0-9._-]+$/u)),
  Schema.brand("RepoName")
);

export type RepoName = typeof RepoName.Type;

/** A path inside a repo, as git prints it. */
export const RepoPath = Schema.NonEmptyString.pipe(Schema.brand("RepoPath"));

export type RepoPath = typeof RepoPath.Type;

/**
 * Words a project may not be named: the web serves its own pages and files
 * at these first path segments (`/today`, `/people/<handle>`, `/auth/…`,
 * `/rpc`, `/releases/…`, `/icons/…` and the client build's `/assets/…`), so a
 * project so named would be unreachable at `<web>/<project>`. A name with a
 * dot (`llms.txt`, `install.sh`, `.well-known`) is no project's name anyway.
 * `apps/web/test/routes.test.ts` holds this list to the web's routes.
 */
export const reservedProjectNames = [
  "assets",
  "auth",
  "icons",
  "people",
  "releases",
  "rpc",
  "today",
] as const;

/**
 * A project's name. Lowercase words joined by single dashes, like an ask's,
 * so a command that names it is safe to paste into a shell; none of
 * `reservedProjectNames`, which the web's own pages take.
 */
export const ProjectName = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(Words),
    Schema.makeFilter(
      (name: string) =>
        reservedProjectNames.some((reserved) => reserved === name)
          ? `${name} is a path the web serves its own pages at, so no project takes it`
          : true,
      {
        expected: `a project name other than ${reservedProjectNames.join(" or ")}`,
        toCode: () => ({
          runtime: `Schema.makeFilter((name: string) => !${JSON.stringify(reservedProjectNames)}.includes(name))`,
        }),
        toJsonSchema: () => ({ not: { enum: [...reservedProjectNames] } }),
      }
    )
  ),
  Schema.brand("ProjectName")
);

export type ProjectName = typeof ProjectName.Type;

/** A person's handle on the platform, as their sign-in provider spells it. */
export const Handle = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9-]*$/u)),
  Schema.brand("Handle")
);

export type Handle = typeof Handle.Type;

/**
 * Whether two handles name one person: without case, as the platform's own
 * accounts tell handles apart (an account's key is its handle lowercased,
 * spec D23) and as claim forks name them, so a vouch file's or a policy's
 * `Alice` is the person signed in as `alice`. The one rule every package
 * compares handles by.
 */
export const sameHandle = (one: Handle, other: Handle): boolean =>
  one.toLowerCase() === other.toLowerCase();
