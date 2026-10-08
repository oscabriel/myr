# The Checker's image: where an answer's checks run, with no credentials
# (`src/checker/run.ts` runs the phases). Debian trixie slim with
# Node 24, Bun 1.4.2, git and corepack (pnpm and Yarn, fetched from the npm
# registry during setup), plus the Sandbox SDK's `sandbox-shim`, which `Files`
# runs. Nothing is copied from the build context, and no token, remote or
# secret is baked in: the clone goes through the Worker's clone gateway.
#
# The TLS CA every request out of the container is checked against is the one
# the outbound intercepts present. It is written into the container when it
# runs (/etc/cloudflare/certs/cloudflare-containers-ca.crt), never here; the
# Checker points git, Node, Bun, pip and cargo at it through their env vars.
FROM docker.io/cloudflare/sandbox:1.0.0 AS shim
FROM docker.io/oven/bun:1.4.2-slim AS bun
FROM docker.io/library/node:24-trixie-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

COPY --from=shim /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx

WORKDIR /workspace

# The Checker runs every command beside this one through the Container API's
# `exec`, so the container only has to stay up until its Durable Object
# destroys it.
CMD ["sleep", "infinity"]
