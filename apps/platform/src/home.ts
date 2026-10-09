/**
 * The platform's `/`: a page saying what this host serves (clone URLs,
 * MCP, agent skills, RPC, sign-in, the CLI and its releases, drafting, the
 * web app), in HTML for a browser and in Markdown for an agent that asks
 * for `text/markdown` or `text/plain`. The Markdown is the web's
 * `/llms.txt` (`@repo/agent-kit/host-doc`), so both hosts say the same.
 *
 * Every URL is built from the request's origin, the one the client reached:
 * the platform is also the git remote, the MCP base and the CLI's URL, so
 * the page names them as the reader will type them. The projects are the
 * front page's, and nothing else: no layer and no fork is listed. Every
 * value that reaches the HTML is escaped. Not a redirect: the web app is a
 * link, so the host stays discoverable at its own address.
 */
import { commandDocs } from "@repo/agent-kit/command-doc";
import { frontLlms, MCP_PROTOCOL } from "@repo/agent-kit/host-doc";
import { Brand } from "@repo/brand";
import { FrontPage } from "@repo/project/front-page";
import { Contracts } from "@repo/protocol/contracts";
import type { ProjectListing } from "@repo/protocol/domain/front-page";
import { Effect, Option } from "effect";

import { escapeHtml, page } from "./auth/pages.ts";
import { HostInfo } from "./host-info.ts";

/** A minute: the page changes only when a project is made. */
const BRIEFLY = "public, max-age=60";

/** The CLI's commands, as the platform's skill and the web's `llms.txt` list them. */
const commands = commandDocs(Contracts);

/** The media ranges of an `Accept` header, each its type and its quality. */
const rangesOf = (accept: string) =>
  accept.split(",").map((range) => {
    const [type = "", ...params] = range.split(";").map((part) => part.trim());

    const quality = Option.getOrElse(
      Option.flatMap(
        Option.fromUndefinedOr(
          params.find((param) => param.toLowerCase().startsWith("q="))
        ),
        (param) => Option.liftPredicate(Number(param.slice(2)), Number.isFinite)
      ),
      () => 1
    );

    return { quality, type: type.toLowerCase() };
  });

/** The highest quality `ranges` give any of `types` by name; 0 for none. */
const qualityOf = (
  ranges: ReturnType<typeof rangesOf>,
  types: readonly string[]
) =>
  Math.max(
    0,
    ...ranges.filter(({ type }) => types.includes(type)).map((r) => r.quality)
  );

/**
 * Whether the request asks for Markdown: it names `text/markdown` or
 * `text/plain` itself, at least as high as it names `text/html`. A
 * wildcard alone (`*\/*`, or no `Accept`) gets the page, as a browser does.
 */
const wantsMarkdown = (request: Request) => {
  const ranges = rangesOf(request.headers.get("accept") ?? "");
  const markdown = qualityOf(ranges, ["text/markdown", "text/plain"]);

  return markdown > 0 && markdown >= qualityOf(ranges, ["text/html"]);
};

const code = (text: string) => `<code>${escapeHtml(text)}</code>`;

const pre = (text: string) => `<pre><code>${escapeHtml(text)}</code></pre>`;

const link = (url: string, text = url) =>
  `<a href="${escapeHtml(url)}">${escapeHtml(text)}</a>`;

const item = (html: string) => `<li>${html}</li>`;

const section = (title: string, ...html: readonly string[]) =>
  `<section>\n<h2>${escapeHtml(title)}</h2>\n${html.join("\n")}\n</section>`;

const list = (items: readonly string[]) =>
  `<ul>\n${items.map(item).join("\n")}\n</ul>`;

/** Wider than sign-in's column, for clone and install lines. */
const STYLE = `<style>
main{max-width:44rem}
h2{font-size:1.1rem;margin:2rem 0 .5rem}
pre{overflow-x:auto;padding:.5rem .75rem;background:rgba(127,127,127,.12)}
code{font-family:ui-monospace,monospace;font-size:.9em}
li{margin:.25rem 0}
</style>`;

const projectsSection = (origin: string, projects: readonly ProjectListing[]) =>
  section(
    "Projects",
    projects.length === 0
      ? "<p>No project is on the platform yet.</p>"
      : list(
          projects.map(
            ({ openAsks, project }) =>
              `<strong>${escapeHtml(project)}</strong>, ${openAsks} open ask${openAsks === 1 ? "" : "s"}${pre(`git clone ${origin}/${project}.git`)}`
          )
        )
  );

/** The page for a browser. */
const homeHtml = (input: {
  readonly origin: string;
  readonly projects: readonly ProjectListing[];
  readonly webUrl: Option.Option<string>;
  readonly draftModel: string;
}) => {
  const { draftModel, origin, projects, webUrl } = input;

  return page(
    "What this host serves",
    [
      STYLE,
      `<h1>${escapeHtml(Brand.name)}</h1>`,
      `<p>A Git platform where everything a project ships is public. A project states each change it wants as an ask; you answer one with a commit, and the platform lands it only once its checks pass.</p>`,
      ...Option.toArray(
        Option.map(
          webUrl,
          (web) => `<p><strong>${link(web, "Open the web app")}</strong></p>`
        )
      ),
      projectsSection(origin, projects),
      section(
        "CLI",
        pre(`curl -fsSL ${origin}/install.sh | sh`),
        `<p>Releases: ${link(`${origin}/releases/manifest.json`)}</p>`,
        `<p>Then sign in: ${code(`${Brand.cli} login --url ${origin}`)}</p>`
      ),
      section(
        "Agents",
        list([
          `MCP: ${code(`${origin}/mcp`)}, streamable HTTP, protocol ${code(MCP_PROTOCOL)}, signed in`,
          `Agent skills: ${link(`${origin}/.well-known/agent-skills/index.json`)}`,
          `RPC: ${code(`POST ${origin}/rpc`)}`,
          `OAuth: ${link(`${origin}/.well-known/oauth-protected-resource`)} and ${link(`${origin}/.well-known/oauth-authorization-server`)}`,
          `The same facts as Markdown: ask for ${code("text/markdown")}, as in ${code(`curl -H 'accept: text/markdown' ${origin}/`)}`,
        ])
      ),
      section(
        "Sign in",
        list([
          `Sign up: ${link(`${origin}/signup`)}`,
          `Authorize a client: ${code(`${origin}/authorize`)}`,
        ])
      ),
      section(
        "Drafting",
        `<p>A member can ask the platform's agent to draft a proposed ask (Workers AI, ${code(draftModel)}); a decider accepts it, and only people are credited.</p>`
      ),
      section("Health", `<p>${link(`${origin}/health`)}</p>`),
    ].join("\n")
  );
};

/** `/` for `request`: Markdown for an agent that asks for it, else the page. */
export const homeResponse = (
  request: Request
): Effect.Effect<Response, never, FrontPage | HostInfo> =>
  Effect.gen(function* () {
    const { draftModel, webUrl } = yield* HostInfo;
    const projects = yield* FrontPage.use((frontPage) => frontPage.projects());
    const { origin } = new URL(request.url);

    if (wantsMarkdown(request)) {
      return new Response(
        frontLlms({
          commands,
          platformUrl: origin,
          projects,
          ...Option.match(webUrl, {
            onNone: () => ({}),
            onSome: (web) => ({ webUrl: web }),
          }),
        }),
        {
          headers: {
            "cache-control": BRIEFLY,
            "content-type": "text/markdown; charset=utf-8",
            vary: "accept",
          },
        }
      );
    }

    return new Response(homeHtml({ draftModel, origin, projects, webUrl }), {
      headers: {
        "cache-control": BRIEFLY,
        "content-security-policy":
          "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
        "content-type": "text/html; charset=utf-8",
        "referrer-policy": "no-referrer",
        vary: "accept",
      },
    });
  });
