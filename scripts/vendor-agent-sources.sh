#!/usr/bin/env bash
# Ported from joelhooks/rat-stack@fba26d8 `scripts/vendor-agent-sources.sh`
# (MIT, LICENSES/rat-stack.MIT.txt). Changes are listed in PROVENANCE.md.
#
# Clones the exact source of the Effect and Wrangler versions this repo pins
# into .agent_sources/<repo>, for agents to read as API truth. Reference only:
# nothing imports it, and .gitignore keeps it out of git.
#
#   bash scripts/vendor-agent-sources.sh            # clone what is missing or moved
#   bash scripts/vendor-agent-sources.sh --refresh  # clone both again
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCES="${ROOT}/.agent_sources"
REFRESH=false

for arg in "$@"; do
  case "$arg" in
    --refresh) REFRESH=true ;;
    -h | --help)
      echo "Usage: $0 [--refresh]"
      echo "Clones pinned Effect and workers-sdk source into .agent_sources/."
      exit 0
      ;;
    *)
      echo "Unknown arg: $arg" >&2
      exit 1
      ;;
  esac
done

# One field of a JSON file, or an empty line when it is absent.
json_field() {
  node -p 'const v = require(process.argv[1]); process.argv[2].split(".").reduce((o, k) => (o == null ? undefined : o[k]), v) ?? ""' "$1" "$2"
}

# The version a package.json pins, refused unless it is one exact version.
pin() {
  local file="$1" field="$2" version
  version="$(json_field "${ROOT}/${file}" "$field")"

  if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
    echo "${file} ${field} is '${version}', not one exact version; pin it before vendoring." >&2
    exit 1
  fi

  echo "$version"
}

# clone_source <repo> <remote> <tag> <package.json in the clone> <version> <note>
clone_source() {
  local repo="$1" remote="$2" ref="$3" manifest="$4" version="$5" note="$6"
  local dest="${SOURCES}/${repo}"
  local metadata="${dest}/.agent-source.json"
  local commit cloned

  # The metadata is written last, so its presence marks a finished clone.
  if [[ "$REFRESH" != true && -f "$metadata" ]]; then
    if [[ "$(json_field "$metadata" ref)" == "$ref" ]]; then
      echo "skip ${repo} @ ${ref} (present; pass --refresh to clone again)"
      return 0
    fi

    echo "${repo}: the pin moved to ${ref}; cloning again"
  fi

  if ! git ls-remote --exit-code --refs "$remote" "refs/tags/${ref}" >/dev/null; then
    echo "Cannot resolve tag ${ref} at ${remote}; refusing to fall back to another ref." >&2
    exit 1
  fi

  rm -rf "$dest"
  mkdir -p "$SOURCES"
  echo "clone ${repo} @ ${ref}"
  # For an annotated tag, git warns that it "is not a commit"; the checkout is
  # still the commit the tag points at.
  git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$ref" "$remote" "$dest"
  commit="$(git -C "$dest" rev-parse HEAD)"

  cloned="$(json_field "${dest}/${manifest}" version)"
  if [[ "$cloned" != "$version" ]]; then
    rm -rf "$dest"
    echo "${repo} @ ${ref} has ${manifest} at version '${cloned}', not ${version}; refusing it." >&2
    exit 1
  fi

  cat >"$metadata" <<EOF
{
  "type": "git-source",
  "repo": "${repo}",
  "remote": "${remote}",
  "ref": "${ref}",
  "commit": "${commit}",
  "version": "${version}",
  "addedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "note": "${note} Refresh: bash scripts/vendor-agent-sources.sh --refresh"
}
EOF

  echo "  -> ${dest} (${commit})"
}

# The pins come from the package.json files, so a bump there is a bump here.
EFFECT_VERSION="$(pin package.json workspaces.catalog.effect)"
WRANGLER_VERSION="$(pin apps/platform/package.json devDependencies.wrangler)"

clone_source effect https://github.com/Effect-TS/effect.git "effect@${EFFECT_VERSION}" \
  packages/effect/package.json "$EFFECT_VERSION" \
  "Effect v4 matching the root catalog's effect@${EFFECT_VERSION}."
clone_source workers-sdk https://github.com/cloudflare/workers-sdk.git "wrangler@${WRANGLER_VERSION}" \
  packages/wrangler/package.json "$WRANGLER_VERSION" \
  "Wrangler and Miniflare matching apps/platform's wrangler@${WRANGLER_VERSION}."

echo "done: agent sources under ${SOURCES}"
