import { useAtomValue } from "@effect/atom-react";
import { describe, expect, it } from "@effect/vitest";
import { Atom } from "effect/reactivity";
import { renderToStaticMarkup } from "react-dom/server";

import { seed, SeededAtoms } from "../src/client/seeded.ts";

const verdictWord = Atom.make("unread");

const Reader = () => <p>{useAtomValue(verdictWord)}</p>;

const page = (read: string) =>
  renderToStaticMarkup(
    <SeededAtoms id={read} seeds={[seed(verdictWord, read)]}>
      <Reader />
    </SeededAtoms>
  );

describe("atoms seeded from a loader's read", () => {
  it("renders each page from its own loader's read, and neither from the other's", () => {
    const first = page("refused at shape");
    const second = page("landed as 9b1c3e5");

    expect({ first, second }).toStrictEqual({
      first: "<p>refused at shape</p>",
      second: "<p>landed as 9b1c3e5</p>",
    });
  });

  it("leaves the registry every request shares as it was", () => {
    page("refused at shape");

    expect(renderToStaticMarkup(<Reader />)).toBe("<p>unread</p>");
  });
});
