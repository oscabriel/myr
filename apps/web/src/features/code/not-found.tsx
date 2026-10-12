import type { Refusal } from "@repo/protocol/refusal";
import { Option, Schema } from "effect";
import type { Array } from "effect";
import type { ReactNode } from "react";

import { EmptyState } from "../shared/empty.tsx";
import { AppLink } from "../shared/link.tsx";
import { ASKS_PATH } from "../shared/paths.ts";
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
      <AppLink className={LINK} to={ASKS_PATH}>
        Open asks
      </AppLink>
    </p>
  </Workspace>
);

export const CodeNotFound = ({
  data,
  files,
}: {
  readonly data?: unknown;
  readonly files?: ReactNode;
}) =>
  Option.match(decodeLanding(data), {
    onNone: () => (
      <Refused refusals={Option.getOrUndefined(decodeRefusals(data))} />
    ),
    onSome: (landing) => (
      <TreeView
        files={files}
        listing={landing.nearest}
        notice={<RefusalView refusals={landing.refusals} />}
        now={landing.now}
        project={landing.project}
        rev={landing.rev}
      />
    ),
  });
