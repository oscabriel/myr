# The Lander's image: trusted, it runs git and bun's bundler and never an
# answer's code (spec §4.3). Debian trixie slim with its git (2.47.3 when this
# was written; `merge-tree --write-tree` needs 2.38 or later, and the build
# prints the version), Bun 1.4.2 for `bundleRules`, the sdk under /opt/sdk
# with the packages it imports beside it, and the Sandbox SDK's
# `sandbox-shim`, which `Files` runs.
#
# The build context is the repo root, and the image copies from it only the
# sources of the sdk and the packages it imports. The Lander points a
# config folder's imports of the sdk at /opt/sdk (`src/lander/run.ts`'s
# `Layout`), and reads the sdk's version from /opt/sdk/version.
FROM docker.io/cloudflare/sandbox:1.0.0 AS shim

FROM docker.io/oven/bun:1.4.2-slim AS sdk
WORKDIR /opt/sdk
# The effect the repo's catalog pins (`lander.test.ts` holds the two equal).
RUN printf '{ "private": true }\n' > package.json \
  && bun add --exact effect@4.0.1
# Each package's manifest and sources by name, never a folder whole: wrangler
# hands docker this file on stdin, so no ignore file filters the context, and
# a package's own node_modules must not come along.
COPY packages/brand/package.json node_modules/@repo/brand/package.json
COPY packages/brand/src node_modules/@repo/brand/src
COPY packages/protocol/package.json node_modules/@repo/protocol/package.json
COPY packages/protocol/src node_modules/@repo/protocol/src
COPY packages/sdk/package.json node_modules/@repo/sdk/package.json
COPY packages/sdk/src node_modules/@repo/sdk/src
RUN bun --eval 'import { sdkVersion } from "@repo/sdk"; await Bun.write("/opt/sdk/version", `${sdkVersion}\n`);' \
  && test -s /opt/sdk/version

FROM docker.io/library/debian:trixie-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/* \
  && git --version

COPY --from=shim /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim
COPY --from=sdk /usr/local/bin/bun /usr/local/bin/bun
COPY --from=sdk /opt/sdk /opt/sdk

WORKDIR /workspace
