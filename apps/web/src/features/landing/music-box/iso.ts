/**
 * The isometric camera, solids and lines the music box is drawn with.
 *
 * Ported from the anatomy skill's kit (`kit/iso-kit.ts` and `kit/lathe.mjs`),
 * and changed freely since:
 *
 * MIT License
 *
 * Copyright (c) 2026 Ryan
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/** A point on the screen, in the drawing's viewBox. */
export type Flat = readonly [number, number];

/** A point in the world: x and y on the floor, z up, in units of about a pixel. */
export type Point = readonly [number, number, number];

/** A rounded rectangle on the floor. */
export interface Plan {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly d: number;
  readonly r: number;
}

/** Where the camera stands, fitted to the drawing's box. */
export interface Camera {
  readonly ox: number;
  readonly oy: number;
  readonly k: number;
  readonly sinA: number;
  readonly cosA: number;
  readonly sinE: number;
  readonly cosE: number;
}

/** A frame for parts along any axis: its origin, its axis and two radial directions. */
export interface Frame {
  readonly o: Point;
  readonly a: Point;
  readonly u: Point;
  readonly v: Point;
}

/**
 * A solid's paths, painted in this order: the paper fill that hides what is
 * behind, four side tones by how each face meets the light, the top, the
 * crease where top meets side, an optional bevel, and the silhouette.
 */
export interface Solid {
  readonly fill: string;
  readonly shades: readonly [string, string, string, string];
  readonly top: string;
  readonly crease: string;
  readonly bevel: string;
  readonly outline: string;
}

export const EMPTY_SOLID: Solid = {
  bevel: "",
  crease: "",
  fill: "",
  outline: "",
  shades: ["", "", "", ""],
  top: "",
};

const ORIGIN: Flat = [0, 0];

const RADIANS = Math.PI / 180;

const TAU = Math.PI * 2;

const UNIT = Math.sqrt(1.6);

const LIGHT_UP = 1.2;

/** The light's score at which each of the five tones begins: four sides, then the top. */
const BANDS = [0, 0.2, 0.42, 0.62] as const;

const VISIBLE = 1e-6;

export const add = (a: Point, b: Point): Point => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
];

export const sub = (a: Point, b: Point): Point => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];

export const times = (a: Point, by: number): Point => [
  a[0] * by,
  a[1] * by,
  a[2] * by,
];

export const dot = (a: Point, b: Point) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const cross = (a: Point, b: Point): Point => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export const unit = (a: Point): Point => {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;

  return [a[0] / length, a[1] / length, a[2] / length];
};

const trig = (azimuth: number, elevation: number) => ({
  cosA: Math.cos(azimuth * RADIANS),
  cosE: Math.cos(elevation * RADIANS),
  sinA: Math.sin(azimuth * RADIANS),
  sinE: Math.sin(elevation * RADIANS),
});

/** World to screen. */
export const at = ([x, y, z]: Point, camera: Camera): Flat => [
  camera.ox + (x * camera.sinA - y * camera.cosA) * camera.k,
  camera.oy +
    ((x * camera.cosA + y * camera.sinA) * camera.sinE - z * camera.cosE) *
      camera.k,
];

/** The unit direction toward the viewer: a larger dot with it is nearer. */
export const view = (camera: Camera): Point => [
  camera.cosA * camera.cosE,
  camera.sinA * camera.cosE,
  camera.sinE,
];

/** The kit's light: from the viewer's upper left. */
export const light = (camera: Camera): Point =>
  unit([-camera.sinA, camera.cosA, LIGHT_UP]);

/** Larger is nearer the viewer; paint in ascending order. */
export const depth = (point: Point, camera: Camera) => dot(point, view(camera));

/**
 * A camera that centres these points in a box of `width` by `height`, `pad`
 * clear of every edge.
 */
export const fitCamera = (
  points: readonly Point[],
  box: {
    readonly width: number;
    readonly height: number;
    readonly pad: number;
    readonly azimuth: number;
    readonly elevation: number;
  }
): Camera => {
  const angles = trig(box.azimuth, box.elevation);
  const probe: Camera = { ...angles, k: 1, ox: 0, oy: 0 };
  const flat = points.map((point) => at(point, probe));
  const xs = flat.map(([x]) => x);
  const ys = flat.map(([, y]) => y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const up = Math.min(...ys);
  const down = Math.max(...ys);

  const scale = Math.min(
    (box.width - box.pad * 2) / (right - left),
    (box.height - box.pad * 2) / (down - up)
  );

  return {
    ...angles,
    k: scale,
    ox: box.width / 2 - ((left + right) / 2) * scale,
    oy: box.height / 2 - ((up + down) / 2) * scale,
  };
};

/** The screen scale of one world unit, for line widths and dot sizes. */
export const unitScale = (camera: Camera) => camera.k / UNIT;

const tenth = (value: number) => {
  const text = (Math.round(value * 10) / 10).toFixed(1).replace(/\.0$/u, "");

  return text === "-0" ? "0" : text;
};

export const pathOf = (points: readonly Flat[], closed = false) =>
  points.length === 0
    ? ""
    : `${points
        .map(
          ([x, y], index) => `${index === 0 ? "M" : "L"}${tenth(x)} ${tenth(y)}`
        )
        .join("")}${closed ? "Z" : ""}`;

const signedArea = (points: readonly Flat[]) => {
  let area = 0;

  for (const [index, [ax, ay]] of points.entries()) {
    const [bx, by] = points[(index + 1) % points.length] ?? [ax, ay];

    area += ax * by - bx * ay;
  }

  return area / 2;
};

const counterClockwise = (points: readonly Flat[]) =>
  signedArea(points) < 0 ? points.toReversed() : points;

const turn = (o: Flat, a: Flat, b: Flat) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Andrew's monotone chain. */
const hullOf = (points: readonly Flat[]): readonly Flat[] => {
  const sorted = points.toSorted((a, b) => a[0] - b[0] || a[1] - b[1]);

  if (sorted.length < 3) {
    return sorted;
  }

  const chain = (list: readonly Flat[]) => {
    const kept: Flat[] = [];

    for (const point of list) {
      while (
        kept.length >= 2 &&
        turn(kept.at(-2) ?? point, kept.at(-1) ?? point, point) <= 0
      ) {
        kept.pop();
      }

      kept.push(point);
    }

    return kept;
  };

  return [
    ...chain(sorted).slice(0, -1),
    ...chain(sorted.toReversed()).slice(0, -1),
  ];
};

/** Runs of consecutive indices (closing round the ring) whose flag is `want`. */
const runsOf = (flags: readonly boolean[], want: boolean) => {
  const count = flags.length;

  const start = flags.findIndex(
    (flag, index) => flag !== flags[(index + count - 1) % count]
  );

  if (start === -1) {
    return flags[0] === want
      ? [Array.from({ length: count + 1 }, (_, index) => index % count)]
      : [];
  }

  const runs: number[][] = [];
  let run: number[] | undefined;

  for (const step of Array.from({ length: count }, (_, index) => index)) {
    const index = (start + step) % count;

    if (flags[index] === want) {
      run ??= [index];
      run.push((index + 1) % count);
    } else if (run !== undefined) {
      runs.push(run);
      run = undefined;
    }
  }

  if (run !== undefined) {
    runs.push(run);
  }

  return runs;
};

const toneOf = (normal: Point, camera: Camera) => {
  const score = dot(unit(normal), light(camera));

  return BANDS.filter((band) => score >= band).length;
};

const bucketed = (
  faces: readonly { readonly tone: number; readonly d: string }[]
) => {
  const tones = [0, 1, 2, 3, 4].map((tone) =>
    faces.flatMap((face) => (face.tone === tone ? [face.d] : [])).join("")
  );

  return {
    shades: [
      tones[0] ?? "",
      tones[1] ?? "",
      tones[2] ?? "",
      tones[3] ?? "",
    ] as const,
    top: tones[4] ?? "",
  };
};

/** A rounded rectangle as a ring of floor points, counter-clockwise. */
export const roundedRing = (plan: Plan, steps = 8): readonly Flat[] => {
  const radius = Math.max(0, Math.min(plan.r, plan.w / 2, plan.d / 2));
  const count = radius > 0 ? steps : 0;

  const corners = [
    [plan.x + plan.w - radius, plan.y + radius, -90],
    [plan.x + plan.w - radius, plan.y + plan.d - radius, 0],
    [plan.x + radius, plan.y + plan.d - radius, 90],
    [plan.x + radius, plan.y + radius, 180],
  ] as const;

  return corners.flatMap(([cx, cy, start]) =>
    Array.from({ length: count + 1 }, (_, step) => {
      const angle =
        (start + (count === 0 ? 45 : (90 * step) / count)) * RADIANS;

      return [
        cx + radius * Math.cos(angle),
        cy + radius * Math.sin(angle),
      ] as const;
    })
  );
};

/** A circle as a ring of floor points. */
export const circle = (
  radius: number,
  steps: number,
  centre: Flat = [0, 0]
): readonly Flat[] =>
  Array.from({ length: steps }, (_, step) => {
    const angle = (step / steps) * TAU;

    return [
      centre[0] + radius * Math.cos(angle),
      centre[1] + radius * Math.sin(angle),
    ] as const;
  });

export const insetPlan = (plan: Plan, by: number): Plan => ({
  d: plan.d - by * 2,
  r: Math.max(0, plan.r - by),
  w: plan.w - by * 2,
  x: plan.x + by,
  y: plan.y + by,
});

/** Four floor points inset from a plan's corners, for feet and screws. */
export const cornersOf = (plan: Plan, inset: number): readonly Flat[] => [
  [plan.x + inset, plan.y + inset],
  [plan.x + plan.w - inset, plan.y + inset],
  [plan.x + inset, plan.y + plan.d - inset],
  [plan.x + plan.w - inset, plan.y + plan.d - inset],
];

/** A plan's eight corners between two heights, for fitting the camera. */
export const boxCorners = (plan: Plan, z0: number, z1: number) =>
  [plan.x, plan.x + plan.w].flatMap((x) =>
    [plan.y, plan.y + plan.d].flatMap((y) =>
      [z0, z1].map((z): Point => [x, y, z])
    )
  );

/**
 * A floor outline stood straight up from `z` by `height`. The outline is
 * split into the runs that face the viewer and those that don't, so the
 * silhouette, the crease and the bevel each end where the faces turn away.
 */
export const extrude = (
  ring: readonly Flat[],
  z: number,
  height: number,
  camera: Camera,
  bevelBy = 0
): Solid => {
  const count = ring.length;
  const counter = signedArea(ring) > 0;
  const toward = view(camera);

  const normals = ring.map(([ax, ay], index): Flat => {
    const [bx, by] = ring[(index + 1) % count] ?? [ax, ay];
    const length = Math.hypot(bx - ax, by - ay) || 1;

    return counter
      ? [(by - ay) / length, -(bx - ax) / length]
      : [-(by - ay) / length, (bx - ax) / length];
  });

  const facing = normals.map(
    ([nx, ny]) => nx * toward[0] + ny * toward[1] > 1e-9
  );

  const top = ring.map(([x, y]) => at([x, y, z + height], camera));
  const bottom = ring.map(([x, y]) => at([x, y, z], camera));

  const pick = (list: readonly Flat[], run: readonly number[]) =>
    run.map((index) => list[index] ?? ORIGIN);

  const outline = [
    ...runsOf(facing, false).map((run) => pathOf(pick(top, run))),
    ...(height > 0
      ? runsOf(facing, true).map((run) => pathOf(pick(bottom, run)))
      : []),
    ...(height > 0
      ? ring.flatMap((_, index) =>
          facing[(index + count - 1) % count] === facing[index]
            ? []
            : [pathOf([top[index] ?? ORIGIN, bottom[index] ?? ORIGIN])]
        )
      : []),
  ].join("");

  const crease = runsOf(facing, true)
    .map((run) => pathOf(pick(top, run)))
    .join("");

  const faces =
    height > 0
      ? ring.flatMap((_, index) => {
          if (facing[index] !== true) {
            return [];
          }

          const next = (index + 1) % count;
          const [nx, ny] = normals[index] ?? ORIGIN;

          return [
            {
              d: pathOf(
                counterClockwise([
                  top[index] ?? ORIGIN,
                  top[next] ?? ORIGIN,
                  bottom[next] ?? ORIGIN,
                  bottom[index] ?? ORIGIN,
                ]),
                true
              ),
              tone: Math.min(3, toneOf([nx, ny, 0], camera)),
            },
          ];
        })
      : [];

  const { shades } = bucketed(faces);

  const bevel =
    bevelBy > 0
      ? runsOf(facing, true)
          .map((run) => {
            const inset = run.slice(1, -1).map((index) => {
              const [ax, ay] = normals[(index + count - 1) % count] ?? ORIGIN;
              const [bx, by] = normals[index] ?? ORIGIN;
              const length = Math.hypot(ax + bx, ay + by) || 1;
              const [x, y] = ring[index] ?? ORIGIN;

              return at(
                [
                  x - ((ax + bx) / length) * bevelBy,
                  y - ((ay + by) / length) * bevelBy,
                  z + height,
                ],
                camera
              );
            });

            return pathOf([
              top[run[0] ?? 0] ?? ORIGIN,
              ...inset,
              top[run.at(-1) ?? 0] ?? ORIGIN,
            ]);
          })
          .join("")
      : "";

  return {
    bevel,
    crease,
    fill: pathOf(hullOf([...top, ...bottom]), true),
    outline,
    shades,
    top: pathOf(counterClockwise(top), true),
  };
};

/** A rounded box. */
export const slab = (
  plan: Plan,
  z: number,
  height: number,
  camera: Camera,
  options: { readonly steps?: number; readonly bevel?: number } = {}
) =>
  extrude(
    roundedRing(plan, options.steps ?? 4),
    z,
    height,
    camera,
    options.bevel ?? 0
  );

/** A round post, puck, foot or knob standing on the floor. */
export const post = (
  centre: Flat,
  radius: number,
  z: number,
  height: number,
  camera: Camera,
  steps = 28
) => extrude(circle(radius, steps, centre), z, height, camera);

/** A frame on axis `a` through `o`, with radial directions chosen for it. */
export const frameAlong = (o: Point, a: Point): Frame => {
  const axis = unit(a);
  const helper: Point = Math.abs(axis[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  const u = unit(cross(helper, axis));

  return { a: axis, o, u, v: cross(axis, u) };
};

/** A point `s` along a frame's axis, at `x` and `y` in its radial plane. */
export const inFrame = (frame: Frame, s: number, [x, y]: Flat): Point =>
  add(
    add(frame.o, times(frame.a, s)),
    add(times(frame.u, x), times(frame.v, y))
  );

/**
 * Any convex polygon in a frame's radial plane, extruded along its axis from
 * `s0` to `s1`: rods, discs, bars and plates at any angle.
 */
export const prism = (
  frame: Frame,
  polygon: readonly Flat[],
  s0: number,
  s1: number,
  camera: Camera
): Solid => {
  const toward = view(camera);
  const ring = counterClockwise(polygon);
  const count = ring.length;
  const low = ring.map((point) => at(inFrame(frame, s0, point), camera));
  const high = ring.map((point) => at(inFrame(frame, s1, point), camera));

  const sides = ring.map((point, index) => {
    const next = ring[(index + 1) % count] ?? point;

    const normal = unit(
      add(
        times(frame.u, next[1] - point[1]),
        times(frame.v, -(next[0] - point[0]))
      )
    );

    return { normal, seen: dot(normal, toward) > VISIBLE };
  });

  const ends = [
    { normal: times(frame.a, -1), points: low },
    { normal: frame.a, points: high },
  ].map((end) => ({ ...end, seen: dot(end.normal, toward) > VISIBLE }));

  const faces = [
    ...sides.flatMap(({ normal, seen }, index) => {
      const next = (index + 1) % count;

      return seen
        ? [
            {
              d: pathOf(
                [
                  low[index] ?? ORIGIN,
                  low[next] ?? ORIGIN,
                  high[next] ?? ORIGIN,
                  high[index] ?? ORIGIN,
                ],
                true
              ),
              tone: toneOf(normal, camera),
            },
          ]
        : [];
    }),
    ...ends.flatMap((end) =>
      end.seen
        ? [{ d: pathOf(end.points, true), tone: toneOf(end.normal, camera) }]
        : []
    ),
  ];

  const sharp = ring.map((point, index) => {
    const before = ring[(index + count - 1) % count] ?? point;
    const after = ring[(index + 1) % count] ?? point;
    const ax = point[0] - before[0];
    const ay = point[1] - before[1];
    const bx = after[0] - point[0];
    const by = after[1] - point[1];

    return (
      (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1) <
      Math.cos(0.35)
    );
  });

  const crease = [
    ...ring.flatMap((_, index) =>
      sharp[index] === true &&
      sides[index]?.seen === true &&
      sides[(index + count - 1) % count]?.seen === true
        ? [pathOf([low[index] ?? ORIGIN, high[index] ?? ORIGIN])]
        : []
    ),
    ...ends.flatMap((end) =>
      end.seen
        ? ring.flatMap((_, index) =>
            sides[index]?.seen === true
              ? [
                  pathOf([
                    end.points[index] ?? ORIGIN,
                    end.points[(index + 1) % count] ?? ORIGIN,
                  ]),
                ]
              : []
          )
        : []
    ),
  ].join("");

  const hull = pathOf(hullOf([...low, ...high]), true);

  return { ...bucketed(faces), bevel: "", crease, fill: hull, outline: hull };
};

/** A round rod or disc along a frame's axis. */
export const rod = (
  frame: Frame,
  s0: number,
  s1: number,
  radius: number,
  camera: Camera,
  steps = 32
) => prism(frame, circle(radius, steps), s0, s1, camera);

/**
 * A convex body of revolution from a profile of `[s, r]` points along a
 * frame's axis: a bell, a cone, the halves of a sand-glass. Its rings at
 * interior points draw as creases on the side that faces the viewer.
 */
export const turned = (
  frame: Frame,
  profile: readonly Flat[],
  camera: Camera,
  steps = 32
): Solid => {
  const toward = view(camera);

  const angles = Array.from(
    { length: steps },
    (_, index) => (index / steps) * TAU
  );

  const rings = profile.map(([s, r]) =>
    angles.map((angle) =>
      at(inFrame(frame, s, [r * Math.cos(angle), r * Math.sin(angle)]), camera)
    )
  );

  const bands = profile.slice(0, -1).flatMap(([s0, r0], row) => {
    const [s1, r1] = profile[row + 1] ?? [s0, r0];
    const low = rings[row] ?? [];
    const high = rings[row + 1] ?? [];

    return angles.map((angle, index) => {
      const middle = angle + Math.PI / steps;

      const radial = add(
        times(frame.u, Math.cos(middle)),
        times(frame.v, Math.sin(middle))
      );

      const normal = unit(
        add(times(radial, s1 - s0), times(frame.a, -(r1 - r0)))
      );

      const next = (index + 1) % steps;

      return {
        d: pathOf(
          [
            low[index] ?? ORIGIN,
            low[next] ?? ORIGIN,
            high[next] ?? ORIGIN,
            high[index] ?? ORIGIN,
          ],
          true
        ),
        index,
        normal,
        row,
        seen: dot(normal, toward) > VISIBLE && Math.abs(r0) + Math.abs(r1) > 0,
      };
    });
  });

  const caps = [
    {
      normal: times(frame.a, -1),
      points: rings[0] ?? [],
      radius: profile[0]?.[1] ?? 0,
    },
    {
      normal: frame.a,
      points: rings.at(-1) ?? [],
      radius: profile.at(-1)?.[1] ?? 0,
    },
  ].filter((cap) => cap.radius > 0 && dot(cap.normal, toward) > VISIBLE);

  const faces = [
    ...bands.flatMap((band) =>
      band.seen ? [{ d: band.d, tone: toneOf(band.normal, camera) }] : []
    ),
    ...caps.map((cap) => ({
      d: pathOf(cap.points, true),
      tone: toneOf(cap.normal, camera),
    })),
  ];

  const crease = profile
    .slice(1, -1)
    .map((_, offset) => {
      const row = offset + 1;
      const points = rings[row] ?? [];

      const seen = angles.map((_angle, index) =>
        bands.some(
          (band) =>
            band.seen &&
            band.index === index &&
            (band.row === row || band.row === row - 1)
        )
      );

      return runsOf(seen, true)
        .map((run) => pathOf(run.map((index) => points[index] ?? ORIGIN)))
        .join("");
    })
    .join("");

  const hull = pathOf(hullOf(rings.flat()), true);

  return { ...bucketed(faces), bevel: "", crease, fill: hull, outline: hull };
};

/** A polyline on a horizontal face at height `z`. */
export const onTop = (
  points: readonly Flat[],
  z: number,
  camera: Camera,
  closed = false
) =>
  pathOf(
    points.map(([x, y]) => at([x, y, z], camera)),
    closed
  );

export const segment = (from: Point, to: Point, camera: Camera) =>
  pathOf([at(from, camera), at(to, camera)]);

export const polyline = (
  points: readonly Point[],
  camera: Camera,
  closed = false
) =>
  pathOf(
    points.map((point) => at(point, camera)),
    closed
  );

export const planOutline = (plan: Plan, z: number, camera: Camera, steps = 4) =>
  onTop(roundedRing(plan, steps), z, camera, true);

export const ringOnTop = (
  centre: Flat,
  radius: number,
  z: number,
  camera: Camera,
  steps = 24
) => onTop(circle(radius, steps, centre), z, camera, true);

/** The near half of a horizontal circle on a post's side: a seam or a band. */
export const sideArc = (
  centre: Flat,
  radius: number,
  z: number,
  camera: Camera,
  steps = 20
) => {
  const facing = Math.atan2(camera.sinA, camera.cosA);

  return pathOf(
    Array.from({ length: steps + 1 }, (_, step) => {
      const angle = facing - Math.PI / 2 + (step / steps) * Math.PI;

      return at(
        [
          centre[0] + radius * Math.cos(angle),
          centre[1] + radius * Math.sin(angle),
          z,
        ],
        camera
      );
    })
  );
};

/**
 * A seam round a box at height `z`: the near half of its plan, wrapping the
 * corners and ending on the slab's own silhouette edges.
 */
export const sideSeam = (plan: Plan, z: number, camera: Camera, steps = 4) => {
  const ring = roundedRing(plan, steps);
  const count = ring.length;
  const toward = view(camera);
  const counter = signedArea(ring) > 0;

  const facing = ring.map(([ax, ay], index) => {
    const [bx, by] = ring[(index + 1) % count] ?? [ax, ay];
    const [nx, ny] = counter ? [by - ay, -(bx - ax)] : [-(by - ay), bx - ax];

    return nx * toward[0] + ny * toward[1] > 1e-9;
  });

  return runsOf(facing, true)
    .map((run) =>
      pathOf(
        run.map((index) => {
          const [x, y] = ring[index] ?? ORIGIN;

          return at([x, y, z], camera);
        })
      )
    )
    .join("");
};

/** Vertical lines on the near half of a post: a knurl. */
export const knurl = (
  centre: Flat,
  radius: number,
  span: Flat,
  count: number,
  camera: Camera
) =>
  Array.from({ length: count }, (_, index) => (index / count) * TAU)
    .filter(
      (angle) =>
        Math.cos(angle) * camera.cosA + Math.sin(angle) * camera.sinA > 0.15
    )
    .map((angle) => {
      const x = centre[0] + radius * Math.cos(angle);
      const y = centre[1] + radius * Math.sin(angle);

      return segment([x, y, span[0] + 0.3], [x, y, span[1] - 0.3], camera);
    })
    .join("");

/** The visible arc of a ring round a frame's axis, ending at the limbs. */
export const arcOn = (
  frame: Frame,
  s: number,
  radius: number,
  camera: Camera,
  steps = 40
) => {
  const toward = view(camera);

  const seen = Array.from({ length: steps }, (_, index) => {
    const angle = ((index + 0.5) / steps) * TAU;

    return (
      dot(
        add(times(frame.u, Math.cos(angle)), times(frame.v, Math.sin(angle))),
        toward
      ) > 0.02
    );
  });

  const point = (index: number) => {
    const angle = (index / steps) * TAU;

    return at(
      inFrame(frame, s, [radius * Math.cos(angle), radius * Math.sin(angle)]),
      camera
    );
  };

  return runsOf(seen, true)
    .map((run) => pathOf(run.map(point)))
    .join("");
};

/** Axial lines on the side of a round part that faces the viewer: gear teeth, a knurl. */
export const ribsOn = (
  frame: Frame,
  span: Flat,
  radius: number,
  count: number,
  camera: Camera
) => {
  const toward = view(camera);

  return Array.from({ length: count }, (_, index) => (index / count) * TAU)
    .flatMap((angle) => {
      const radial = add(
        times(frame.u, Math.cos(angle)),
        times(frame.v, Math.sin(angle))
      );

      if (dot(radial, toward) < 0.18) {
        return [];
      }

      const point: Flat = [radius * Math.cos(angle), radius * Math.sin(angle)];

      return [
        pathOf([
          at(inFrame(frame, span[0], point), camera),
          at(inFrame(frame, span[1], point), camera),
        ]),
      ];
    })
    .join("");
};

/** A whole ring in a frame's radial plane: a face ring, a bore, a bezel. */
export const ringOn = (
  frame: Frame,
  s: number,
  radius: number,
  camera: Camera,
  steps = 32
) =>
  pathOf(
    circle(radius, steps).map((point) => at(inFrame(frame, s, point), camera)),
    true
  );

export interface Ticks {
  readonly minor: string;
  readonly major: string;
}

/** Ruler ticks along x on a top face, each grown from the line `edge` toward +y. */
export const ticksAlongX = (
  stations: readonly number[],
  every: number,
  edge: number,
  z: number,
  lengths: Flat,
  camera: Camera
): Ticks => {
  const marks = stations.map((x, index) => {
    const major = index % every === 0;

    return {
      d: onTop(
        [
          [x, edge],
          [x, edge + (major ? lengths[1] : lengths[0])],
        ],
        z,
        camera
      ),
      major,
    };
  });

  return {
    major: marks.flatMap((mark) => (mark.major ? [mark.d] : [])).join(""),
    minor: marks.flatMap((mark) => (mark.major ? [] : [mark.d])).join(""),
  };
};

/**
 * A coil spring round a vertical axis, split into the half behind the rod
 * and the half in front, so it paints back, rod, front.
 */
export const coil = (
  centre: Flat,
  radius: number,
  span: Flat,
  turns: number,
  camera: Camera
) => {
  const count = Math.max(1, Math.round(turns * 16));
  const toward = view(camera);

  const samples = Array.from({ length: count + 1 }, (_, index) => {
    const share = index / count;
    const angle = share * turns * TAU;
    const nx = Math.cos(angle);
    const ny = Math.sin(angle);

    return {
      flat: at(
        [
          centre[0] + radius * nx,
          centre[1] + radius * ny,
          span[0] + (span[1] - span[0]) * share,
        ],
        camera
      ),
      near: nx * toward[0] + ny * toward[1] > 0,
    };
  });

  const pieces = samples.slice(1).map((sample, index) => ({
    d: pathOf([samples[index]?.flat ?? sample.flat, sample.flat]),
    near: sample.near && samples[index]?.near === true,
  }));

  return {
    back: pieces.flatMap((piece) => (piece.near ? [] : [piece.d])).join(""),
    front: pieces.flatMap((piece) => (piece.near ? [piece.d] : [])).join(""),
  };
};

const fine = (value: number) => Math.round(value * 100) / 100;

/** A screen offset that moves a group built at rest by a world offset. */
export const translateBy = (camera: Camera, by: Point) => {
  const [x0, y0] = at([0, 0, 0], camera);
  const [x1, y1] = at(by, camera);

  return `translate(${fine(x1 - x0)} ${fine(y1 - y0)})`;
};
