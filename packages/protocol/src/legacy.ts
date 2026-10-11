/**
 * The projects made before owners (ADR 0032): each keeps the flat key it
 * was made with, as its Durable Object's id, its repo's name and its
 * projection rows, and reads as the name here. The two examples are the
 * operator's; each import is at its source path. `ProjectName`'s decode
 * gives a bare key its name, and `keyOf` and `nameOfKey` consult this
 * first; `packages/config/test/legacy-projects.test.ts` holds the rows to
 * the examples and the import plan. Plain strings, read by `ids.ts`, so
 * nothing here imports a schema. A cartridge: re-key the forty and delete
 * this file with the two lookups in `ids.ts` that read it.
 */
export const legacyProjects: readonly {
  readonly key: string;
  readonly name: string;
}[] = [
  { key: "datekit", name: "oscabriel/datekit" },
  { key: "burrow", name: "oscabriel/burrow" },
  { key: "anyhow", name: "github.com/dtolnay/anyhow" },
  { key: "ky", name: "github.com/sindresorhus/ky" },
  { key: "gum", name: "github.com/charmbracelet/gum" },
  { key: "click", name: "github.com/pallets/click" },
  { key: "awesome", name: "github.com/sindresorhus/awesome" },
  { key: "changesets", name: "github.com/changesets/changesets" },
  { key: "stb", name: "github.com/nothings/stb" },
  { key: "fuzzel", name: "codeberg.org/dnkl/fuzzel" },
  { key: "hono", name: "github.com/honojs/hono" },
  { key: "express", name: "github.com/expressjs/express" },
  { key: "fastify", name: "github.com/fastify/fastify" },
  { key: "zustand", name: "github.com/pmndrs/zustand" },
  { key: "immer", name: "github.com/immerjs/immer" },
  { key: "nanoid", name: "github.com/ai/nanoid" },
  { key: "commander", name: "github.com/tj/commander" },
  { key: "execa", name: "github.com/sindresorhus/execa" },
  { key: "chalk", name: "github.com/chalk/chalk" },
  { key: "mitt", name: "github.com/developit/mitt" },
  { key: "clsx", name: "github.com/lukeed/clsx" },
  { key: "ripgrep", name: "github.com/burntsushi/ripgrep" },
  { key: "serde", name: "github.com/serde-rs/serde" },
  { key: "axum", name: "github.com/tokio-rs/axum" },
  { key: "fd", name: "github.com/sharkdp/fd" },
  { key: "hyperfine", name: "github.com/sharkdp/hyperfine" },
  { key: "bubbletea", name: "github.com/charmbracelet/bubbletea" },
  { key: "fzf", name: "github.com/junegunn/fzf" },
  { key: "cobra", name: "github.com/spf13/cobra" },
  { key: "gin", name: "github.com/gin-gonic/gin" },
  { key: "requests", name: "github.com/psf/requests" },
  { key: "flask", name: "github.com/pallets/flask" },
  { key: "httpx", name: "github.com/encode/httpx" },
  { key: "typer", name: "github.com/fastapi/typer" },
  { key: "jinja", name: "github.com/pallets/jinja" },
  { key: "lua", name: "github.com/lua/lua" },
  { key: "jq", name: "github.com/jqlang/jq" },
  { key: "kilo", name: "github.com/antirez/kilo" },
  { key: "sinatra", name: "github.com/sinatra/sinatra" },
  { key: "nvm", name: "github.com/nvm-sh/nvm" },
];
