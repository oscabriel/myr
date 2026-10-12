/**
 * Kept in this browser alone, never sent anywhere. Storage may be missing, full
 * or refused (a private window), so every read and write is tried and a refused
 * one keeps nothing.
 */
import { Option, Result, Schema } from "effect";
import { useCallback, useEffect, useState } from "react";

const Kept = Schema.Struct({
  head: Schema.String,
  read: Schema.Record(Schema.String, Schema.String),
});

const decodeKept = Schema.decodeUnknownOption(Schema.fromJsonString(Kept));

export const marksKey = (project: string, decision: string) =>
  `finish.read:${project}/${decision}`;

const CHANGED = "finish-read-marks";

export interface MarkedFile {
  readonly path: string;
  readonly patchId: string;
}

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

const browserStorage = (): Storage | undefined =>
  Result.getOrUndefined(Result.try(() => globalThis.localStorage));

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
