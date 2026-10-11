import { Option, Schema, SchemaGetter } from "effect";

import { legacyProjects } from "./legacy.ts";

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

/**
 * A layer's name, as the config folder declares it: `maintainers`. In an
 * ask's words (lowercase, single hyphens): its repo is `<project>--<layer>`,
 * and a `--` in the name would read as a claim fork's.
 */
export const LayerName = Schema.String.pipe(
  Schema.check(Schema.isPattern(Words)),
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
 * Words no owner may be named: the web serves its own pages and files at
 * these first path segments (`/asks`, `/home`, `/docs`, `/import`,
 * `/agents`, `/today`, `/people/<handle>`, `/auth/…`, `/rpc`,
 * `/releases/…`, `/icons/…` and the client build's `/assets/…`), and an
 * owner is the first segment of a project's address, so a project so owned
 * would be unreachable at `<web>/<owner>/<name>`. A name with a dot
 * (`llms.txt`, `agents.md`, `install.sh`, `.well-known`) is no handle
 * anyway. `apps/web/test/routes.test.ts` holds this list to the web's
 * routes, and sign-up refuses each as a handle.
 */
export const reservedProjectNames = [
  "agents",
  "asks",
  "assets",
  "auth",
  "docs",
  "home",
  "icons",
  "import",
  "people",
  "releases",
  "rpc",
  "today",
] as const;

const isReservedOwner = (owner: string) =>
  reservedProjectNames.some((reserved) => reserved === owner);

/**
 * The hosts a repo may be imported from under its own name: an import
 * from one of these is owned by its source namespace, `<host>/<account>`,
 * unless the importer takes it under their handle. Every account on each
 * is letters, digits, dots, dashes and underscores. The list grows by a
 * line.
 */
export const sourceHosts = [
  "github.com",
  "gitlab.com",
  "codeberg.org",
  "bitbucket.org",
] as const;

export type SourceHost = (typeof sourceHosts)[number];

const isSourceHost = (host: string): host is SourceHost =>
  sourceHosts.some((known) => known === host);

// A segment of a project's name: lowercase letters and digits joined by
// single dots, dashes or underscores, so `--` never occurs (it separates a
// fork's parts) and the segment is safe to paste into a shell.
const SEGMENT = String.raw`[a-z0-9]+(?:[._-][a-z0-9]+)*`;

// A handle as an owner: a lowercase handle with single dashes. A handle may
// not hold `_` or `.`, so it is never mistaken for a host.
const HANDLE_OWNER = String.raw`[a-z0-9]+(?:-[a-z0-9]+)*`;

const HOSTS = sourceHosts.map((host) => host.replaceAll(".", "\\.")).join("|");

const SourceNamespacePattern = new RegExp(
  String.raw`^(?:${HOSTS})/${SEGMENT}$`,
  "u"
);

const OwnerPattern = new RegExp(
  String.raw`^(?:${HANDLE_OWNER}|(?:${HOSTS})/${SEGMENT})$`,
  "u"
);

const ShortNamePattern = new RegExp(String.raw`^${SEGMENT}$`, "u");

const FullNamePattern = new RegExp(
  String.raw`^(?:${HANDLE_OWNER}|(?:${HOSTS})/${SEGMENT})/${SEGMENT}$`,
  "u"
);

// What a request may spell before the parser lowercases it and reads a
// legacy key: one to three segments of the characters a name may hold.
const SpelledPattern = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+){0,2}$/u;

/**
 * A source namespace: the host and account a repo was imported from,
 * `github.com/pallets`, as an owner (ADR 0032).
 */
export const SourceNamespace = Schema.String.pipe(
  Schema.check(Schema.isPattern(SourceNamespacePattern)),
  Schema.brand("SourceNamespace")
);

export type SourceNamespace = typeof SourceNamespace.Type;

/**
 * A project's owner: a person's handle in lowercase (`oscabriel`), or a
 * source namespace (`github.com/pallets`). Never a word the web serves its
 * own pages at. A name is a person or a namespace, never both: a handle
 * holds no dot, a host always does.
 */
export const Owner = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(OwnerPattern),
    Schema.makeFilter(
      (owner: string) =>
        isReservedOwner(owner)
          ? `${owner} is a path the web serves its own pages at, so no owner takes it`
          : true,
      {
        expected: `an owner other than ${reservedProjectNames.join(" or ")}`,
        toCode: () => ({
          runtime: `Schema.makeFilter((owner: string) => !${JSON.stringify(reservedProjectNames)}.includes(owner))`,
        }),
        toJsonSchema: () => ({ not: { enum: [...reservedProjectNames] } }),
      }
    )
  ),
  Schema.brand("Owner")
);

export type Owner = typeof Owner.Type;

/** Whether an owner is a source namespace, not a person. */
export const isSourceNamespace = (
  owner: Owner
): owner is Owner & SourceNamespace => SourceNamespacePattern.test(owner);

/**
 * A project's short name, the last segment of its name: `datekit`,
 * `commander.js`. Lowercase, single separators, so a command that names
 * the project is safe to paste into a shell and never holds `--`.
 */
export const ShortName = Schema.String.pipe(
  Schema.check(Schema.isPattern(ShortNamePattern)),
  Schema.brand("ShortName")
);

export type ShortName = typeof ShortName.Type;

/**
 * A project's full name as every surface reads it: `<owner>/<name>`,
 * `oscabriel/datekit` or `github.com/pallets/click`. The canonical form,
 * with its owner checked.
 */
const FullName = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(FullNamePattern),
    Schema.makeFilter(
      (name: string) => {
        const owner = name.slice(0, name.lastIndexOf("/"));

        return isReservedOwner(owner)
          ? `${owner} is a path the web serves its own pages at, so no project is owned by it`
          : true;
      },
      {
        expected: `a project name whose owner is none of ${reservedProjectNames.join(", ")}`,
        toCode: () => ({
          runtime: `Schema.makeFilter((name: string) => !${JSON.stringify(reservedProjectNames)}.includes(name.slice(0, name.lastIndexOf("/"))))`,
        }),
      }
    )
  ),
  Schema.brand("ProjectName")
);

/**
 * The flat key a project keeps inside the platform: its Durable Object's
 * id, its repo's name, its code cache's key and its projection rows. The
 * name with `/` made `_` (`oscabriel_foo`, `github.com_pallets_click`), or
 * the key a project made before owners kept (`datekit`). `_` occurs in no
 * handle, host, account or short name, so a key reads back to its name.
 * Never `--`, which separates a fork's parts.
 */
export const ProjectKey = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^(?!.*--)[a-z0-9._-]+$/u)),
  Schema.brand("ProjectKey")
);

export type ProjectKey = typeof ProjectKey.Type;

// The forty made before owners, keyed both ways (`legacy.ts`).
const legacyNameByKey: Readonly<Record<string, string>> = Object.fromEntries(
  legacyProjects.map(({ key, name }) => [key, name])
);

const legacyKeyByName: Readonly<Record<string, string>> = Object.fromEntries(
  legacyProjects.map(({ key, name }) => [name, key])
);

/**
 * What a request spelled, read as a name: lowercased, and a bare legacy
 * key given its name. A bare word that is no legacy key stays as it is, and
 * the full name's pattern then refuses it, saying what a name looks like.
 */
const spelledToName = (spelled: string): string => {
  const lower = spelled.toLowerCase();

  return lower.includes("/") ? lower : (legacyNameByKey[lower] ?? lower);
};

/**
 * A project's name, `<owner>/<name>`, on every surface: the web's address,
 * the gateway's path, the CLI's `--project`, every contract's `project`
 * field. One parser: it lowercases what was spelled and reads a key a
 * project kept from before owners (`datekit`) as its name
 * (`oscabriel/datekit`), so a stored event, an old clone's remote and an
 * agent's `project: "datekit"` all mean the same project. It encodes only
 * the full name. ADR 0032.
 */
export const ProjectName = Schema.String.pipe(
  Schema.check(Schema.isPattern(SpelledPattern)),
  Schema.decodeTo(FullName, {
    decode: SchemaGetter.transform(spelledToName),
    encode: SchemaGetter.transform((name: string) => name),
  })
);

export type ProjectName = typeof ProjectName.Type;

/** A project's owner, the name before its last slash. */
export const ownerOf = (name: ProjectName): Owner =>
  Owner.make(name.slice(0, name.lastIndexOf("/")));

/** A project's short name, after its last slash. */
export const shortNameOf = (name: ProjectName): ShortName =>
  ShortName.make(name.slice(name.lastIndexOf("/") + 1));

/** The name an owner and a short name make. */
export const projectNameOf = (owner: Owner, short: ShortName): ProjectName =>
  ProjectName.make(`${owner}/${short}`);

/** The key a project keeps inside the platform for its name. */
export const keyOf = (name: ProjectName): ProjectKey =>
  ProjectKey.make(legacyKeyByName[name] ?? name.replaceAll("/", "_"));

const decodeFullName = Schema.decodeOption(FullName);

/** The name a key reads back to; none for a key no project can have. */
export const nameOfKey = (key: ProjectKey): Option.Option<ProjectName> => {
  const legacy = legacyNameByKey[key];

  if (legacy !== undefined) {
    return Option.some(ProjectName.make(legacy));
  }

  return key.includes("_")
    ? decodeFullName(key.replaceAll("_", "/"))
    : Option.none();
};

const decodeName = Schema.decodeOption(ProjectName);

/**
 * The repo a gateway address names, the `.git` already stripped:
 * `oscabriel/datekit` is the project's key, `oscabriel/datekit--fix--alice`
 * is `<key>--fix--alice`, and a one-segment address is a legacy key with
 * its fork's parts as they are. The parts after `--` are kept verbatim;
 * `repoKind` reads them. None for an address no project can have.
 */
export const repoNameOfAddress = (address: string): Option.Option<RepoName> => {
  const slash = address.lastIndexOf("/");
  const last = address.slice(slash + 1);
  const dashes = last.indexOf("--");
  const short = dashes === -1 ? last : last.slice(0, dashes);
  const suffix = dashes === -1 ? "" : last.slice(dashes);
  const spelled = slash === -1 ? short : `${address.slice(0, slash)}/${short}`;

  return Option.flatMap(decodeName(spelled), (name) =>
    Schema.decodeOption(RepoName)(`${keyOf(name)}${suffix}`)
  );
};

/**
 * The gateway address of a repo: its project's name, then its fork's parts
 * as the repo's name spells them (`oscabriel/datekit--fix--alice`). None for
 * a repo whose key no project can have.
 */
export const addressOfRepo = (repo: RepoName): Option.Option<string> => {
  const dashes = repo.indexOf("--");
  const first = dashes === -1 ? repo : repo.slice(0, dashes);
  const suffix = dashes === -1 ? "" : repo.slice(dashes);

  return Option.map(
    Option.flatMap(Schema.decodeOption(ProjectKey)(first), nameOfKey),
    (name) => `${name}${suffix}`
  );
};

/**
 * The source namespace an import's URL names, when its host is one the
 * platform knows: `https://github.com/Pallets/click.git` is
 * `github.com/pallets`.
 */
export const sourceNamespaceOf = (
  url: string
): Option.Option<SourceNamespace> =>
  Option.flatMap(Option.liftThrowable(() => new URL(url))(), (parsed) => {
    const [account, repo, ...rest] = parsed.pathname
      .split("/")
      .filter((s) => s !== "");

    return account === undefined ||
      repo === undefined ||
      rest.length > 0 ||
      !isSourceHost(parsed.hostname.toLowerCase())
      ? Option.none()
      : Schema.decodeOption(SourceNamespace)(
          `${parsed.hostname.toLowerCase()}/${account.toLowerCase()}`
        );
  });

/** A person's handle on the platform, as their sign-in provider spells it. */
export const Handle = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9-]*$/u)),
  Schema.brand("Handle")
);

export type Handle = typeof Handle.Type;

/**
 * Whether two handles name one person: without case, as the platform's own
 * accounts tell handles apart (an account's key is its handle lowercased)
 * and as claim forks name them, so a vouch file's or a policy's
 * `Alice` is the person signed in as `alice`. The one rule every package
 * compares handles by.
 */
export const sameHandle = (one: Handle, other: Handle): boolean =>
  one.toLowerCase() === other.toLowerCase();
