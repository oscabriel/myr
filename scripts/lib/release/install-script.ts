/**
 * The install script the platform serves at `<origin>/install.sh` (issue
 * 420), as the release writes it for one version and one origin (issue
 * 715): `curl -fsSL <origin>/install.sh | sh`. POSIX `sh`, so it runs on
 * Linux and macOS as they come. It downloads the binary for the machine
 * from the platform, checks it against the release's `SHA256SUMS` from the
 * same place, and installs nothing unless the two agree.
 */
import type { Brand } from "@repo/brand";

/** `value` as one single-quoted shell word. */
const quoted = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

/**
 * The script for `version`, whose files are at `baseUrl`: the stage's
 * public origin and `/releases/<version>`, where the platform serves
 * `<slug>-<target>` and `SHA256SUMS`. `machines` are the targets a release
 * builds, without Bun's `bun-` prefix (`linux-x64`). It installs the
 * binary as `<dir>/<cli>` and links `<dir>/git-credential-<slug>` to it (the
 * one binary is git's credential helper when started by that name); `<dir>`
 * is `$<SLUG>_INSTALL_DIR`, or `~/.local/bin`.
 */
export const installScriptFor = (input: {
  readonly brand: typeof Brand;
  readonly version: string;
  readonly baseUrl: string;
  readonly machines: readonly string[];
}): string => {
  const { brand, machines } = input;
  const installDir = `${brand.slug.toUpperCase()}_INSTALL_DIR`;

  return [
    "#!/bin/sh",
    `# Installs ${brand.cli} ${input.version}, the ${brand.name} command line, from`,
    `# ${input.baseUrl}.`,
    "#",
    "# It downloads the binary for this machine, checks it against the",
    "# release's SHA256SUMS, and installs it as <dir>/" +
      `${brand.cli}, with <dir>/${brand.gitCredentialHelper}`,
    `# beside it (git's credential helper). <dir> is $${installDir},`,
    "# or ~/.local/bin. Nothing is installed unless the checksum matches.",
    "set -eu",
    "",
    `base=${quoted(input.baseUrl)}`,
    `version=${quoted(input.version)}`,
    `slug=${quoted(brand.slug)}`,
    `name=${quoted(brand.cli)}`,
    `helper=${quoted(brand.gitCredentialHelper)}`,
    `dir="\${${installDir}:-$HOME/.local/bin}"`,
    "",
    "fail() {",
    '  echo "$name install: $*" >&2',
    "  exit 1",
    "}",
    "",
    'case "$(uname -s)" in',
    "  Linux) os=linux ;;",
    "  Darwin) os=darwin ;;",
    '  *) os="$(uname -s)" ;;',
    "esac",
    "",
    'case "$(uname -m)" in',
    "  x86_64 | amd64) arch=x64 ;;",
    "  arm64 | aarch64) arch=arm64 ;;",
    '  *) arch="$(uname -m)" ;;',
    "esac",
    "",
    'case "$os-$arch" in',
    `  ${machines.join(" | ")}) asset="$slug-$os-$arch" ;;`,
    `  *) fail "no build for $os-$arch; $version is built for ${machines.join(" and ")}" ;;`,
    "esac",
    "",
    "if command -v curl >/dev/null 2>&1; then",
    '  fetch() { curl -fsSL "$1" -o "$2"; }',
    "elif command -v wget >/dev/null 2>&1; then",
    '  fetch() { wget -q -O "$2" "$1"; }',
    "else",
    '  fail "needs curl or wget to download $version"',
    "fi",
    "",
    "if command -v sha256sum >/dev/null 2>&1; then",
    "  digest() { sha256sum \"$1\" | cut -d ' ' -f 1; }",
    "elif command -v shasum >/dev/null 2>&1; then",
    "  digest() { shasum -a 256 \"$1\" | cut -d ' ' -f 1; }",
    "else",
    '  fail "needs sha256sum or shasum to check the download"',
    "fi",
    "",
    'tmp="$(mktemp -d)"',
    "trap 'rm -rf \"$tmp\"' EXIT",
    "trap 'exit 1' HUP INT TERM",
    "",
    'fetch "$base/$asset" "$tmp/$asset" || fail "could not download $base/$asset"',
    'fetch "$base/SHA256SUMS" "$tmp/SHA256SUMS" || fail "could not download $base/SHA256SUMS"',
    "",
    'expected="$(awk -v asset="$asset" \'$2 == asset { print $1 }\' "$tmp/SHA256SUMS")"',
    '[ -n "$expected" ] || fail "SHA256SUMS lists no $asset; nothing was installed"',
    'actual="$(digest "$tmp/$asset")"',
    '[ "$actual" = "$expected" ] || fail "$asset does not match SHA256SUMS (expected $expected, got $actual); nothing was installed"',
    "",
    'mkdir -p "$dir"',
    'chmod 755 "$tmp/$asset"',
    'mv -f "$tmp/$asset" "$dir/$name"',
    'ln -sf "$name" "$dir/$helper"',
    "",
    'echo "installed $name $version as $dir/$name, with $helper beside it"',
    'case ":$PATH:" in',
    '  *":$dir:"*) ;;',
    '  *) echo "add $dir to your PATH to run $name" ;;',
    "esac",
    "",
  ].join("\n");
};
