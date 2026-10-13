import { DecisionSubject } from "@repo/protocol/domain/decision";
import { useLocation, useMatch } from "@tanstack/react-router";
import { Option, Schema } from "effect";
import { useMemo } from "react";

import { parseDiffHash } from "../code/line-hash.ts";
import { DecisionPageData, DecisionRead } from "../decision/decision-page.tsx";
import { patchFiles } from "./files.ts";
import { FinishFileList } from "./finish-files.tsx";
import { patchOf } from "./patch.ts";
import { marksKey, useReadMarks } from "./read-marks.ts";

const decode = Schema.decodeUnknownOption(DecisionPageData);

export const useFinish = () => {
  const data: unknown = useMatch({
    from: "/$owner/$project/decisions/$decision",
    select: (match) => match.loaderData,
    shouldThrow: false,
  });

  return useMemo(
    () =>
      Option.flatMap(decode(data), ({ read }) => {
        if (!DecisionRead.guards.Found(read)) {
          return Option.none();
        }

        const { decision } = read;

        if (!DecisionSubject.guards.Finish(decision.subject)) {
          return Option.none();
        }

        const { head } = decision.subject;

        return Option.map(patchOf(decision), (patch) => ({
          files: patchFiles(
            patch,
            read.ask?.territory.paths ?? [],
            `${decision.project}/${decision.id}/${head}`
          ),
          head,
          key: marksKey(decision.project, decision.id),
          refused: new Set(read.placed.map(({ path }) => path)),
        }));
      }),
    [data]
  );
};

export type Finish = Option.Option.Value<ReturnType<typeof useFinish>>;

export const FinishFiles = ({ finish }: { readonly finish: Finish }) => {
  const marked = useMemo(
    () =>
      finish.files.map(({ file, patchId }) => ({ patchId, path: file.path })),
    [finish.files]
  );

  const { read } = useReadMarks(finish.key, finish.head, marked);
  const href = useLocation({ select: ({ pathname }) => pathname });

  const current = useLocation({
    select: ({ hash }) =>
      Option.getOrUndefined(
        Option.map(parseDiffHash(hash), ({ path }) => path)
      ),
  });

  const readCount = finish.files.filter(({ file }) =>
    read.has(file.path)
  ).length;

  return (
    <>
      <p className="border-rule text-label text-muted-foreground flex h-10 shrink-0 items-center border-b px-3 font-normal tabular-nums">
        {finish.files.length} {finish.files.length === 1 ? "file" : "files"}{" "}
        changed · {readCount} read
      </p>
      <FinishFileList
        current={current}
        files={finish.files}
        href={href}
        read={read}
        refused={finish.refused}
      />
    </>
  );
};

export const FinishColumnFiles = () =>
  Option.match(useFinish(), {
    onNone: () => null,
    onSome: (found) => <FinishFiles finish={found} />,
  });

// `React.lazy` takes a module's default export.
export default FinishColumnFiles;
