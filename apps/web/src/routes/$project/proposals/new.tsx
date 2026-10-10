import { useAtom, useAtomValue } from "@effect/atom-react";
import { CommitSha, ProjectName, RepoPath } from "@repo/protocol/ids";
import {
  createFileRoute,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { Option, Schema } from "effect";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useState } from "react";

import {
  modulesAtom,
  proposalMade,
  proposeAtom,
} from "../../../client/propose.ts";
import { hereOf } from "../../../features/auth/session-slot.tsx";
import { whoAtom } from "../../../features/auth/who.ts";
import { ProjectNav } from "../../../features/project/project-nav.tsx";
import { UnknownProjectView } from "../../../features/project/unknown-project.tsx";
import { ProposalFailure } from "../../../features/proposal/failure.tsx";
import { ProposeView } from "../../../features/propose/propose-view.tsx";
import type { About } from "../../../features/propose/propose-view.tsx";
import { pageHead } from "../../../features/shared/head.ts";
import { PageShell } from "../../../features/shared/layout.tsx";

// `/$project/proposals/new`: the propose form. Who is signed in and the
// project's top folders are read in the browser (the server paints the
// page while it checks); a proposal made goes to its own page, a refusal
// shows under the form. `?about=<path>&line=<n>&at=<sha>` (the why page's
// "Propose an ask about this line") starts the want at that line.

const decodeProject = Schema.decodeUnknownOption(ProjectName);

/** The line a why page points at, when the address names all three parts. */
const AboutParts = Schema.Struct({
  about: RepoPath,
  at: CommitSha,
  line: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
});

const decodeAbout = Schema.decodeUnknownOption(AboutParts);

const decodeText = Schema.decodeUnknownOption(Schema.String);

const decodeLine = Schema.decodeUnknownOption(Schema.Int);

/** The address's line, as the form takes it. */
const aboutOf = (search: {
  readonly about?: string | undefined;
  readonly at?: string | undefined;
  readonly line?: number | undefined;
}): Option.Option<About> =>
  Option.map(decodeAbout(search), ({ about, at, line }) => ({
    at,
    line,
    path: about,
  }));

const Checking = () => (
  <output className="text-muted-foreground block text-sm">
    Checking who is signed in
  </output>
);

/** The form for `project`, once the browser knows who is signed in. */
const Propose = ({ project }: { readonly project: ProjectName }) => {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const here = useLocation({ select: hereOf });
  const who = useAtomValue(whoAtom);

  const modules = Option.getOrElse(
    AsyncResult.value(useAtomValue(modulesAtom(project))),
    () => []
  );

  const [proposed, propose] = useAtom(proposeAtom);
  // Set once this form sends: a proposal the atom still holds from an
  // earlier visit never moves the page.
  const [sent, setSent] = useState(false);

  const made = sent ? Option.getOrUndefined(proposalMade(proposed)) : undefined;

  useEffect(() => {
    if (made !== undefined) {
      void navigate({
        params: { project, proposal: made },
        to: "/$project/proposals/$proposal",
      });
    }
  }, [made, navigate, project]);

  if (!AsyncResult.isSuccess(who)) {
    return <Checking />;
  }

  return (
    <ProposeView
      about={aboutOf(search)}
      busy={proposed.waiting}
      modules={modules}
      onPropose={(payload) => {
        setSent(true);
        propose(payload);
      }}
      project={project}
      signedIn={Option.isSome(who.value)}
    >
      {AsyncResult.isFailure(proposed) ? (
        <div aria-live="polite">
          <ProposalFailure
            cause={proposed.cause}
            doing="propose it"
            here={here}
          />
        </div>
      ) : null}
    </ProposeView>
  );
};

const Page = () => {
  const params = Route.useParams();

  return Option.match(decodeProject(params.project), {
    onNone: () => <UnknownProjectView name={params.project} />,
    onSome: (project) => (
      <PageShell title={`${project}: propose an ask`}>
        <ProjectNav project={project} />
        <Propose project={project} />
      </PageShell>
    ),
  });
};

export const Route = createFileRoute("/$project/proposals/new")({
  component: Page,
  validateSearch: (search: {
    readonly about?: unknown;
    readonly at?: unknown;
    readonly line?: unknown;
  }) => ({
    about: Option.getOrUndefined(decodeText(search.about)),
    at: Option.getOrUndefined(decodeText(search.at)),
    line: Option.getOrUndefined(decodeLine(search.line)),
  }),
  head: ({ params: { project } }) =>
    pageHead({ title: `${project}: propose an ask` }),
});
