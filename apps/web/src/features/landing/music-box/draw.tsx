/**
 * Marks as SVG. Every solid draws the same nine paths whatever it holds, so
 * the motion can repaint a part that changes shape by writing each path's
 * `d` in order, and never re-renders.
 */
import type { Solid } from "./iso.ts";
import type { LineMark, Mark, SolidMark } from "./marks.ts";

const Line = ({ mark }: { readonly mark: LineMark }) => (
  <path
    className="mbx-line"
    d={mark.d}
    data-free={mark.free === true ? "" : undefined}
    data-tone={mark.tone}
    style={mark.width === undefined ? undefined : { strokeWidth: mark.width }}
  />
);

const SHADES = [0, 1, 2, 3] as const;

const SolidPaths = ({ mark }: { readonly mark: SolidMark }) => {
  const crease = mark.crease ?? "faint";

  return (
    <g
      className="mbx-solid"
      data-flat={mark.flat === true ? "" : undefined}
      data-glass={mark.glass === true ? "" : undefined}
      data-lit={mark.lit === true ? "" : undefined}
    >
      <path className="mbx-fill" d={mark.solid.fill} />
      {SHADES.map((shade) => (
        <path
          className="mbx-shade"
          d={mark.solid.shades[shade]}
          data-shade={shade}
          key={shade}
        />
      ))}
      <path className="mbx-top" d={mark.solid.top} />
      <path
        className="mbx-line mbx-crease"
        d={crease === "none" ? "" : mark.solid.crease}
        data-tone={crease}
      />
      <path
        className="mbx-line mbx-bevel"
        d={crease === "none" ? "" : mark.solid.bevel}
        data-tone={crease}
      />
      {(mark.inner ?? []).map((inner) => (
        <Line key={inner.d} mark={inner} />
      ))}
      <path
        className="mbx-line mbx-edge"
        d={mark.solid.outline}
        data-tone={mark.tone}
      />
    </g>
  );
};

const markKey = (mark: Mark, index: number) => {
  if (mark.kind === "solid") {
    return `${index}:${mark.solid.outline.slice(0, 24)}`;
  }

  return `${index}:${mark.kind === "line" ? mark.d.slice(0, 24) : mark.points.length}`;
};

const keyed = (marks: readonly Mark[]) =>
  marks.map((mark, index) => ({ key: markKey(mark, index), mark }));

const Dots = ({ mark }: { readonly mark: Extract<Mark, { kind: "dots" }> }) => (
  <g className="mbx-dots" data-tone={mark.tone}>
    {mark.points.map(([x, y]) => (
      <circle
        cx={Math.round(x * 10) / 10}
        cy={Math.round(y * 10) / 10}
        key={`${Math.round(x * 10)},${Math.round(y * 10)}`}
        r={mark.size}
      />
    ))}
  </g>
);

/** A list of marks, painted in order. */
export const Marks = ({ marks }: { readonly marks: readonly Mark[] }) => (
  <>
    {keyed(marks).map(({ key, mark }) => {
      if (mark.kind === "solid") {
        return <SolidPaths key={key} mark={mark} />;
      }

      if (mark.kind === "line") {
        return <Line key={key} mark={mark} />;
      }

      return <Dots key={key} mark={mark} />;
    })}
  </>
);

const solidDs = (solid: Solid, mark: SolidMark) => {
  const crease = mark.crease ?? "faint";

  return [
    solid.fill,
    ...solid.shades,
    solid.top,
    crease === "none" ? "" : solid.crease,
    crease === "none" ? "" : solid.bevel,
    ...(mark.inner ?? []).map((inner) => inner.d),
    solid.outline,
  ];
};

/**
 * Repaints a group drawn from marks of the same kinds, in the same order,
 * with new paths: a turning crank, the press's arm, the governor's fan.
 */
export const repaint = (group: SVGGElement | null, marks: readonly Mark[]) => {
  if (group === null) {
    return;
  }

  const ds = marks.flatMap((mark) => {
    if (mark.kind === "solid") {
      return solidDs(mark.solid, mark);
    }

    return mark.kind === "line" ? [mark.d] : [];
  });

  const paths = group.querySelectorAll("path");

  for (const [index, d] of ds.entries()) {
    const path = paths.item(index);

    if (path.getAttribute("d") !== d) {
      path.setAttribute("d", d);
    }
  }
};
