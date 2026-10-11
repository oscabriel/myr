/**
 * What an agent reads first on the web host: `/llms.txt` for
 * the platform and `/<project>/llms.txt` for one project, as Markdown, and
 * the MCP card at `/.well-known/mcp.json`. Each is a pure function of what
 * the platform lists and of the CLI's commands (`@repo/agent-kit`'s one
 * list); every name in them comes from `Brand`.
 */
import { describe, expect, it } from "@effect/vitest";
import type { CommandDoc } from "@repo/agent-kit/command-doc";
import { fullLlms } from "@repo/agent-kit/full-llms";
import { Brand } from "@repo/brand";
import { claimForkName, workingForkName } from "@repo/project/repo-names";
import { Contracts } from "@repo/protocol/contracts";
import type { AskListing } from "@repo/protocol/domain/ask";
import type { ProjectListing } from "@repo/protocol/domain/front-page";
import { AskId, Handle, KindName, ProjectName } from "@repo/protocol/ids";
import { Effect, Option } from "effect";

import { commands as catalog } from "../src/features/agents/catalog.ts";
import {
  frontLlms,
  indexBanner,
  mcpCard,
  missingProjectLlms,
  projectLlms,
} from "../src/features/agents/llms.ts";
import {
  projectPageHead,
  projectPageHeaders,
} from "../src/routes/$project/index.tsx";
import { frontPageHead, frontPageHeaders } from "../src/routes/asks.tsx";
import { landingHead, landingHeaders } from "../src/routes/index.tsx";
import { llmsFullHandler } from "../src/routes/llms-full[.]txt.ts";
import { frontPageHandler, landingHandler } from "../src/server/front-page.ts";
import { projectPageHandler } from "../src/server/project-page.ts";
import { platformWith, unreachablePlatform } from "./platform.ts";

const platformUrl = "https://platform-test.example.workers.dev";

const webUrl = "https://web-test.example.workers.dev";

const datekit = ProjectName.make("oscabriel/datekit");

const burrow = ProjectName.make("oscabriel/burrow");

/** A command row as `@repo/agent-kit`'s command list holds it. */
const row = (
  path: readonly [string, ...string[]],
  summary: string,
  more: Partial<CommandDoc> = {}
): CommandDoc => ({
  flags: ["--json"],
  needsApproval: false,
  path,
  positional: [],
  readOnly: true,
  source: "contract",
  summary,
  ...more,
});

const commands: readonly CommandDoc[] = [
  row(
    ["ask"],
    "Show one ask in full, with its brief in Markdown for an answerer to read first.",
    { flags: ["--project", "--json"], positional: ["ask"] }
  ),
  row(["asks"], "List a project's open asks.", {
    flags: ["--project", "--json"],
  }),
  row(["check"], "Run the gate's checks on your answer locally.", {
    flags: ["--ask", "--project", "--json"],
    source: "local",
  }),
  row(["claim"], "Claim an ask: an exclusive, expiring right to answer it.", {
    flags: ["--project", "--json", "--dry-run"],
    positional: ["ask"],
    readOnly: false,
  }),
  row(["env", "set"], "Set a sensitive env item's value from stdin.", {
    flags: ["--project", "--yes"],
    needsApproval: true,
    positional: ["key"],
    readOnly: false,
    source: "local",
  }),
  row(["front"], "List the open asks across every project."),
  row(["login"], "Sign in to a platform.", {
    flags: ["--url", "--json"],
    readOnly: false,
    source: "local",
  }),
  row(["mcp"], "Serve the platform's tools over MCP on stdio.", {
    flags: [],
    source: "local",
  }),
  row(["verdict"], "Show the verdict on an answer to an ask.", {
    flags: ["--ask", "--head", "--project", "--json"],
  }),
];

const projects: readonly ProjectListing[] = [
  { openAsks: 3, posture: "open", project: datekit },
  { openAsks: 1, posture: "openWithSealedEvidence", project: burrow },
];

const ask = (
  id: string,
  want: string,
  more: Partial<AskListing> = {}
): AskListing => ({
  ask: AskId.make(id),
  blockedBy: [],
  claimed: false,
  kind: KindName.make("fix"),
  territory: "src/parse.ts",
  want,
  ...more,
});

const asks: readonly AskListing[] = [
  ask("parse-iso", "parse reads the year of an ISO date"),
  ask("parse-month", "parse reads the month of an ISO date", {
    claimed: true,
  }),
  ask("drop-legacy", "the legacy parser is gone", {
    blockedBy: [AskId.make("parse-iso"), AskId.make("parse-month")],
    reserve: "newcomers",
  }),
];

const linesOf = (text: string) => text.split("\n");

const { cli } = Brand;

describe(frontLlms, () => {
  const text = frontLlms({ commands, platformUrl, projects, webUrl });
  const lines = linesOf(text);

  it("opens with the platform's name and a one-line summary", () => {
    expect(lines[0]).toBe(`# ${Brand.name}`);
    expect(lines[1]).toBe("");
    expect(lines[2]).toMatch(
      new RegExp(`^> ${Brand.name} is a Git platform`, "u")
    );
    expect(text.endsWith("\n")).toBeTruthy();
  });

  it("installs the CLI from the web host, then signs in to the platform", () => {
    expect(lines).toContain(`curl -fsSL ${webUrl}/install.sh | sh`);
    expect(lines).toContain(`${cli} login --url ${platformUrl}`);
  });

  it("says where MCP is served, how it is signed in to, and where the skills are", () => {
    expect(lines).toContain(
      `- Endpoint: ${platformUrl}/mcp (streamable HTTP, MCP 2026-07-28), described at ${webUrl}/.well-known/mcp.json.`
    );
    expect(lines).toContain(
      `- Auth: a bearer token from the platform's own OAuth server, which an MCP client finds at ${platformUrl}/.well-known/oauth-protected-resource; you sign in with your account on ${Brand.name}.`
    );
    expect(lines).toContain(
      `- Without a client that signs in: \`${cli} mcp\` serves the same tools over stdio, with the token \`${cli} login\` stored.`
    );
    expect(lines).toContain(
      `- Skills: ${webUrl}/.well-known/agent-skills/index.json lists each project's contribute skill, with its digest.`
    );
  });

  it("finds and takes an ask with the commands the catalog has", () => {
    expect(lines).toContain(
      `1. Find one: \`${cli} front\` lists the open asks across projects; \`${cli} asks --project <project>\` lists one project's.`
    );
    expect(lines).toContain(
      `2. Read it: \`${cli} ask <ask> --project <project>\`.`
    );
    expect(lines).toContain(
      `3. Claim it: \`${cli} claim <ask> --project <project>\`. The claim prints your fork's remote; add it with \`git remote add ${Brand.slug} <remote>\`.`
    );
    expect(lines).toContain(
      `4. Change only the ask's territory, then run \`${cli} check\` and fix everything it reports.`
    );
    expect(lines).toContain(
      `5. Push to your fork with \`git push ${Brand.slug} HEAD:main\`, then read the verdict: \`${cli} verdict --ask <ask> --project <project>\`. A refusal names the command to run next.`
    );
  });

  it("lists every command on one line, with what it does", () => {
    expect(
      lines.filter((line) => line.startsWith(`- \`${cli} `))
    ).toStrictEqual([
      `- \`${cli} ask <ask>\`: Show one ask in full, with its brief in Markdown for an answerer to read first. Only reads.`,
      `- \`${cli} asks\`: List a project's open asks. Only reads.`,
      `- \`${cli} check\`: Run the gate's checks on your answer locally. Only reads.`,
      `- \`${cli} claim <ask>\`: Claim an ask: an exclusive, expiring right to answer it.`,
      `- \`${cli} env set <key>\`: Set a sensitive env item's value from stdin. Runs only with \`--yes\`.`,
      `- \`${cli} front\`: List the open asks across every project. Only reads.`,
      `- \`${cli} login\`: Sign in to a platform.`,
      `- \`${cli} mcp\`: Serve the platform's tools over MCP on stdio. Only reads.`,
      `- \`${cli} verdict\`: Show the verdict on an answer to an ask. Only reads.`,
    ]);
  });

  it("lists each project on one line, with its posture and its open asks", () => {
    expect(lines).toContain(
      `- [datekit](${webUrl}/datekit/llms.txt): Open, 3 open asks.`
    );
    expect(lines).toContain(
      `- [burrow](${webUrl}/burrow/llms.txt): Open with sealed evidence, 1 open ask.`
    );
  });

  it("says so when no project exists yet", () => {
    expect(
      linesOf(frontLlms({ commands, platformUrl, projects: [], webUrl }))
    ).toContain("No project is on the platform yet.");
  });

  it("leaves out a step whose command the catalog lacks", () => {
    const withoutVerdict = frontLlms({
      commands: commands.filter(({ path }) => path.join(" ") !== "verdict"),
      platformUrl,
      projects,
      webUrl,
    });

    expect(withoutVerdict).not.toContain(`${cli} verdict`);
    expect(linesOf(withoutVerdict)).toContain(
      `5. Push to your fork with \`git push ${Brand.slug} HEAD:main\`. A refusal names the command to run next.`
    );
  });
});

describe(projectLlms, () => {
  const text = projectLlms({
    asks,
    commands,
    listing: {
      openAsks: 3,
      posture: "openWithSealedEvidence",
      project: datekit,
    },
    platformUrl,
    webUrl,
  });

  const lines = linesOf(text);

  it("opens with the project, its posture and how many asks are open, then the banner", () => {
    expect(lines.slice(0, 5)).toStrictEqual([
      "# datekit",
      "",
      `> A project on ${Brand.name}. Posture: Open with sealed evidence. 3 open asks.`,
      "",
      indexBanner({ project: datekit, webUrl }),
    ]);
  });

  it("gives its page, its clone URL and the platform's llms.txt", () => {
    expect(lines).toContain(`- Page: ${webUrl}/datekit`);
    expect(lines).toContain(
      `- Clone: \`git clone ${platformUrl}/datekit.git\``
    );
    expect(lines).toContain(
      `- Everything else, and every command: ${webUrl}/llms.txt`
    );
  });

  it("lists each open ask on one line, linking its Markdown", () => {
    expect(lines.filter((line) => line.startsWith("- ["))).toStrictEqual([
      `- [parse-iso](${webUrl}/datekit/asks/parse-iso.md): parse reads the year of an ISO date. Kind \`fix\`, territory \`src/parse.ts\`.`,
      `- [parse-month](${webUrl}/datekit/asks/parse-month.md): parse reads the month of an ISO date. Kind \`fix\`, territory \`src/parse.ts\`. Claimed.`,
      `- [drop-legacy](${webUrl}/datekit/asks/drop-legacy.md): the legacy parser is gone. Kind \`fix\`, territory \`src/parse.ts\`. Held for newcomers. Waits for \`parse-iso\`, \`parse-month\`.`,
    ]);
  });

  it("names the project in the commands that take an ask", () => {
    expect(lines).toContain(
      `2. Read it: \`${cli} ask <ask> --project datekit\`.`
    );
    expect(lines).toContain(
      `3. Claim it: \`${cli} claim <ask> --project datekit\`. The claim prints your fork's remote; add it with \`git remote add ${Brand.slug} <remote>\`.`
    );
  });

  it("says so when no ask is open", () => {
    expect(
      linesOf(
        projectLlms({
          asks: [],
          commands,
          listing: { openAsks: 0, posture: "open", project: datekit },
          platformUrl,
          webUrl,
        })
      )
    ).toContain("No ask is open.");
  });
});

describe(missingProjectLlms, () => {
  it("names the project it did not find and where every project is", () => {
    expect(
      missingProjectLlms({
        project: Option.some(ProjectName.make("oscabriel/nowhere")),
        webUrl,
      })
    ).toBe(
      `# Not found\n\nNo project named \`nowhere\` is on ${Brand.name}. Every project is listed at ${webUrl}/llms.txt.\n`
    );
  });

  it("repeats no name that could not be a project's", () => {
    expect(missingProjectLlms({ project: Option.none(), webUrl })).toBe(
      `# Not found\n\nNo such project is on ${Brand.name}. Every project is listed at ${webUrl}/llms.txt.\n`
    );
  });
});

describe("the command catalog", () => {
  it("is every command the CLI has, and every row reaches llms.txt", () => {
    const text = frontLlms({
      commands: catalog,
      platformUrl,
      projects,
      webUrl,
    });

    const words = catalog.map(({ path }) => path.join(" "));

    expect(catalog.length).toBeGreaterThan(20);
    // A contract the CLI projects, and commands written by hand in it.
    expect(words).toContain("asks");
    expect(words).toContain("env set");
    expect(words).toContain("login");
    expect(
      catalog.filter(
        ({ path }) => !text.includes(`- \`${cli} ${path.join(" ")}`)
      )
    ).toStrictEqual([]);
  });
});

/** A platform that lists `listed` as its projects, and answers nothing else. */
const listing = (listed: readonly ProjectListing[]) => () =>
  platformWith(
    Contracts.toLayerHandler("listProjects", () =>
      Effect.succeed({ projects: listed })
    )
  );

/** A platform that cannot be reached: every call dies on the way. */
const unreachable = () => unreachablePlatform;

const getFull = () => new Request(`${webUrl}/llms-full.txt`);

const read = (response: Response) =>
  Effect.map(
    Effect.promise(() => response.text()),
    (body) => ({
      body,
      contentType: response.headers.get("content-type"),
      status: response.status,
    })
  );

describe("/llms-full.txt", () => {
  it.effect("is fullLlms over the projects the platform lists", () =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() =>
        llmsFullHandler(listing(projects), platformUrl)({ request: getFull() })
      );

      expect(yield* read(response)).toStrictEqual({
        body: fullLlms({ commands: catalog, platformUrl, projects, webUrl }),
        contentType: "text/markdown; charset=utf-8",
        status: 200,
      });
    })
  );

  it.effect("is unavailable when the platform does not answer", () =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() =>
        llmsFullHandler(unreachable, platformUrl)({ request: getFull() })
      );

      const seen = yield* read(response);

      expect(seen.status).toBe(503);
      expect(seen.body).toContain("# Unavailable");
    })
  );

  describe("its fork names", () => {
    const text = fullLlms({ commands: catalog, platformUrl, projects, webUrl });
    const parseIso = AskId.make("parse-iso");
    const ada = Handle.make("Ada");

    /** A name pattern the doc states, with its placeholders filled in. */
    const filled = (pattern: string) =>
      pattern
        .replaceAll("<project>", datekit)
        .replaceAll("<ask>", parseIso)
        .replaceAll("<handle>", ada.toLowerCase());

    /** The patterns in the doc's code spans that name a fork. */
    const patterns = [...text.matchAll(/`(?<name><project>--[^`]+)`/gu)].map(
      (match) => match.groups?.name ?? ""
    );

    it("spell a claim's fork as the platform names it", () => {
      expect(patterns.map(filled)).toContain(
        claimForkName(datekit, parseIso, ada)
      );
    });

    it("spell a working fork as the platform names it", () => {
      expect(patterns.map(filled)).toContain(workingForkName(datekit, ada));
    });
  });
});

describe(mcpCard, () => {
  it("describes the platform's MCP endpoint and where its auth is found", () => {
    expect(mcpCard({ platformUrl })).toStrictEqual({
      authentication: {
        required: true,
        resource_metadata: `${platformUrl}/.well-known/oauth-protected-resource`,
        schemes: ["bearer"],
      },
      capabilities: { prompts: {}, resources: {}, tools: {} },
      description: `The contracts of ${Brand.name} as MCP tools, each ask's brief as a resource, and the contribute skill as a prompt.`,
      name: Brand.name,
      protocolVersion: "2026-07-28",
      transport: { endpoint: `${platformUrl}/mcp`, type: "streamable-http" },
    });
  });
});

/** A platform that lists `listed` as its projects and `listedAsks` as datekit's asks. */
const listingWithAsks =
  (listed: readonly ProjectListing[], listedAsks: readonly AskListing[]) =>
  () =>
    platformWith(
      Contracts.toLayerHandler("listProjects", () =>
        Effect.succeed({ projects: listed })
      ),
      Contracts.toLayerHandler("listAsks", () =>
        Effect.succeed({ asks: listedAsks })
      )
    );

/** A request for `path` on the web host, accepting `accept`. */
const getAt = (path: string, accept: string) =>
  new Request(`${webUrl}${path}`, { headers: { accept } });

const BROWSER =
  "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

/** What a handler answered: a response, or the page it fell through to. */
const answered = (result: Promise<Response> | "the page") =>
  result === "the page"
    ? Effect.void
    : Effect.flatMap(
        Effect.promise(() => result),
        (response) =>
          Effect.map(read(response), (seen) => ({
            ...seen,
            vary: response.headers.get("vary"),
          }))
      );

/** The head's link naming `href` as a page's Markdown. */
const alternate = (href: string) => ({
  href,
  rel: "alternate",
  type: "text/markdown",
});

describe("the list pages, asked for Markdown", () => {
  it.effect.each([
    ["/", landingHandler],
    ["/asks", frontPageHandler],
  ] as const)("answers %s with llms.txt, varied by Accept", ([path, handler]) =>
    Effect.gen(function* () {
      const seen = yield* answered(
        handler(
          listing(projects),
          platformUrl
        )({
          next: () => "the page" as const,
          request: getAt(path, "text/markdown"),
        })
      );

      expect(seen).toStrictEqual({
        body: frontLlms({ commands: catalog, platformUrl, projects, webUrl }),
        contentType: "text/markdown; charset=utf-8",
        status: 200,
        vary: "Accept",
      });
    })
  );

  it.effect(
    "answers /datekit with the project's llms.txt, varied by Accept",
    () =>
      Effect.gen(function* () {
        const seen = yield* answered(
          projectPageHandler(
            listingWithAsks(projects, asks),
            platformUrl
          )({
            next: () => "the page" as const,
            params: { project: "datekit" },
            request: getAt("/datekit", "text/markdown"),
          })
        );

        expect(seen).toStrictEqual({
          body: projectLlms({
            asks,
            commands: catalog,
            listing: { openAsks: 3, posture: "open", project: datekit },
            platformUrl,
            webUrl,
          }),
          contentType: "text/markdown; charset=utf-8",
          status: 200,
          vary: "Accept",
        });
      })
  );

  it("gives a browser the page", () => {
    expect(
      landingHandler(
        listing(projects),
        platformUrl
      )({
        next: () => "the page" as const,
        request: getAt("/", BROWSER),
      })
    ).toBe("the page");
    expect(
      frontPageHandler(
        listing(projects),
        platformUrl
      )({
        next: () => "the page" as const,
        request: getAt("/asks", BROWSER),
      })
    ).toBe("the page");
    expect(
      projectPageHandler(
        listing(projects),
        platformUrl
      )({
        next: () => "the page" as const,
        params: { project: "datekit" },
        request: getAt("/datekit", BROWSER),
      })
    ).toBe("the page");
  });

  it("names each page's Markdown as an alternate, in its head and its Link header", () => {
    for (const [headers, head] of [
      [landingHeaders, landingHead],
      [frontPageHeaders, frontPageHead],
    ] as const) {
      expect(headers()).toMatchObject({
        link: '</llms.txt>; rel="alternate"; type="text/markdown"',
        vary: "Accept",
      });
      expect(head().links).toContainEqual(alternate("/llms.txt"));
    }

    expect(
      projectPageHeaders({ params: { project: "datekit" } })
    ).toMatchObject({
      link: '</datekit/llms.txt>; rel="alternate"; type="text/markdown"',
      vary: "Accept",
    });
    expect(
      projectPageHead({ params: { project: "datekit" } }).links
    ).toContainEqual(alternate("/datekit/llms.txt"));
  });

  it("names no Markdown for a path that can name no project", () => {
    expect(
      projectPageHeaders({ params: { project: "Not_A_Project" } })
    ).toStrictEqual({ vary: "Accept" });
  });
});
