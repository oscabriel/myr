import { Brand } from "@repo/brand";

export const pageTitle = (title: string) => `${title} · ${Brand.name}`;

/**
 * The router keeps one meta per name or Open Graph property, the last a route
 * gives, so a page's replace the root's.
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
