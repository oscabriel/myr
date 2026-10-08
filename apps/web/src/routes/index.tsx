import { Brand } from "@repo/brand";
import { createFileRoute } from "@tanstack/react-router";

// A placeholder; issue 503 builds the front page here.

const Home = () => (
  <main>
    <h1>{Brand.name}</h1>
    <p>The front page is not built yet.</p>
  </main>
);

export const Route = createFileRoute("/")({
  component: Home,
  head: () => ({ meta: [{ title: Brand.name }] }),
});
