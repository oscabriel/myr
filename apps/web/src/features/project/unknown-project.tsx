/**
 * The page for an address that names no project: the platform's own
 * refusal, `UnknownProject`, as `git` and the CLI would print it, then the
 * way onward. An address that cannot be a project's name at all says so in
 * a sentence.
 */
import { ProjectName } from "@repo/protocol/ids";
import { UnknownProject } from "@repo/protocol/refusal";
import { Option, Schema } from "effect";

import { EmptyState } from "../shared/empty.tsx";
import { AppLink } from "../shared/link.tsx";
import { ASKS_PATH } from "../shared/paths.ts";
import { RefusalView } from "../shared/refusal.tsx";
import { Workspace } from "../shared/shell/workspace.tsx";

const decodeProject = Schema.decodeUnknownOption(ProjectName);

const LINK = "decoration-rule underline hover:decoration-current";

/** Where to go instead: every open ask. */
const Onward = () => (
  <div className="text-ui flex flex-wrap gap-x-4 gap-y-1">
    <AppLink className={LINK} to={ASKS_PATH}>
      Open asks
    </AppLink>
  </div>
);

export const UnknownProjectView = ({ name }: { readonly name: string }) =>
  Option.match(decodeProject(name), {
    onNone: () => (
      <Workspace
        crumbs={[{ label: "No such project" }]}
        title="No such project"
      >
        <EmptyState
          onward={<Onward />}
          title="A project's name is lowercase words joined by single dashes, and this address names none."
        />
      </Workspace>
    ),
    onSome: (project) => (
      <Workspace crumbs={[{ label: project }]} title="No such project">
        <RefusalView refusals={[new UnknownProject({ project })]} />
        <Onward />
      </Workspace>
    ),
  });
