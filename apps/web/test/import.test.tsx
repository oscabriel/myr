/**
 * The import page, `/import`, rendered to HTML with `react-dom/server`: a
 * signed-in person pastes a public repo's HTTPS URL, may name a branch,
 * picks the owner (their handle, or the URL's source namespace when its
 * host is one the platform knows, which is the default then) and the name,
 * prefilled from the URL, and imports it through `initProject`. Signed out,
 * the page links to sign-in, coming back to it. A refusal reads as the
 * platform gave it. The page is about its reader, so no cache keeps it.
 */
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { InitProject } from "@repo/protocol/contracts";
import { Handle, ProjectName } from "@repo/protocol/ids";
import {
  ImportFailed,
  NotYourNamespace,
  ProjectExists,
} from "@repo/protocol/refusal";
import { Cause, Option, Schema } from "effect";
import { AsyncResult } from "effect/reactivity";

import { importMade } from "../src/client/import.ts";
import { ImportView } from "../src/features/import/import-page.tsx";
import {
  importPayload,
  ownerChoices,
  prefillFrom,
  sourceUrlOf,
} from "../src/features/import/prefill.ts";
import { ProposalFailure } from "../src/features/proposal/failure.tsx";
import { importHeaders, importSearch, Route } from "../src/routes/import.tsx";
import { markupOf, textIn } from "./markup.ts";

const CLICK = "https://github.com/pallets/click";

const oscabriel = Option.some(Handle.make("oscabriel"));

const signedIn = (url = CLICK) =>
  markupOf(<ImportView handle={oscabriel} here="/import" url={url} />);

/** An input's opening tag, by its `name`. */
const inputNamed = (markup: string, name: string) =>
  new RegExp(`<input[^>]*name="${name}"[^>]*>`, "u").exec(markup)?.[0] ?? "";

/** Where a sign-in link in `markup` comes back to. */
const returnOf = (markup: string) => {
  const href = /href="(?<href>\/auth\/signin[^"]*)"/u
    .exec(markup)
    ?.groups?.href?.replaceAll("&amp;", "&");

  return new URL(href ?? "/", "https://web.test").searchParams.get("return");
};

describe("the import page", () => {
  it("is kept by no cache: its response is private and never stored", () => {
    expect(Route.options.headers).toBe(importHeaders);
    expect(importHeaders()).toStrictEqual({
      "Cache-Control": "private, no-store",
    });
  });

  it("takes the URL to prefill from its address, and nothing else", () => {
    expect(Route.options.validateSearch).toBe(importSearch);
    expect(importSearch({ url: CLICK })).toStrictEqual({ url: CLICK });
    expect(importSearch({ url: 3 })).toStrictEqual({});
  });

  it("signed out, shows no form and a sign-in link that comes back to /import", () => {
    const markup = markupOf(
      <ImportView handle={Option.none()} here="/import" />
    );

    expect(markup).not.toContain("<form");
    expect(returnOf(markup)).toBe("/import");
    expect(textIn(markup)).toContain(`${Brand.cli} init --project`);
  });

  it("says so while it learns who is signed in", () => {
    const markup = markupOf(
      <ImportView checking handle={Option.none()} here="/import" />
    );

    expect(markup).not.toContain("<form");
    expect(textIn(markup)).toContain("Checking who is signed in");
  });

  it("signed in, offers the URL, the branch, the owner and the name, prefilled from the URL", () => {
    const markup = signedIn();

    expect(inputNamed(markup, "url")).toContain(`value="${CLICK}"`);
    expect(inputNamed(markup, "branch")).toContain('value=""');
    expect(inputNamed(markup, "owner")).toContain('value="github.com/pallets"');
    expect(inputNamed(markup, "name")).toContain('value="click"');
    expect(markup).toMatch(/<button[^>]*type="submit"[^>]*>Import<\/button>/u);
  });

  it("waits on Import until the URL is one to import, and says so", () => {
    const markup = signedIn("");

    expect(markup).toMatch(
      /<button(?=[^>]*disabled="")(?=[^>]*type="submit")[^>]*>Paste a repo&#x27;s URL first<\/button>/u
    );
  });

  it("says what it is doing while the import runs", () => {
    const markup = markupOf(
      <ImportView busy handle={oscabriel} here="/import" url={CLICK} />
    );

    expect(textIn(markup)).toContain("Importing…");
    expect(markup).toMatch(
      /<button(?=[^>]*disabled="")(?=[^>]*type="submit")/u
    );
  });
});

describe(prefillFrom, () => {
  it("reads the source namespace and the name from a known host's URL", () => {
    expect(prefillFrom(CLICK)).toStrictEqual({
      name: Option.some("click"),
      owner: Option.some("github.com/pallets"),
    });
  });

  it("strips .git, lowercases, and keeps a dot inside the name", () => {
    expect(prefillFrom("https://github.com/TJ/Commander.js.git")).toStrictEqual(
      { name: Option.some("commander.js"), owner: Option.some("github.com/tj") }
    );
  });

  it("names no owner for a host the platform does not know, and still the name", () => {
    expect(prefillFrom("https://git.sr.ht/~sircmpwn/hare/")).toStrictEqual({
      name: Option.some("hare"),
      owner: Option.none(),
    });
  });

  it("prefills nothing from what is not an HTTPS URL", () => {
    expect(prefillFrom("git@github.com:pallets/click.git")).toStrictEqual({
      name: Option.none(),
      owner: Option.none(),
    });
    expect(prefillFrom("")).toStrictEqual({
      name: Option.none(),
      owner: Option.none(),
    });
  });
});

describe(ownerChoices, () => {
  it("puts the source namespace first when the host is on the list, then the handle", () => {
    expect(ownerChoices(oscabriel, CLICK)).toStrictEqual([
      "github.com/pallets",
      "oscabriel",
    ]);
  });

  it("offers the handle alone when the host is not on the list", () => {
    expect(
      ownerChoices(oscabriel, "https://git.sr.ht/~sircmpwn/hare")
    ).toStrictEqual(["oscabriel"]);
  });

  it("offers a handle in lowercase, as an owner is spelled", () => {
    expect(
      ownerChoices(Option.some(Handle.make("OscaBriel")), "")
    ).toStrictEqual(["oscabriel"]);
  });
});

describe(importPayload, () => {
  const isPayload = Schema.is(InitProject.payloadSchema);

  it("is initProject's payload: the project and the import, the branch when named", () => {
    const payload = importPayload({
      branch: " stable ",
      name: "click",
      owner: "github.com/pallets",
      url: ` ${CLICK} `,
    });

    expect(payload).toStrictEqual(
      Option.some({
        import: { branch: "stable", url: CLICK },
        project: "github.com/pallets/click",
      })
    );
    expect(Option.exists(payload, isPayload)).toBeTruthy();
  });

  it("carries no branch when none is named", () => {
    expect(
      importPayload({
        branch: "",
        name: "click",
        owner: "oscabriel",
        url: CLICK,
      })
    ).toStrictEqual(
      Option.some({ import: { url: CLICK }, project: "oscabriel/click" })
    );
  });

  it("is none for a name or a URL the contract would not take", () => {
    expect(
      importPayload({
        branch: "",
        name: "Bad Name",
        owner: "oscabriel",
        url: CLICK,
      })
    ).toStrictEqual(Option.none());
    expect(
      importPayload({
        branch: "",
        name: "click",
        owner: "oscabriel",
        url: "http://github.com/pallets/click",
      })
    ).toStrictEqual(Option.none());
  });
});

describe(sourceUrlOf, () => {
  it("rebuilds the URL a source namespace's project was imported from", () => {
    expect(sourceUrlOf(ProjectName.make("github.com/pallets/click"))).toBe(
      CLICK
    );
  });
});

/** `initProject`'s answer: the project made. */
const made = (project: string) =>
  Schema.decodeSync(InitProject.successSchema)({
    project,
    remote: `https://platform.test/${project}.git`,
  });

describe(importMade, () => {
  it("names the project an import made, once it answered", () => {
    expect(
      importMade(AsyncResult.success(made("github.com/pallets/click")))
    ).toStrictEqual(Option.some("github.com/pallets/click"));
  });

  it("names none while an import runs, or after it was refused", () => {
    const earlier = AsyncResult.success(made("oscabriel/click"));

    expect(importMade(AsyncResult.waiting(earlier))).toStrictEqual(
      Option.none()
    );
    expect(
      importMade(
        AsyncResult.fail(
          new ImportFailed({ next: "x", reason: "unreachable" }),
          { previousSuccess: Option.some(earlier) }
        )
      )
    ).toStrictEqual(Option.none());
  });
});

describe("a refused import", () => {
  const click = ProjectName.make("github.com/pallets/click");

  it.each([
    [
      "ImportFailed",
      new ImportFailed({
        next: `${Brand.cli} init`,
        reason: "the repo could not be read",
      }),
    ],
    [
      "ProjectExists",
      new ProjectExists({ next: `${Brand.cli} asks`, project: click }),
    ],
    [
      "NotYourNamespace",
      NotYourNamespace.of(
        ProjectName.make("github.com/someone/click"),
        Handle.make("oscabriel")
      ),
    ],
  ])("reads as the platform's %s, under the form", (tag, refusal) => {
    const markup = markupOf(
      <ImportView handle={oscabriel} here="/import" url={CLICK}>
        <ProposalFailure
          cause={Cause.fail(refusal)}
          doing="import it"
          here="/import"
        />
      </ImportView>
    );

    expect(markup).toContain(`data-refusal="${tag}"`);
    expect(markup).toContain("<form");
  });
});
