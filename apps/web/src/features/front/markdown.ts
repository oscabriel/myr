/**
 * A list page that also answers agents: the same URL gives the page to a
 * browser and Markdown to a request that asks for it (`Accept:
 * text/markdown`), so the answer varies by `Accept`, and the page names its
 * Markdown as an alternate, in its head and in a `Link` header.
 */

/** `response`, marked as one of several answers to its URL, chosen by `Accept`. */
export const variedByAccept = (response: Response): Response => {
  const headers = new Headers(response.headers);

  headers.set("vary", "Accept");

  return new Response(response.body, { headers, status: response.status });
};

/** The `Link` header naming `href` as the page's Markdown. */
export const markdownLink = (href: string) =>
  `<${href}>; rel="alternate"; type="text/markdown"`;

/** The head's link naming `href` as the page's Markdown. */
export const markdownAlternateLink = (href: string) => ({
  href,
  rel: "alternate",
  type: "text/markdown",
});
