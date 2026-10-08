/**
 * The page for an address that names no project: the platform's own
 * refusal, `UnknownProject`, as `git` and the CLI would print it. An address
 * that cannot be a project's name at all says so in a sentence.
 */
import { ProjectName } from "@repo/protocol/ids";
import { UnknownProject } from "@repo/protocol/refusal";
import { Option, Schema } from "effect";

import { EmptyState } from "../shared/empty.tsx";
import { PageShell } from "../shared/layout.tsx";
import { RefusalView } from "../shared/refusal.tsx";

const decodeProject = Schema.decodeUnknownOption(ProjectName);

export const UnknownProjectView = ({ name }: { readonly name: string }) =>
  Option.match(decodeProject(name), {
    onNone: () => (
      <PageShell title="No such project">
        <EmptyState title="A project's name is lowercase words joined by single dashes, and this address names none." />
      </PageShell>
    ),
    onSome: (project) => (
      <PageShell title={project}>
        <RefusalView refusals={[new UnknownProject({ project })]} />
      </PageShell>
    ),
  });
