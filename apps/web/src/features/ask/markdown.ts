/**
 * An ask as Markdown, for agents: a harness reads an ask with one plain
 * fetch, either with `Accept: text/markdown` on the ask's own URL or at the
 * same URL with `.md`. The request decides; no user-agent list does.
 *
 * The brief is the platform's: `showAsk` renders it once, and the web only
 * serves it. A refusal is set the way `git push` printed it, from
 * `@repo/protocol/render` (AGENTS.md principle 3), then its next command.
 * Pure: a `Request` or an `Exit` in, a string or a `Response` out.
 */
import { Brand } from "@repo/brand";
import type { Visibility } from "@repo/protocol/annotations";
import { Refusal } from "@repo/protocol/refusal";
import { explain } from "@repo/protocol/render";
import { Array, Cause, Exit, Option, Schema } from "effect";

const MARKDOWN = "text/markdown; charset=utf-8";

/** A contract's `Visibility` (spec §3.1): a `public` one's answer may be cached for a minute, a `maintainers` one's never. */
export type ContractVisibility = ReturnType<typeof Visibility.defaultValue>;

/** One range of an `Accept` header: `text/markdown;q=0.8`. */
interface MediaRange {
  readonly quality: number;
  readonly subtype: string;
  readonly type: string;
}

/** A q-value as RFC 9110 writes it: 0 to 1, at most three decimals; anything else is no range. */
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

/** How closely `range` names `type/subtype`: 3 by name, 2 by `type/*`, 1 by `*\/*`, 0 not at all. */
const closeness = (range: MediaRange, type: string, subtype: string) => {
  if (range.type === type) {
    if (range.subtype === subtype) {
      return 3;
    }

    return range.subtype === "*" ? 2 : 0;
  }

  return range.type === "*" && range.subtype === "*" ? 1 : 0;
};

/** The quality the closest range gives `type/subtype` (RFC 9110 §12.5.1), and how close it was. */
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
 * Whether the request asks for the ask as Markdown: it names `text/markdown`
 * itself, with a quality above zero and at least the quality it gives
 * `text/html`. A wildcard alone (`*\/*`, `text/*`, or no `Accept` at all)
 * gets the page, as a browser does.
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

/** The longest run of backticks in `text`. */
const longestTicks = (text: string) =>
  Math.max(0, ...[...text.matchAll(/`+/gu)].map(([run]) => run.length));

/** `text` as inline code, its delimiter longer than any backticks inside it. */
const inlineCode = (text: string) => {
  const ticks = longestTicks(text);
  const fence = "`".repeat(ticks + 1);

  return ticks === 0 ? `${fence}${text}${fence}` : `${fence} ${text} ${fence}`;
};

/**
 * Refusals as an agent reads them in Markdown: every refusal's `explain`
 * lines in one text block, verbatim (git's `remote:` lines, without the
 * prefix), then each distinct `next` command once, as its own paragraph.
 */
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

/** What a Markdown answer may be cached for, by its contract's visibility (spec §3.1). */
const cacheFor = (visibility: ContractVisibility) =>
  visibility === "public" ? "public, max-age=60" : "private, no-store";

const isRefusal = Schema.is(Refusal);

/** What the web says when the platform gave neither the ask nor a refusal. */
const UNANSWERED = [
  "The platform did not answer, so the web cannot read this ask now. Ask again in a moment.",
  "",
].join("\n");

/**
 * How reading an ask ended, as the Markdown response: the brief (200,
 * cacheable as its contract's visibility allows); a refusal (404, its
 * Markdown); or no answer from the platform (502). Only a brief is cached.
 */
export const askMarkdownResponse = <E>(
  result: Exit.Exit<{ readonly brief: string }, E>,
  visibility: ContractVisibility
): Response =>
  Exit.match(result, {
    onFailure: (cause) =>
      Option.match(Option.filter(Cause.findErrorOption(cause), isRefusal), {
        onNone: () => markdown(UNANSWERED, 502, "no-store"),
        onSome: (refusal) =>
          markdown(refusalsMarkdown([refusal]), 404, "no-store"),
      }),
    onSuccess: ({ brief }) => markdown(brief, 200, cacheFor(visibility)),
  });

/**
 * The answer to a path that can name no ask: a project's and an ask's names
 * are lowercase words joined by single dashes, so the platform is not asked.
 */
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

/** Where an ask's Markdown lives: its page's URL with `.md`. */
export const markdownPath = (project: string, ask: string) =>
  `/${project}/asks/${ask}.md`;

/** The `Link` header that names an ask page's Markdown as an alternate of it. */
export const markdownAlternate = (project: string, ask: string) =>
  `<${markdownPath(project, ask)}>; rel="alternate"; type="text/markdown"`;
