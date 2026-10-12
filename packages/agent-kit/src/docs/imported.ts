import { ProjectKey, ProjectName, sourceNamespaceOf } from "@repo/protocol/ids";
import { Option } from "effect";

export interface ImportedProject {
  readonly name: ProjectName;
  readonly key: ProjectKey;
  readonly url: string;
  readonly licence: string;
  readonly kind: string;
}

const imported = (
  key: string,
  url: string,
  licence: string,
  kind: string
): ImportedProject => ({
  key: ProjectKey.make(key),
  kind,
  licence,
  name: ProjectName.make(`${Option.getOrThrow(sourceNamespaceOf(url))}/${key}`),
  url,
});

export const importedProjects: readonly ImportedProject[] = [
  imported(
    "anyhow",
    "https://github.com/dtolnay/anyhow",
    "MIT OR Apache-2.0",
    "Rust crate"
  ),
  imported(
    "ky",
    "https://github.com/sindresorhus/ky",
    "MIT",
    "TypeScript library"
  ),
  imported("gum", "https://github.com/charmbracelet/gum", "MIT", "Go CLI"),
  imported(
    "click",
    "https://github.com/pallets/click",
    "BSD-3-Clause",
    "Python package"
  ),
  imported(
    "awesome",
    "https://github.com/sindresorhus/awesome",
    "CC0-1.0",
    "Markdown list"
  ),
  imported(
    "changesets",
    "https://github.com/changesets/changesets",
    "MIT",
    "TypeScript monorepo"
  ),
  imported(
    "stb",
    "https://github.com/nothings/stb",
    "MIT OR Unlicense",
    "C single-file headers"
  ),
  imported(
    "fuzzel",
    "https://codeberg.org/dnkl/fuzzel",
    "MIT",
    "C on Codeberg"
  ),
  imported(
    "hono",
    "https://github.com/honojs/hono",
    "MIT",
    "TypeScript web framework"
  ),
  imported(
    "express",
    "https://github.com/expressjs/express",
    "MIT",
    "JavaScript web framework"
  ),
  imported(
    "fastify",
    "https://github.com/fastify/fastify",
    "MIT",
    "JavaScript web framework"
  ),
  imported(
    "zustand",
    "https://github.com/pmndrs/zustand",
    "MIT",
    "TypeScript state library"
  ),
  imported(
    "immer",
    "https://github.com/immerjs/immer",
    "MIT",
    "JavaScript immutable state"
  ),
  imported(
    "nanoid",
    "https://github.com/ai/nanoid",
    "MIT",
    "JavaScript ID generator"
  ),
  imported(
    "commander",
    "https://github.com/tj/commander.js",
    "MIT",
    "JavaScript CLI parser"
  ),
  imported(
    "execa",
    "https://github.com/sindresorhus/execa",
    "MIT",
    "JavaScript process runner"
  ),
  imported(
    "chalk",
    "https://github.com/chalk/chalk",
    "MIT",
    "JavaScript terminal colours"
  ),
  imported(
    "mitt",
    "https://github.com/developit/mitt",
    "MIT",
    "TypeScript event emitter"
  ),
  imported(
    "clsx",
    "https://github.com/lukeed/clsx",
    "MIT",
    "JavaScript class names"
  ),
  imported(
    "ripgrep",
    "https://github.com/BurntSushi/ripgrep",
    "Unlicense OR MIT",
    "Rust CLI"
  ),
  imported(
    "serde",
    "https://github.com/serde-rs/serde",
    "MIT OR Apache-2.0",
    "Rust serialization"
  ),
  imported(
    "axum",
    "https://github.com/tokio-rs/axum",
    "MIT",
    "Rust web framework"
  ),
  imported(
    "fd",
    "https://github.com/sharkdp/fd",
    "MIT OR Apache-2.0",
    "Rust CLI"
  ),
  imported(
    "hyperfine",
    "https://github.com/sharkdp/hyperfine",
    "MIT OR Apache-2.0",
    "Rust benchmarking CLI"
  ),
  imported(
    "bubbletea",
    "https://github.com/charmbracelet/bubbletea",
    "MIT",
    "Go TUI framework"
  ),
  imported("fzf", "https://github.com/junegunn/fzf", "MIT", "Go fuzzy finder"),
  imported(
    "cobra",
    "https://github.com/spf13/cobra",
    "Apache-2.0",
    "Go CLI library"
  ),
  imported(
    "gin",
    "https://github.com/gin-gonic/gin",
    "MIT",
    "Go web framework"
  ),
  imported(
    "requests",
    "https://github.com/psf/requests",
    "Apache-2.0",
    "Python HTTP library"
  ),
  imported(
    "flask",
    "https://github.com/pallets/flask",
    "BSD-3-Clause",
    "Python web framework"
  ),
  imported(
    "httpx",
    "https://github.com/encode/httpx",
    "BSD-3-Clause",
    "Python HTTP client"
  ),
  imported(
    "typer",
    "https://github.com/fastapi/typer",
    "MIT",
    "Python CLI library"
  ),
  imported(
    "jinja",
    "https://github.com/pallets/jinja",
    "BSD-3-Clause",
    "Python templates"
  ),
  imported(
    "lua",
    "https://github.com/lua/lua",
    "MIT",
    "C language interpreter"
  ),
  imported("jq", "https://github.com/jqlang/jq", "MIT", "C JSON processor"),
  imported(
    "kilo",
    "https://github.com/antirez/kilo",
    "BSD-2-Clause",
    "C text editor"
  ),
  imported(
    "sinatra",
    "https://github.com/sinatra/sinatra",
    "MIT",
    "Ruby web framework"
  ),
  imported(
    "nvm",
    "https://github.com/nvm-sh/nvm",
    "MIT",
    "Shell version manager"
  ),
];
