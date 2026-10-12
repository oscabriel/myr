import { commandDocs } from "@repo/agent-kit/command-doc";
import { frontLlms, MCP_PROTOCOL } from "@repo/agent-kit/host-doc";
import { Brand } from "@repo/brand";
import { FrontPage } from "@repo/project/front-page";
import type { Projects } from "@repo/project/projects";
import { withStandingPosture } from "@repo/project/standing-posture";
import { Contracts } from "@repo/protocol/contracts";
import type { ProjectListing } from "@repo/protocol/domain/front-page";
import { Effect, Option } from "effect";

import { escapeHtml, page } from "./auth/pages.ts";
import { HostInfo } from "./host-info.ts";

const BRIEFLY = "public, max-age=60";

const commands = commandDocs(Contracts);

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

const qualityOf = (
  ranges: ReturnType<typeof rangesOf>,
  types: readonly string[]
) =>
  Math.max(
    0,
    ...ranges.filter(({ type }) => types.includes(type)).map((r) => r.quality)
  );

const wantsMarkdown = (request: Request) => {
  const ranges = rangesOf(request.headers.get("accept") ?? "");
  const markdown = qualityOf(ranges, ["text/markdown", "text/plain"]);

  return markdown > 0 && markdown >= qualityOf(ranges, ["text/html"]);
};

const code = (text: string) => `<code>${escapeHtml(text)}</code>`;

// Tab reaches a command that scrolls sideways on a phone, to scroll it.
const pre = (text: string) =>
  `<pre tabindex="0"><code>${escapeHtml(text)}</code></pre>`;

const link = (url: string, text = url) =>
  `<a href="${escapeHtml(url)}">${escapeHtml(text)}</a>`;

const item = (html: string) => `<li>${html}</li>`;

const section = (title: string, ...html: readonly string[]) =>
  `<section>\n<h2>${escapeHtml(title)}</h2>\n${html.join("\n")}\n</section>`;

const list = (items: readonly string[]) =>
  `<ul>\n${items.map(item).join("\n")}\n</ul>`;

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
    ].join("\n"),
    "document"
  );
};

export const homeResponse = (
  request: Request
): Effect.Effect<Response, never, FrontPage | HostInfo | Projects> =>
  Effect.gen(function* () {
    const { draftModel, webUrl } = yield* HostInfo;

    const projects = yield* FrontPage.use((frontPage) =>
      frontPage.projects()
    ).pipe(Effect.flatMap(withStandingPosture));

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
