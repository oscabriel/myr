/** Go to file's matching: every word of the query in the path, a match in the file's own name first. */
export const FILES_SHOWN = 50;

const nameOf = (path: string) => path.split("/").at(-1) ?? path;

export const filesMatching = (
  paths: readonly string[],
  query: string,
  limit: number = FILES_SHOWN
): readonly string[] => {
  const words = query
    .toLowerCase()
    .split(/\s+/u)
    .filter((word) => word !== "");

  const scored = paths.flatMap((path) => {
    const lower = path.toLowerCase();

    if (!words.every((word) => lower.includes(word))) {
      return [];
    }

    const name = nameOf(lower);

    const inName =
      words.length > 0 && words.every((word) => name.includes(word));

    return [{ inName, path }];
  });

  return scored
    .toSorted(
      (one, other) =>
        Number(other.inName) - Number(one.inName) ||
        one.path.length - other.path.length ||
        one.path.localeCompare(other.path)
    )
    .slice(0, limit)
    .map(({ path }) => path);
};
