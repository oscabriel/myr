import { indexBanner, underTitle } from "@repo/agent-kit/host-doc";
import { Brand } from "@repo/brand";
import type { Visibility } from "@repo/protocol/annotations";
import type { ProjectName } from "@repo/protocol/ids";
import { Refusal } from "@repo/protocol/refusal";
import { explain } from "@repo/protocol/render";
import { Array, Cause, Exit, Option, Schema } from "effect";

const MARKDOWN = "text/markdown; charset=utf-8";

export type ContractVisibility = ReturnType<typeof Visibility.defaultValue>;

interface MediaRange {
  readonly quality: number;
  readonly subtype: string;
  readonly type: string;
}

/** A q-value as RFC 9110 writes it: 0 to 1, at most three decimals. */
const QUALITY = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/u;

const rangesOf = (accept: string): readonly MediaRange[] =>
  accept.split(",").flatMap((entry) => {
    const [media = "", ...parameters] = entry
      .split(";")
      .map((part) => part.trim().toLowerCase());

    const [type = "", subtype = ""] = media.split("/");
    const q = parameters.find((parameter) => parameter.startsWith("q="));
    const quality = q === undefined ? "1" : q.slice(2);

    return type === "" || subtype === "" || !QUALITY.test(quality)
      ? []
      : [{ quality: Number(quality), subtype, type }];
  });

const closeness = (range: MediaRange, type: string, subtype: string) => {
  if (range.type === type) {
    if (range.subtype === subtype) {
      return 3;
    }

    return range.subtype === "*" ? 2 : 0;
  }

  return range.type === "*" && range.subtype === "*" ? 1 : 0;
};

const preferenceFor = (
  ranges: readonly MediaRange[],
  type: string,
  subtype: string
) => {
  let best = { close: 0, quality: 0 };

  for (const range of ranges) {
    const close = closeness(range, type, subtype);

    if (close > best.close) {
      best = { close, quality: range.quality };
    }
  }

  return best;
};

/**
 * A wildcard alone (`*\/*`, `text/*`, or no `Accept` at all) gets the page, as
 * a browser does.
 */
export const wantsMarkdown = (request: Request) => {
  const ranges = rangesOf(request.headers.get("accept") ?? "");
  const markdown = preferenceFor(ranges, "text", "markdown");
  const html = preferenceFor(ranges, "text", "html");

  return (
    markdown.close === 3 &&
    markdown.quality > 0 &&
    markdown.quality >= html.quality
  );
};

const longestTicks = (text: string) =>
  Math.max(0, ...[...text.matchAll(/`+/gu)].map(([run]) => run.length));

const inlineCode = (text: string) => {
  const ticks = longestTicks(text);
  const fence = "`".repeat(ticks + 1);

  return ticks === 0 ? `${fence}${text}${fence}` : `${fence} ${text} ${fence}`;
};

export const refusalsMarkdown = (
  refusals: Array.NonEmptyReadonlyArray<Refusal>
) => {
  const lines = explain(refusals);
  const fence = "`".repeat(Math.max(3, longestTicks(lines.join("\n")) + 1));
  const nexts = Array.dedupe(refusals.map((refusal) => refusal.next));

  return [
    `${fence}text`,
    ...lines,
    fence,
    "",
    nexts.map((next) => `Next: ${inlineCode(next)}`).join("\n\n"),
    "",
  ].join("\n");
};

const markdown = (body: string, status: number, cacheControl: string) =>
  new Response(body, {
    headers: {
      "cache-control": cacheControl,
      "content-type": MARKDOWN,
      vary: "Accept",
    },
    status,
  });

const cacheFor = (visibility: ContractVisibility) =>
  visibility === "public" ? "public, max-age=60" : "private, no-store";

const isRefusal = Schema.is(Refusal);

const UNANSWERED = [
  "The platform did not answer, so the web cannot read this ask now. Ask again in a moment.",
  "",
].join("\n");

export interface AskIndex {
  readonly project: ProjectName;
  readonly webUrl: string;
}

export const askMarkdownResponse = <E>(
  result: Exit.Exit<{ readonly brief: string }, E>,
  visibility: ContractVisibility,
  index: AskIndex
): Response =>
  Exit.match(result, {
    onFailure: (cause) =>
      Option.match(Option.filter(Cause.findErrorOption(cause), isRefusal), {
        onNone: () => markdown(UNANSWERED, 502, "no-store"),
        onSome: (refusal) =>
          markdown(refusalsMarkdown([refusal]), 404, "no-store"),
      }),
    onSuccess: ({ brief }) =>
      markdown(
        underTitle(brief, indexBanner(index)),
        200,
        cacheFor(visibility)
      ),
  });

export const noAskAt = (path: string) =>
  markdown(
    [
      `No ask is at ${inlineCode(path)}: a project's and an ask's names are lowercase words joined by single dashes.`,
      "",
      `Next: ${inlineCode(`${Brand.cli} asks`)}`,
      "",
    ].join("\n"),
    404,
    "no-store"
  );

export const markdownPath = (project: string, ask: string) =>
  `/${project}/asks/${ask}.md`;

export const markdownAlternate = (project: string, ask: string) =>
  `<${markdownPath(project, ask)}>; rel="alternate"; type="text/markdown"`;
