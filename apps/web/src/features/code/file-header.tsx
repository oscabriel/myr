import type { FileView } from "@repo/protocol/domain/code";
import type { ProjectName } from "@repo/protocol/ids";
import { Check, Copy, Link2 } from "lucide-react";
import { Fragment, useEffect } from "react";

import { buttonVariants } from "@/components/ui/button";

import { useCopy } from "../shared/copy-action.tsx";
import { useKeys } from "../shared/keys.tsx";
import type { KeyPress } from "../shared/keys.tsx";
import { AppLink } from "../shared/link.tsx";
import { CopyButton } from "./copy.tsx";
import {
  ancestorsOf,
  blobHref,
  rawHref,
  sizeInWords,
  treeHref,
  whyHref,
} from "./paths.ts";
import { pinnedRev } from "./rev.ts";

export const linesOf = (text: string): readonly string[] => {
  const lines = text.split("\n");

  return lines.at(-1) === "" ? lines.slice(0, -1) : lines;
};

const LANGUAGES: readonly (readonly [RegExp, string])[] = [
  [/\.(?:c|m)?tsx?$/u, "TypeScript"],
  [/\.(?:c|m)?jsx?$/u, "JavaScript"],
  [/\.json$/u, "JSON"],
  [/\.(?:md|markdown|mdown)$/u, "Markdown"],
  [/\.ya?ml$/u, "YAML"],
  [/\.toml$/u, "TOML"],
  [/\.css$/u, "CSS"],
  [/\.html?$/u, "HTML"],
  [/\.rs$/u, "Rust"],
  [/\.go$/u, "Go"],
  [/\.py$/u, "Python"],
  [/\.(?:sh|bash|zsh)$/u, "Shell"],
  [/(?:^|\/)Dockerfile$/u, "Dockerfile"],
  [/\.sql$/u, "SQL"],
  [/\.rb$/u, "Ruby"],
  [/\.java$/u, "Java"],
  [/\.kt$/u, "Kotlin"],
  [/\.swift$/u, "Swift"],
  [/\.c$|\.h$/u, "C"],
  [/\.(?:cc|cpp|hpp)$/u, "C++"],
];

export const languageOf = (path: string) =>
  LANGUAGES.find(([pattern]) => pattern.test(path))?.[1];

export const fileWords = (file: FileView): readonly string[] => [
  ...(file.text === undefined
    ? []
    : [
        `${linesOf(file.text).length.toLocaleString("en")} ${
          linesOf(file.text).length === 1 ? "line" : "lines"
        }`,
      ]),
  sizeInWords(file.size),
  ...(file.binary ? ["binary"] : []),
  ...(languageOf(file.path) === undefined ? [] : [languageOf(file.path) ?? ""]),
];

export const permalinkPress = (press: KeyPress, on: boolean) =>
  on &&
  press.key === "y" &&
  !press.inField &&
  !press.altKey &&
  !press.ctrlKey &&
  !press.metaKey;

export const PermalinkKey = ({ href }: { readonly href: string }) => {
  const on = useKeys()?.on ?? true;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const [target] = event.composedPath();

      const inField =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest("input, select, textarea, [role=combobox]") !== null);

      if (
        permalinkPress(
          {
            altKey: event.altKey,
            ctrlKey: event.ctrlKey,
            inField,
            key: event.key,
            metaKey: event.metaKey,
          },
          on
        )
      ) {
        globalThis.history.replaceState(
          globalThis.history.state,
          "",
          `${href}${globalThis.location.search}${globalThis.location.hash}`
        );
      }
    };

    globalThis.addEventListener("keydown", onKey);

    return () => {
      globalThis.removeEventListener("keydown", onKey);
    };
  }, [href, on]);

  return null;
};

const CRUMB =
  "text-muted-foreground hover:text-foreground min-w-0 truncate no-underline transition-colors duration-[120ms]";

const CopyMark = ({
  label,
  text,
}: {
  readonly label: string;
  readonly text: string;
}) => {
  const { copied, copy } = useCopy(text);

  return (
    <button
      aria-label={
        copied ? `Copied ${label.toLowerCase().replace(/^copy /u, "")}` : label
      }
      className="text-muted-foreground hover:text-foreground hover:bg-surface flex size-7 shrink-0 cursor-pointer items-center justify-center"
      onClick={copy}
      title={label}
      type="button"
    >
      {copied ? (
        <Check aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
      ) : (
        <Copy aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
      )}
    </button>
  );
};

export const PathTrail = ({
  path,
  project,
  rev,
}: {
  readonly path: string | undefined;
  readonly project: ProjectName;
  readonly rev: string;
}) => {
  const here = path === undefined || path === "" ? undefined : path;
  const name = here?.split("/").at(-1);

  return (
    <nav
      aria-label="Path"
      className="flex min-w-0 items-center gap-1"
      data-slot="breadcrumb"
    >
      <ol className="text-mono flex min-w-0 items-center gap-1 font-mono">
        {/* On a phone the toolbar has room for the name alone. */}
        <li
          className={`${here === undefined ? "flex" : "tablet:flex hidden"} min-w-0 shrink-0 items-center`}
        >
          {here === undefined ? (
            <span aria-current="page" className="text-foreground font-medium">
              {project}
            </span>
          ) : (
            <AppLink className={CRUMB} to={treeHref(project, rev)}>
              {project}
            </AppLink>
          )}
        </li>
        {here === undefined
          ? null
          : ancestorsOf(here).map((folder) => (
              <Fragment key={folder}>
                <li
                  aria-hidden="true"
                  className="text-muted-foreground tablet:block hidden"
                >
                  /
                </li>
                <li className="tablet:flex hidden min-w-0 items-center">
                  <AppLink
                    className={CRUMB}
                    to={treeHref(project, rev, folder)}
                  >
                    {folder.split("/").at(-1)}
                  </AppLink>
                </li>
              </Fragment>
            ))}
        {name === undefined ? null : (
          <>
            <li
              aria-hidden="true"
              className="text-muted-foreground tablet:block hidden"
            >
              /
            </li>
            <li className="flex min-w-0 items-center">
              <span
                aria-current="page"
                className="text-foreground min-w-0 truncate font-medium"
                title={here}
              >
                {name}
              </span>
            </li>
          </>
        )}
      </ol>
      {here === undefined ? null : <CopyMark label="Copy path" text={here} />}
    </nav>
  );
};

export const SEGMENT =
  "text-ui hover:bg-surface aria-[current]:bg-foreground aria-[current]:text-background aria-[current]:hover:bg-foreground flex h-7 items-center px-2.5 font-medium no-underline transition-colors duration-150";

export const ModeToggle = ({
  mode,
  path,
  project,
  rev,
}: {
  readonly mode: "code" | "why";
  readonly path: string;
  readonly project: ProjectName;
  readonly rev: string;
}) => (
  <nav aria-label="Mode" className="border-input flex shrink-0 border">
    <AppLink
      aria-current={mode === "code" ? "page" : undefined}
      className={SEGMENT}
      to={blobHref(project, rev, path)}
    >
      Code
    </AppLink>
    <AppLink
      aria-current={mode === "why" ? "page" : undefined}
      className={SEGMENT}
      to={whyHref(project, rev, path)}
    >
      Why
    </AppLink>
  </nav>
);

const TOOL = buttonVariants({
  className: "no-underline",
  size: "sm",
  variant: "ghost",
});

export const FileHeader = ({
  file,
  mode,
  path,
  project,
  rev,
}: {
  readonly project: ProjectName;
  readonly rev: string;
  readonly path?: string | undefined;
  readonly mode?: "code" | "why";
  readonly file?: FileView;
}) => (
  <>
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <PathTrail path={path} project={project} rev={rev} />
      {file === undefined ? null : (
        <p className="text-ui text-muted-foreground diffsplit:block hidden min-w-0 truncate tabular-nums">
          {fileWords(file).join(" · ")}
        </p>
      )}
    </div>
    {mode === undefined || path === undefined ? null : (
      <ModeToggle mode={mode} path={path} project={project} rev={rev} />
    )}
    {file === undefined ? null : (
      <nav
        aria-label="File"
        className="shell:flex hidden shrink-0 items-center gap-0.5"
        data-toolbar="file"
      >
        <a
          className={TOOL}
          href={rawHref(project, pinnedRev(rev, file.at), file.path)}
        >
          Raw
        </a>
        <AppLink
          className={TOOL}
          title="Permalink (y)"
          to={(mode === "why" ? whyHref : blobHref)(
            project,
            pinnedRev(rev, file.at),
            file.path
          )}
        >
          <Link2 aria-hidden="true" strokeWidth={1.75} />
          Permalink
        </AppLink>
        {file.text === undefined ? null : (
          <CopyButton label="Copy" text={file.text} />
        )}
      </nav>
    )}
  </>
);
