import { useAtom, useAtomValue } from "@effect/atom-react";
import { ProjectName } from "@repo/protocol/ids";
import { createFileRoute } from "@tanstack/react-router";
import { DateTime, Option, Schema } from "effect";

import { decideAtom } from "../client/decide.ts";
import { todayAtom } from "../client/today.ts";
import { pageHead } from "../features/shared/head.ts";
import { PageShell } from "../features/shared/layout.tsx";
import { TodayView } from "../features/today/today-page.tsx";

// `/today`: the signed-in decider's decisions across their projects, or in
// the one `?project=` names. A decider's page, read in the browser with the
// session cookie: the server renders the shell, never a decider's evidence.

const projectOf = Schema.decodeUnknownOption(ProjectName);

const TodayPage = () => {
  const { project } = Route.useSearch();
  const today = useAtomValue(todayAtom(project));
  const [decided, decide] = useAtom(decideAtom);

  return (
    <PageShell title={project === undefined ? "Today" : `Today in ${project}`}>
      <TodayView
        decided={decided}
        now={DateTime.nowUnsafe()}
        onDecide={decide}
        result={today}
      />
    </PageShell>
  );
};

export const Route = createFileRoute("/today")({
  component: TodayPage,
  head: () => pageHead({ title: "Today" }),
  ssr: false,
  validateSearch: (search: {
    readonly project?: unknown;
  }): { readonly project?: ProjectName } =>
    Option.match(projectOf(search.project), {
      onNone: () => ({}),
      onSome: (project) => ({ project }),
    }),
});
