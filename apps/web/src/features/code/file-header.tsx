/**
 * The code pages' file header: the toolbar that stays under the context
 * bar while the code scrolls. Left to right: the Files button (below the
 * shell's width, where the tree is not in a rail), the path as a trail of
 * links with a button that copies it, the file's size in words ("12 lines
 * · 493 bytes · TypeScript"), the Code | Why toggle (one page, two modes,
 * each its own address), then Raw, Permalink (`y`) and Copy.
 *
 * Also here: the `y` key, which rewrites the address to the page at its
 * commit, and the words a file's facts are said in.
 */
import type { FileView } from "@repo/protocol/domain/code";
import type { ProjectName } from "@repo/protocol/ids";
import { Check, Copy, Link2 } from "lucide-react";
import { Fragment, useEffect } from "react";
import type { ReactNode } from "react";

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

/** A text's lines, without the empty one after its last newline. */
export const linesOf = (text: string): readonly string[] => {
  const lines = text.split("\n");

  return lines.at(-1) === "" ? lines.slice(0, -1) : lines;
};

/** The language a file is written in, by its name; none for one this list does not know. */
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

/** A file in words: its lines, its size, its language. */
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

/**
 * Whether `press` asks for the permalink: `y`, with no modifier, outside a
 * field, and only while the single keys are on (the switch in the keys
 * dialog turns this one off too).
 */
export const permalinkPress = (press: KeyPress, on: boolean) =>
  on &&
  press.key === "y" &&
  !press.inField &&
  !press.altKey &&
  !press.ctrlKey &&
  !press.metaKey;

/** `y` rewrites the address to the page at its commit, keeping the line anchor. */
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

/** A button that copies `text` with only its mark showing; its name says what it copies. */
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

/** The path as links: the project, each folder at `rev`, then the name itself. */
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
        {/* On a phone the toolbar has room for the name alone: the folders
            above it are the Files sheet's. */}
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

const SEGMENT =
  "text-ui hover:bg-surface aria-[current]:bg-foreground aria-[current]:text-background aria-[current]:hover:bg-foreground flex h-7 items-center px-2.5 font-medium no-underline transition-colors duration-150";

/** Code | Why: the file, or why each of its lines is there; one page, two addresses. */
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

/** The file header, as the page's toolbar. */
export const FileHeader = ({
  file,
  files,
  mode,
  path,
  project,
  rev,
}: {
  readonly project: ProjectName;
  readonly rev: string;
  /** The folder or file the page is about; the root when absent. */
  readonly path?: string | undefined;
  /** Code or Why, on a file's page; nothing on a folder's. */
  readonly mode?: "code" | "why";
  /** The file, read: its size in words, its bytes and its text to copy. */
  readonly file?: FileView;
  /** The Files button, below the shell's width. */
  readonly files?: ReactNode;
}) => (
  <>
    {files === undefined ? null : (
      <div className="shell:hidden flex shrink-0">{files}</div>
    )}
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <PathTrail path={path} project={project} rev={rev} />
      {file === undefined ? null : (
        // From 1440 px the inspector says the same, beside the path.
        <p className="text-ui text-muted-foreground diffsplit:block codefacts:hidden hidden min-w-0 truncate tabular-nums">
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
        <a className={TOOL} href={rawHref(project, file.at, file.path)}>
          Raw
        </a>
        <AppLink
          className={TOOL}
          title="Permalink (y)"
          to={(mode === "why" ? whyHref : blobHref)(
            project,
            file.at,
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
