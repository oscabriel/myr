/**
 * What a page puts in the document's head, in a module with no view of its
 * own: a route's `head` runs with the route, before its page's view loads.
 */
import { Brand } from "@repo/brand";

/** A page's `<title>`: the page, then the product. */
export const pageTitle = (title: string) => `${title} · ${Brand.name}`;

/**
 * A page's head: its `<title>`, and what a shared link unfurls with (the
 * description and the Open Graph title, description and type; no image).
 * The router keeps one meta per name or Open Graph property, the last a
 * route gives, so a page's replace the root's, and a page with no
 * description of its own unfurls with the root's.
 *
 * ```ts
 * head: ({ params }) => pageHead({ title: `${params.ask} · ${params.project}`, description: want }),
 * ```
 */
export const pageHead = ({
  description,
  title,
  type = "website",
}: {
  readonly description?: string;
  readonly title: string;
  readonly type?: "article" | "website";
}) => ({
  meta: [
    { title: pageTitle(title) },
    { content: title, property: "og:title" },
    { content: type, property: "og:type" },
    ...(description === undefined
      ? []
      : [
          { content: description, name: "description" },
          { content: description, property: "og:description" },
        ]),
  ],
});
