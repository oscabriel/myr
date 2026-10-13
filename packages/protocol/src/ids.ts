import { Option, Schema, SchemaGetter } from "effect";

import { legacyProjects } from "./legacy.ts";

// Lowercase words joined by single dashes: no `--`, which separates a fork's
// parts (`<project>--<ask>--<handle>`), and no leading or trailing dash.
const Words = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

const ConfigName = /^[a-z][a-zA-Z0-9-]*$/u;

const GitId = /^[0-9a-f]{40}$/u;

const Minted = /^[a-z]+-[0-9a-z]{6,26}$/u;

// `me` and `layer` name working forks and layer repos; `open` and `flag` are
// subcommands of `<cli> ask <ask>`, which would shadow an ask so named.
const reservedAskIds = ["me", "layer", "open", "flag"] as const;

const isReserved = (name: string) =>
  reservedAskIds.some((reserved) => reserved === name);

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

export const CommitSha = Schema.String.pipe(
  Schema.check(Schema.isPattern(GitId)),
  Schema.brand("CommitSha")
);

export type CommitSha = typeof CommitSha.Type;

/** A commit the platform itself landed. Rules are read only from one, never from a pushed commit. */
export const LandedSha = CommitSha.pipe(Schema.brand("LandedSha"));

export type LandedSha = typeof LandedSha.Type;

export const TreeSha = Schema.String.pipe(
  Schema.check(Schema.isPattern(GitId)),
  Schema.brand("TreeSha")
);

export type TreeSha = typeof TreeSha.Type;

export const BlobSha = Schema.String.pipe(
  Schema.check(Schema.isPattern(GitId)),
  Schema.brand("BlobSha")
);

export type BlobSha = typeof BlobSha.Type;

/** SHA-256 over the sorted (path, blob before, blob after) triples an answer changes. */
export const PatchId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[0-9a-f]{64}$/u)),
  Schema.brand("PatchId")
);

export type PatchId = typeof PatchId.Type;

export const RequestId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[A-Za-z0-9_-]{8,64}$/u)),
  Schema.brand("RequestId")
);

export type RequestId = typeof RequestId.Type;

/** Reserved: today the person's platform token is the credential. */
export const ClaimToken = Schema.RedactedFromValue(Schema.String);

export type ClaimToken = typeof ClaimToken.Type;

export const ProposalId = Schema.String.pipe(
  Schema.check(Schema.isPattern(Minted)),
  Schema.brand("ProposalId")
);

export type ProposalId = typeof ProposalId.Type;

export const DecisionId = Schema.String.pipe(
  Schema.check(Schema.isPattern(Minted)),
  Schema.brand("DecisionId")
);

export type DecisionId = typeof DecisionId.Type;

export const LandingId = Schema.String.pipe(
  Schema.check(Schema.isPattern(Minted)),
  Schema.brand("LandingId")
);

export type LandingId = typeof LandingId.Type;

export const KindName = Schema.String.pipe(
  Schema.check(Schema.isPattern(ConfigName)),
  Schema.brand("KindName")
);

export type KindName = typeof KindName.Type;

// Single hyphens only: its repo is `<project>--<layer>`, and a `--` in the
// name would read as a claim fork's.
export const LayerName = Schema.String.pipe(
  Schema.check(Schema.isPattern(Words)),
  Schema.brand("LayerName")
);

export type LayerName = typeof LayerName.Type;

export const AreaName = Schema.String.pipe(
  Schema.check(Schema.isPattern(ConfigName)),
  Schema.brand("AreaName")
);

export type AreaName = typeof AreaName.Type;

export const LaneName = Schema.String.pipe(
  Schema.check(Schema.isPattern(ConfigName)),
  Schema.brand("LaneName")
);

export type LaneName = typeof LaneName.Type;

export const RatchetName = Schema.String.pipe(
  Schema.check(Schema.isPattern(ConfigName)),
  Schema.brand("RatchetName")
);

export type RatchetName = typeof RatchetName.Type;

export const EnvKey = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/u)),
  Schema.brand("EnvKey")
);

export type EnvKey = typeof EnvKey.Type;

export const SuiteRoot = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/u)),
  Schema.brand("SuiteRoot")
);

export type SuiteRoot = typeof SuiteRoot.Type;

/** A verdict is reused only for the same tree and version: `redThenGreen@0.0.0+<hash>`. */
export const CheckVersion = Schema.NonEmptyString.pipe(
  Schema.brand("CheckVersion")
);

export type CheckVersion = typeof CheckVersion.Type;

export const RepoName = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[A-Za-z0-9._-]+$/u)),
  Schema.brand("RepoName")
);

export type RepoName = typeof RepoName.Type;

export const RepoPath = Schema.NonEmptyString.pipe(Schema.brand("RepoPath"));

export type RepoPath = typeof RepoPath.Type;

// The web serves its own pages at these first path segments, so a project
// owned by one would be unreachable. `apps/web/test/routes.test.ts` holds
// this list to the web's routes.
export const reservedProjectNames = [
  "agents",
  "asks",
  "assets",
  "auth",
  "docs",
  "explore",
  "home",
  "icons",
  "import",
  "people",
  "privacy",
  "releases",
  "rpc",
  "settings",
  "terms",
  "today",
] as const;

const isReservedOwner = (owner: string) =>
  reservedProjectNames.some((reserved) => reserved === owner);

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

// A short name never ends as a file the web serves beside a page does
// (`llms.txt`, `<ask>.md`), so `/<owner>/llms.txt` is never a project.
const SHORT = String.raw`(?![^/]*\.(?:txt|md)$)${SEGMENT}`;

const ShortNamePattern = new RegExp(String.raw`^${SHORT}$`, "u");

const FullNamePattern = new RegExp(
  String.raw`^(?:${HANDLE_OWNER}|(?:${HOSTS})/${SEGMENT})/${SHORT}$`,
  "u"
);

const SpelledPattern = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+){0,2}$/u;

export const SourceNamespace = Schema.String.pipe(
  Schema.check(Schema.isPattern(SourceNamespacePattern)),
  Schema.brand("SourceNamespace")
);

export type SourceNamespace = typeof SourceNamespace.Type;

// A handle holds no dot and a host always does, so an owner is never both.
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

export const isSourceNamespace = (
  owner: Owner
): owner is Owner & SourceNamespace => SourceNamespacePattern.test(owner);

export const ShortName = Schema.String.pipe(
  Schema.check(Schema.isPattern(ShortNamePattern)),
  Schema.brand("ShortName")
);

export type ShortName = typeof ShortName.Type;

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

// Each `/` becomes `__`. No segment holds two separators in a row, so a key
// reads back to its name even when segments hold `_`. Never `--`, which
// separates a fork's parts.
export const ProjectKey = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^(?!.*--)[a-z0-9._-]+$/u)),
  Schema.brand("ProjectKey")
);

export type ProjectKey = typeof ProjectKey.Type;

const legacyNameByKey: Readonly<Record<string, string>> = Object.fromEntries(
  legacyProjects.map(({ key, name }) => [key, name])
);

const legacyKeyByName: Readonly<Record<string, string>> = Object.fromEntries(
  legacyProjects.map(({ key, name }) => [name, key])
);

const spelledToName = (spelled: string): string => {
  const lower = spelled.toLowerCase();

  return lower.includes("/") ? lower : (legacyNameByKey[lower] ?? lower);
};

// Decoding lowercases and reads a bare legacy key (`datekit`) as its full name,
// so stored events and old remotes still resolve. It encodes only the full name.
export const ProjectName = Schema.String.pipe(
  Schema.check(Schema.isPattern(SpelledPattern)),
  Schema.decodeTo(FullName, {
    decode: SchemaGetter.transform(spelledToName),
    encode: SchemaGetter.transform((name: string) => name),
  })
);

export type ProjectName = typeof ProjectName.Type;

export const ownerOf = (name: ProjectName): Owner =>
  Owner.make(name.slice(0, name.lastIndexOf("/")));

export const shortNameOf = (name: ProjectName): ShortName =>
  ShortName.make(name.slice(name.lastIndexOf("/") + 1));

export const projectNameOf = (owner: Owner, short: ShortName): ProjectName =>
  ProjectName.make(`${owner}/${short}`);

export const keyOf = (name: ProjectName): ProjectKey =>
  ProjectKey.make(legacyKeyByName[name] ?? name.replaceAll("/", "__"));

const decodeFullName = Schema.decodeOption(FullName);

export const nameOfKey = (key: ProjectKey): Option.Option<ProjectName> => {
  const legacy = legacyNameByKey[key];

  if (legacy !== undefined) {
    return Option.some(ProjectName.make(legacy));
  }

  return key.includes("__")
    ? decodeFullName(key.replaceAll("__", "/"))
    : Option.none();
};

const decodeName = Schema.decodeOption(ProjectName);

const SOURCE_URL =
  /^https:\/\/(?<host>[^/?#]+)\/(?<account>[^/?#]+)\/(?<repo>[^/?#]+?)(?:\.git)?\/?$/u;

export const ProjectNameFromKey = ProjectKey.pipe(
  Schema.decodeTo(FullName, {
    decode: SchemaGetter.transform((key: string) =>
      Option.getOrElse(nameOfKey(ProjectKey.make(key)), () => key)
    ),
    encode: SchemaGetter.transform((name: string) =>
      keyOf(ProjectName.make(name))
    ),
  })
);

const forkPartsOf = (name: string) => {
  const dashes = name.indexOf("--");

  return dashes === -1
    ? { head: name, suffix: "" }
    : { head: name.slice(0, dashes), suffix: name.slice(dashes) };
};

export const repoNameOfAddress = (address: string): Option.Option<RepoName> => {
  const slash = address.lastIndexOf("/");
  const { head: short, suffix } = forkPartsOf(address.slice(slash + 1));
  const spelled = slash === -1 ? short : `${address.slice(0, slash)}/${short}`;

  return Option.flatMap(decodeName(spelled), (name) =>
    Schema.decodeOption(RepoName)(`${keyOf(name)}${suffix}`)
  );
};

export const addressOfRepo = (repo: RepoName): Option.Option<string> => {
  const { head: first, suffix } = forkPartsOf(repo);

  return Option.map(
    Option.flatMap(Schema.decodeOption(ProjectKey)(first), nameOfKey),
    (name) => `${name}${suffix}`
  );
};

export interface ProjectAddress {
  readonly spelled: string;
  readonly legacy: boolean;
  readonly rest: readonly string[];
}

export const projectAddressOf = (
  segments: readonly string[]
): Option.Option<ProjectAddress> => {
  const first = segments[0]?.toLowerCase();

  if (first === undefined) {
    return Option.none();
  }

  const legacy = legacyNameByKey[first] !== undefined;
  const owned = isSourceHost(first) ? 3 : 2;
  const length = legacy ? 1 : owned;

  return segments.length < length
    ? Option.none()
    : Option.some({
        legacy,
        rest: segments.slice(length),
        spelled: segments.slice(0, length).join("/"),
      });
};

export const sourceNamespaceOf = (
  url: string
): Option.Option<SourceNamespace> => {
  // `https://<host>/<account>/<repo>(.git)(/)`, read without `URL`, which
  // not every host the protocol compiles on provides.
  const parts = SOURCE_URL.exec(url);
  const host = parts?.groups?.host?.toLowerCase();
  const account = parts?.groups?.account?.toLowerCase();

  return host === undefined || account === undefined || !isSourceHost(host)
    ? Option.none()
    : Schema.decodeOption(SourceNamespace)(`${host}/${account}`);
};

export const Handle = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9-]*$/u)),
  Schema.brand("Handle")
);

export type Handle = typeof Handle.Type;

/** Handles compare without case, as accounts and claim forks do. Every package compares by this. */
export const sameHandle = (one: Handle, other: Handle): boolean =>
  one.toLowerCase() === other.toLowerCase();

export const claimForkName = (
  project: ProjectName,
  ask: AskId,
  handle: Handle
): RepoName =>
  RepoName.make(`${keyOf(project)}--${ask}--${handle.toLowerCase()}`);
