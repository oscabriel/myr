import type { Refusal } from "@repo/protocol/refusal";
/**
 * A code page's 404. A path missing at a revision that exists lands softly
 * on the nearest folder that does, the platform's refusal (`UnknownPath`)
 * as its notice, verbatim, above the folder's entries. Any other refusal
 * (`UnknownProject`, `UnknownRevision`, `UnknownCommit`) is drawn as `git`
 * would print it, with a way onward; an address that can name nothing
 * says why in a sentence.
 */
import { Option, Schema } from "effect";
import type { Array } from "effect";

import { EmptyState } from "../shared/empty.tsx";
import { AppLink } from "../shared/link.tsx";
import { RefusalView } from "../shared/refusal.tsx";
import { Refusals } from "../shared/refusals.ts";
import { Workspace } from "../shared/shell/workspace.tsx";
import { SoftLanding } from "./soft-landing.ts";
import { TreeView } from "./tree-view.tsx";

const decodeLanding = Schema.decodeUnknownOption(SoftLanding);

const decodeRefusals = Schema.decodeUnknownOption(Refusals);

const LINK = "decoration-rule underline hover:decoration-current";

export const NOTHING =
  "Nothing is at this address: a code page names a project, then main, a whole 40-hex commit id or a tag, then a path in the project.";

/** A refusal with no folder to land on: verbatim, then the ways onward. */
const Refused = ({
  refusals,
}: {
  readonly refusals: Array.NonEmptyReadonlyArray<Refusal> | undefined;
}) => (
  <Workspace title="Not found">
    {refusals === undefined ? (
      <EmptyState title={NOTHING} />
    ) : (
      <RefusalView refusals={refusals} />
    )}
    <p className="text-ui flex flex-wrap gap-x-4 gap-y-1">
      <AppLink className={LINK} to="/">
        Open asks
      </AppLink>
    </p>
  </Workspace>
);

export const CodeNotFound = ({ data }: { readonly data?: unknown }) =>
  Option.match(decodeLanding(data), {
    onNone: () => (
      <Refused refusals={Option.getOrUndefined(decodeRefusals(data))} />
    ),
    onSome: (landing) => (
      <TreeView
        listing={landing.nearest}
        notice={<RefusalView refusals={landing.refusals} />}
        now={landing.now}
        project={landing.project}
        rev={landing.rev}
      />
    ),
  });
