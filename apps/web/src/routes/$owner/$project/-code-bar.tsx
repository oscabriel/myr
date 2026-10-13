/**
 * The Code tab's bar with its reads: the refs when the switcher opens, the
 * paths when Go to file opens, and the tree in the Files sheet. The layout
 * hands it to the project's frame, which draws it on the tab's pages.
 */
import { useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import { lazy } from "react";
import type { ComponentProps } from "react";

import { refsAtom } from "../../../client/code.ts";
import { CodeBar } from "../../../features/code/code-bar.tsx";
import type { CodeBarReads } from "../../../features/code/code-bar.tsx";
import { RefChoices } from "../../../features/code/ref-switcher.tsx";
import type { RefChoicesReader } from "../../../features/code/ref-switcher.tsx";
import { FilesButton } from "./tree/-files-button.tsx";

const ReadChoices: RefChoicesReader = ({
  project,
  ...props
}: ComponentProps<RefChoicesReader>) => {
  const read = useAtomValue(refsAtom(project));

  return (
    <RefChoices
      {...props}
      refs={Option.getOrUndefined(AsyncResult.value(read))}
    />
  );
};

const reads: CodeBarReads = {
  Choices: ReadChoices,
  Files: FilesButton,
  Finder: import.meta.env.SSR
    ? undefined
    : lazy(() => import("./tree/-file-finder.tsx")),
};

export const ProjectCodeBar = ({
  platformUrl,
}: {
  readonly platformUrl: string;
}) => <CodeBar platformUrl={platformUrl} reads={reads} />;
