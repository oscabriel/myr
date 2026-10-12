import { RegistryContext } from "@effect/atom-react";
import { describe, expect, it } from "@effect/vitest";
import { Brand } from "@repo/brand";
import { Contracts, InitProject } from "@repo/protocol/contracts";
import { Handle, Owner, ProjectName } from "@repo/protocol/ids";
import {
  ImportFailed,
  NotYourNamespace,
  ProjectExists,
} from "@repo/protocol/refusal";
import { asPerson, unanswered } from "@repo/protocol/testing";
import { Cause, Effect, Exit, Layer, Option, Schema } from "effect";
import { Atom, AsyncResult, AtomRegistry, Reactivity } from "effect/reactivity";
import { RpcTest } from "effect/rpc";

import { importAtom, importMade } from "../src/client/import.ts";
import type { Importer } from "../src/features/import/import-form.tsx";
import { ImportView } from "../src/features/import/import-page.tsx";
import {
  importPayload,
  ownerChoices,
  prefillFrom,
  sourceUrlOf,
} from "../src/features/import/prefill.ts";
import type { ImportPayload } from "../src/features/import/prefill.ts";
import {
  afterImport,
  useImporter,
} from "../src/features/import/use-importer.tsx";
import { ProposalFailure } from "../src/features/proposal/failure.tsx";
import { importHeaders, importSearch, Route } from "../src/routes/import.tsx";
import { ContractsClient, webContracts } from "../src/surfaces.ts";
import { markupOf, textIn } from "./markup.ts";
import { renderAt, routerAt } from "./render.tsx";

const CLICK = "https://github.com/pallets/click";

const oscabriel = Option.some(Handle.make("oscabriel"));

const signedIn = (url = CLICK) =>
  markupOf(<ImportView handle={oscabriel} here="/import" url={url} />);

const inputNamed = (markup: string, name: string) =>
  new RegExp(`<input[^>]*name="${name}"[^>]*>`, "u").exec(markup)?.[0] ?? "";

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
      owner: Owner.make("github.com/pallets"),
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
        owner: Owner.make("oscabriel"),
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
        owner: Owner.make("oscabriel"),
        url: CLICK,
      })
    ).toStrictEqual(Option.none());
    expect(
      importPayload({
        branch: "",
        name: "click",
        owner: Owner.make("oscabriel"),
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
      <ImportView
        handle={oscabriel}
        here="/import"
        refusal={
          <ProposalFailure
            cause={Cause.fail(refusal)}
            doing="import it"
            here="/import"
          />
        }
        url={CLICK}
      />
    );

    expect(markup).toContain(`data-refusal="${tag}"`);
    expect(markup).toContain("<form");
  });
});

// A server's render always reads who is signed in as not yet known, so this one says, as the browser would, that oscabriel is.
const Page = ({
  seen,
}: {
  readonly seen?: ((importer: Importer) => void) | undefined;
}) => {
  const importer = useImporter();

  seen?.(importer);

  return (
    <ImportView
      {...importer}
      checking={false}
      handle={oscabriel}
      here="/import"
      url={CLICK}
    />
  );
};

const PageOver = ({
  registry,
  seen,
}: {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly seen?: (importer: Importer) => void;
}) => (
  <RegistryContext.Provider value={registry}>
    <Page seen={seen} />
  </RegistryContext.Provider>
);

const browserWith = (
  sent: ImportPayload[],
  answer: (
    payload: ImportPayload
  ) => Effect.Effect<
    typeof InitProject.successSchema.Type,
    typeof InitProject.errorSchema.Type
  >
) =>
  AtomRegistry.make({
    initialValues: [
      Atom.initialValue(
        ContractsClient.runtime.layer,
        Layer.effect(
          ContractsClient,
          RpcTest.makeClient(webContracts, { flatten: true })
        ).pipe(
          Layer.provide([
            Layer.mergeAll(
              unanswered,
              Contracts.toLayerHandler("initProject", (payload) => {
                sent.push(payload);

                return answer(payload);
              })
            ),
            asPerson(Handle.make("oscabriel")),
          ]),
          Layer.provideMerge(Reactivity.layer)
        )
      ),
    ],
  });

const fieldsIn = (markup: string) => {
  const value = (name: string) =>
    /value="(?<value>[^"]*)"/u
      .exec(inputNamed(markup, name))
      ?.groups?.value?.replaceAll("&amp;", "&") ?? "";

  return {
    branch: value("branch"),
    name: value("name"),
    owner: Owner.make(value("owner")),
    url: value("url"),
  };
};

const pressImport = (registry: AtomRegistry.AtomRegistry) =>
  Effect.gen(function* () {
    const importers: Importer[] = [];

    const markup = yield* renderAt(
      `/import?url=${encodeURIComponent(CLICK)}`,
      <PageOver
        registry={registry}
        seen={(importer) => {
          importers.push(importer);
        }}
      />
    );

    const payload = yield* Effect.fromOption(importPayload(fieldsIn(markup)));

    // A page in the browser keeps the atom mounted while it waits; a
    // server's render keeps nothing.
    registry.mount(importAtom);
    importers.at(-1)?.onImport?.(payload);

    return yield* Effect.exit(
      AtomRegistry.getResult(registry, importAtom, { suspendOnWaiting: true })
    );
  });

describe("pressing Import", () => {
  it.live(
    "sends initProject the project and the import, then goes to the project's address",
    () =>
      Effect.gen(function* () {
        const sent: ImportPayload[] = [];

        const registry = browserWith(sent, ({ project }) =>
          Effect.succeed(made(project))
        );

        const answered = yield* pressImport(registry);

        const to = yield* Effect.fromOption(
          Exit.match(answered, {
            onFailure: () => Option.none(),
            onSuccess: ({ project }) => afterImport(project),
          })
        );

        const router = routerAt("/import");

        yield* Effect.tryPromise(() => router.load());

        expect(sent).toStrictEqual([
          { import: { url: CLICK }, project: "github.com/pallets/click" },
        ]);
        // Where the hook's `navigate` goes: a router with no window to
        // move only builds the location, as `navigate` does first.
        expect(router.buildLocation(to).publicHref).toBe(
          "/github.com/pallets/click"
        );
      })
  );

  it.live("draws a refusal as the platform gave it, under the form", () =>
    Effect.gen(function* () {
      const registry = browserWith([], ({ project }) =>
        Effect.fail(NotYourNamespace.of(project, Handle.make("oscabriel")))
      );

      yield* pressImport(registry);

      const markup = yield* renderAt(
        "/import",
        <PageOver registry={registry} />
      );

      expect(markup).toContain('data-refusal="NotYourNamespace"');
      expect(markup).toContain("<form");
    })
  );

  it("stays where it is when the import made the project this address names", () => {
    const click = ProjectName.make("github.com/pallets/click");

    expect(afterImport(click, click)).toStrictEqual(Option.none());
  });
});
