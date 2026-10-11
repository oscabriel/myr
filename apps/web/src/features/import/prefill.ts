/**
 * What the import form reads from a pasted URL, and what it sends. Pure:
 * no view, no transport. The owner is the URL's source namespace
 * (`github.com/pallets`) when its host is one the platform knows; the name
 * is the URL's last segment, without `.git`, lowercased. Nothing here asks
 * a host anything: the platform clones the URL when Import is pressed.
 */
import type { InitProject } from "@repo/protocol/contracts";
import { ImportSource } from "@repo/protocol/domain/policy";
import {
  Owner,
  ProjectName,
  ShortName,
  sourceNamespaceOf,
} from "@repo/protocol/ids";
import type { Handle, SourceNamespace } from "@repo/protocol/ids";
import { Array, Option, Schema } from "effect";

/** What `initProject` takes, from its one schema. */
export type ImportPayload = typeof InitProject.payloadSchema.Type;

/** What a URL prefills: the owner its host gives, and the name it ends in. */
export interface Prefill {
  readonly owner: Option.Option<SourceNamespace>;
  readonly name: Option.Option<ShortName>;
}

// `https://<host>/<path>`: the path's last non-empty segment is the repo's.
const HTTPS_URL = /^https:\/\/[^/?#\s]+\/(?<path>[^?#\s]+)$/u;

const decodeShortName = Schema.decodeUnknownOption(ShortName);

const decodeOwner = Schema.decodeUnknownOption(Owner);

const decodeProject = Schema.decodeUnknownOption(ProjectName);

const decodeSource = Schema.decodeUnknownOption(ImportSource);

/** The name a URL ends in, without `.git` and lowercased; none when it is no name. */
const nameIn = (url: string): Option.Option<ShortName> => {
  const path = HTTPS_URL.exec(url.trim())?.groups?.path ?? "";
  const last = path.split("/").findLast((segment) => segment !== "") ?? "";

  return decodeShortName(last.replace(/\.git$/u, "").toLowerCase());
};

/** The owner and the name `url` prefills. */
export const prefillFrom = (url: string): Prefill => ({
  name: nameIn(url),
  owner: sourceNamespaceOf(url.trim()),
});

/** A handle as an owner, lowercased; none for one no owner can spell. */
export const ownerOfHandle = (handle: Handle): Option.Option<Owner> =>
  decodeOwner(handle.toLowerCase());

/**
 * The owners a person may import `url` under: the URL's source namespace
 * first when its host is one the platform knows (the default then), and
 * their own handle.
 */
export const ownerChoices = (
  handle: Option.Option<Handle>,
  url: string
): readonly Owner[] =>
  Array.dedupe([
    ...Option.toArray(
      Option.flatMap(prefillFrom(url).owner, (owner) => decodeOwner(owner))
    ),
    ...Option.toArray(Option.flatMap(handle, ownerOfHandle)),
  ]);

/**
 * The URL a source namespace's project was imported from:
 * `github.com/pallets/click` is `https://github.com/pallets/click`.
 */
export const sourceUrlOf = (project: ProjectName) => `https://${project}`;

/**
 * The form's fields as `initProject`'s payload: the URL and the branch
 * trimmed, the branch only when named. None when the contract would refuse
 * the name or the URL before the platform ever read it.
 */
export const importPayload = (form: {
  readonly url: string;
  readonly branch: string;
  readonly owner: string;
  readonly name: string;
}): Option.Option<ImportPayload> => {
  const branch = form.branch.trim();
  const url = form.url.trim();

  return Option.flatMap(
    decodeSource(branch === "" ? { url } : { branch, url }),
    (source) =>
      Option.map(
        decodeProject(`${form.owner}/${form.name.trim()}`),
        (project) => ({
          import: source,
          project,
        })
      )
  );
};
