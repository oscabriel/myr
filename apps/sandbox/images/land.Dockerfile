# The Lander's image: trusted, it runs git and Bun and never an answer's code
# (spec §4.3). Debian trixie slim, git, Bun 1.4.2 for `bundleRules`, plus the
# Sandbox SDK's `sandbox-shim`, which `Files` runs. Its build context is the
# repo root, so W3 306 can copy the sdk in for `bundleRules`; a stub until
# then.
FROM docker.io/cloudflare/sandbox:1.0.0 AS shim
FROM docker.io/oven/bun:1.4.2-slim AS bun
FROM docker.io/library/debian:trixie-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

COPY --from=shim /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /workspace
