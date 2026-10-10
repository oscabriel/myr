/**
 * Which of a finish's files its reader has marked read: kept in this
 * browser alone, never sent anywhere, and about files, never a person. A
 * mark is kept against the decision, the file and that file's change (its
 * patch id), and the whole set against the answer's head: a new head
 * pushed to the answer clears them, and a file whose change differs reads
 * unread.
 *
 * The browser's storage may be missing, full or refused (a private window);
 * every read and write is tried, and a refused one keeps nothing, so the
 * page works the same with no marks.
 *
 * The rail and the diff both show the marks; a change made in one is told
 * to the other with an event on the window.
 */
import { Option, Result, Schema } from "effect";
import { useCallback, useEffect, useState } from "react";

/** What one decision's marks are kept as. */
const Kept = Schema.Struct({
  head: Schema.String,
  read: Schema.Record(Schema.String, Schema.String),
});

const decodeKept = Schema.decodeUnknownOption(Schema.fromJsonString(Kept));

/** Where one decision's marks are kept. */
export const marksKey = (project: string, decision: string) =>
  `finish.read:${project}/${decision}`;

/** The event a change to the marks is told by. */
const CHANGED = "finish-read-marks";

/** A file and its change, as a mark is kept against it. */
export interface MarkedFile {
  readonly path: string;
  readonly patchId: string;
}

/** The paths marked read, at `head`, whose change is still the one marked. */
export const readMarks = (
  storage: Storage | undefined,
  key: string,
  head: string,
  files: readonly MarkedFile[]
): ReadonlySet<string> => {
  const kept = Result.getOrElse(
    Result.try(() => storage?.getItem(key) ?? null),
    () => null
  );

  return Option.match(Option.flatMap(Option.fromNullishOr(kept), decodeKept), {
    onNone: () => new Set(),
    onSome: ({ head: at, read }) =>
      at === head
        ? new Set(
            files.flatMap(({ patchId, path }) =>
              read[path] === patchId ? [path] : []
            )
          )
        : new Set(),
  });
};

/** Mark `file` read or unread at `head`; marks kept at another head are dropped. A refused write keeps nothing. */
export const writeMark = (
  storage: Storage | undefined,
  key: string,
  head: string,
  file: MarkedFile,
  read: boolean
): void => {
  const kept = Result.getOrElse(
    Result.try(() => storage?.getItem(key) ?? null),
    () => null
  );

  const current = Option.getOrUndefined(
    Option.filter(
      Option.flatMap(Option.fromNullishOr(kept), decodeKept),
      (marks) => marks.head === head
    )
  );

  const { [file.path]: _was, ...others } = current?.read ?? {};
  const next = read ? { ...others, [file.path]: file.patchId } : others;

  Result.try(() => storage?.setItem(key, JSON.stringify({ head, read: next })));
};

/** The browser's storage, when there is one this page may use. */
const browserStorage = (): Storage | undefined =>
  Result.getOrUndefined(Result.try(() => globalThis.localStorage));

/**
 * The marks on `files` at `head`, read once the page runs (the server
 * draws none), and the way to set one. Every view of the same decision
 * hears a change made in another.
 */
export const useReadMarks = (
  key: string,
  head: string,
  files: readonly MarkedFile[],
  storage: () => Storage | undefined = browserStorage
) => {
  const [read, setRead] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const load = () => {
      setRead(readMarks(storage(), key, head, files));
    };

    load();
    globalThis.addEventListener(CHANGED, load);

    return () => {
      globalThis.removeEventListener(CHANGED, load);
    };
  }, [files, head, key, storage]);

  const mark = useCallback(
    (file: MarkedFile, on: boolean) => {
      writeMark(storage(), key, head, file, on);
      globalThis.dispatchEvent(new Event(CHANGED));
    },
    [head, key, storage]
  );

  return { mark, read };
};
