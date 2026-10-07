# The Checker's image: where an answer's checks run, with no credentials
# (spec §4.3). Debian trixie slim, Node 24, Bun 1.4.2, git and corepack, plus
# the Sandbox SDK's `sandbox-shim`, which `Files` runs. A stub until W3 315
# adds the phases' tools.
FROM docker.io/cloudflare/sandbox:1.0.0 AS shim
FROM docker.io/oven/bun:1.4.2-slim AS bun
FROM docker.io/library/node:24-trixie-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

COPY --from=shim /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /workspace
