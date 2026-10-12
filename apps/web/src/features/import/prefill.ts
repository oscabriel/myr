import type { InitProject } from "@repo/protocol/contracts";
import { ImportSource } from "@repo/protocol/domain/policy";
import {
  Owner,
  projectNameOf,
  ShortName,
  sourceNamespaceOf,
} from "@repo/protocol/ids";
import type { Handle, ProjectName, SourceNamespace } from "@repo/protocol/ids";
import { Array, Option, Schema } from "effect";

export type ImportPayload = typeof InitProject.payloadSchema.Type;

export interface Prefill {
  readonly owner: Option.Option<SourceNamespace>;
  readonly name: Option.Option<ShortName>;
}

const HTTPS_URL = /^https:\/\/[^/?#\s]+\/(?<path>[^?#\s]+)$/u;

const decodeShortName = Schema.decodeUnknownOption(ShortName);

const decodeOwner = Schema.decodeUnknownOption(Owner);

const decodeSource = Schema.decodeUnknownOption(ImportSource);

const nameIn = (url: string): Option.Option<ShortName> => {
  const path = HTTPS_URL.exec(url.trim())?.groups?.path ?? "";
  const last = path.split("/").findLast((segment) => segment !== "") ?? "";

  return decodeShortName(last.replace(/\.git$/u, "").toLowerCase());
};

export const prefillFrom = (url: string): Prefill => ({
  name: nameIn(url),
  owner: sourceNamespaceOf(url.trim()),
});

export const ownerOfNamespace = (
  namespace: SourceNamespace
): Option.Option<Owner> => decodeOwner(namespace);

export const ownerOfHandle = (handle: Handle): Option.Option<Owner> =>
  decodeOwner(handle.toLowerCase());

export const ownerChoices = (
  handle: Option.Option<Handle>,
  url: string
): readonly Owner[] =>
  Array.dedupe([
    ...Option.toArray(Option.flatMap(prefillFrom(url).owner, ownerOfNamespace)),
    ...Option.toArray(Option.flatMap(handle, ownerOfHandle)),
  ]);

export const sourceUrlOf = (project: ProjectName) => `https://${project}`;

export const importSourceOf = (form: {
  readonly url: string;
  readonly branch: string;
}): Option.Option<ImportSource> => {
  const branch = form.branch.trim();
  const url = form.url.trim();

  return decodeSource(branch === "" ? { url } : { branch, url });
};

export const importPayload = (form: {
  readonly url: string;
  readonly branch: string;
  readonly owner: Owner;
  readonly name: string;
}): Option.Option<ImportPayload> =>
  Option.flatMap(importSourceOf(form), (source) =>
    Option.map(decodeShortName(form.name.trim()), (short) => ({
      import: source,
      project: projectNameOf(form.owner, short),
    }))
  );
