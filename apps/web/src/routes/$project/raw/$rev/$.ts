import { createFileRoute } from "@tanstack/react-router";

// A file's bytes at a revision, as the platform serves them under its
// sandboxing headers. A stub answering 501 until 904 forwards it to the
// platform (whose side 903 builds).

const notBuilt = () =>
  new Response("Not built yet (904).\n", {
    headers: { "content-type": "text/plain; charset=utf-8" },
    status: 501,
  });

export const Route = createFileRoute("/$project/raw/$rev/$")({
  server: { handlers: { GET: notBuilt, HEAD: notBuilt } },
});
