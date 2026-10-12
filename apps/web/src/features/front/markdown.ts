export const variedByAccept = (response: Response): Response => {
  const headers = new Headers(response.headers);

  headers.set("vary", "Accept");

  return new Response(response.body, { headers, status: response.status });
};

export const markdownLink = (href: string) =>
  `<${href}>; rel="alternate"; type="text/markdown"`;

export const markdownAlternateLink = (href: string) => ({
  href,
  rel: "alternate",
  type: "text/markdown",
});
