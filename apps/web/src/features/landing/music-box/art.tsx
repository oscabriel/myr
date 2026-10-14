/**
 * The music box in painter's order, drawn at one pose. The parts the motion
 * moves are groups named by `data-part`; everything else never changes.
 */
import { memo } from "react";

import { Marks } from "./draw.tsx";
import {
  drumPins,
  liveFrame,
  rulesPins,
  tapeEntries,
  toothState,
} from "./frame.ts";
import { HEIGHT, STATIONS, TEETH, WIDTH, toothX } from "./layout.ts";
import { solid } from "./marks.ts";
import type { Pose } from "./model.ts";
import {
  armBack,
  armFront,
  armStrip,
  askFlag,
  bell,
  bench,
  carriage,
  caseBack,
  claimClip,
  combBlock,
  combRoot,
  crank,
  drum,
  feeler,
  flag,
  follower,
  glassWall,
  governorFan,
  hinges,
  lever,
  lid,
  lipAndRuler,
  movementBack,
  movementEnd,
  movementFront,
  pawl,
  pillars,
  printer,
  railBack,
  ratchetTeeth,
  rulesLink,
  rulesTrack,
  slip,
  stationFronts,
  strip,
  tape,
  template,
  testTeeth,
  tooth,
  trayBacks,
  trayFronts,
} from "./parts.ts";

const STATIC = {
  bench: bench(),
  caseBack: caseBack(),
  combBlock: combBlock(),
  combRoot: combRoot(),
  drum: drum(),
  follower: follower(),
  glassWall: glassWall(),
  hinges: hinges(),
  lid: lid(),
  lipAndRuler: lipAndRuler(),
  movementBack: movementBack(),
  movementEnd: movementEnd(),
  movementFront: movementFront(),
  pawl: pawl(),
  pillars: pillars(),
  printer: printer(),
  railBack: railBack(),
  rulesLink: rulesLink(),
  rulesTrack: rulesTrack(),
  stations: stationFronts(),
  tape: tape(),
  teeth: Array.from({ length: TEETH }, (_, index) => [
    solid(tooth(index), "hi", { crease: "lo" }),
  ]),
  trayBacks: trayBacks(),
  trayFronts: trayFronts(),
} as const;

const MOVING = {
  bell: bell(),
  carriage: carriage(),
  claim: claimClip(),
  feeler: feeler(),
  flags: STATIONS.map((x) => [solid(flag(x), "mid")]),
  lever: lever(),
  slip: slip(STATIONS[1]),
  strayStrip: strip(true),
  strip: strip(false),
  template: template(),
  testTeeth: testTeeth(),
} as const;

const PIN_ALPHAS = [0, 1, 2, 3] as const;

const Pins = ({
  name,
  ds,
}: {
  readonly name: string;
  readonly ds: readonly string[];
}) => (
  <g className="mbx-pins" data-part={name}>
    {PIN_ALPHAS.map((alpha) => (
      <path d={ds[alpha] ?? ""} data-alpha={alpha} key={alpha} />
    ))}
  </g>
);

/** The first answer: on the carriage, then in its tray. */
const Stray = ({ frame }: { readonly frame: ReturnType<typeof liveFrame> }) => (
  <g data-part="stray" opacity={frame.strayOpacity} transform={frame.stray}>
    <Marks marks={MOVING.strayStrip} />
  </g>
);

/** Everything, painted back to front, with the moving parts at `pose`. */
const Drawing = ({ pose }: { readonly pose: Pose }) => {
  const frame = liveFrame(pose);
  const pins = drumPins(pose);
  const rules = rulesPins(pose.drum);

  return (
    <svg
      aria-hidden="true"
      className="mbx-svg"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
    >
      <Marks marks={STATIC.bench} />
      <Marks marks={STATIC.lid} />
      <Marks marks={STATIC.hinges} />
      <Marks marks={STATIC.caseBack} />
      <Marks marks={STATIC.movementBack} />
      <g data-part="fan">
        <Marks marks={governorFan(frame.fan)} />
      </g>
      <Marks marks={STATIC.drum} />
      <Pins ds={pins.tune} name="pins" />
      <path className="mbx-pin" d={pins.ask} data-part="sour" />
      <path
        className="mbx-pin"
        d={pins.fixed}
        data-part="fixed"
        data-state="landed"
      />
      <Marks marks={STATIC.movementFront} />
      <Marks marks={STATIC.rulesTrack} />
      <Pins ds={rules} name="rules" />
      <Marks marks={STATIC.movementEnd} />
      <path
        className="mbx-line"
        d={ratchetTeeth(frame.ratchet)}
        data-part="ratchet"
        data-tone="lo"
      />
      <Marks marks={STATIC.pawl} />
      <Marks marks={STATIC.combBlock} />
      {STATIC.teeth.map((marks, index) => (
        <g
          data-part="tooth"
          data-state={toothState(pose, index)}
          key={toothX(index)}
          transform={frame.teeth[index]}
        >
          <Marks marks={marks} />
        </g>
      ))}
      <Marks marks={STATIC.combRoot} />
      <Marks marks={STATIC.follower} />
      <Marks marks={STATIC.lipAndRuler} />
      <g
        data-part="claim"
        opacity={frame.claimOpacity.toFixed(3)}
        transform={frame.claim}
      >
        <Marks marks={MOVING.claim} />
      </g>
      <g data-part="flag" transform={frame.flag}>
        <Marks marks={askFlag(0)} />
      </g>
      <Marks marks={STATIC.pillars} />
      <Marks marks={STATIC.railBack} />
      <g data-part="carriage" transform={frame.carriage}>
        <Marks marks={MOVING.carriage} />
        <g data-part="strip" opacity={pose.round === 2 ? 1 : 0}>
          <Marks marks={MOVING.strip} />
        </g>
      </g>
      <g data-part="carriage-slot">
        {pose.drop > 0 ? null : <Stray frame={frame} />}
      </g>
      {STATIC.stations.map((marks, index) => (
        <g data-station={index} key={STATIONS[index]}>
          <Marks marks={marks} />
          <g data-flag={index} data-state={pose.flags[index]}>
            <Marks marks={MOVING.flags[index] ?? []} />
          </g>
        </g>
      ))}
      <g data-part="template" transform={frame.template}>
        <Marks marks={MOVING.template} />
      </g>
      <g data-part="feeler" transform={frame.feeler}>
        <Marks marks={MOVING.feeler} />
      </g>
      <g data-part="test-comb" transform={frame.testComb}>
        <Marks marks={MOVING.testTeeth} />
      </g>
      <g
        data-part="bell"
        data-state={pose.bell > 0.05 ? "sealed" : undefined}
        transform={frame.bell}
      >
        <Marks marks={MOVING.bell} />
      </g>
      <Marks marks={MOVING.lever} />
      <Marks marks={STATIC.trayBacks} />
      <g data-part="tray-layer">
        {pose.drop > 0 ? <Stray frame={frame} /> : null}
      </g>
      <g data-part="slip" opacity={pose.slip.toFixed(3)} transform={frame.slip}>
        <Marks marks={MOVING.slip} />
      </g>
      <Marks marks={STATIC.trayFronts} />
      <g data-part="arm-back">
        <Marks marks={armBack(pose.arm)} />
      </g>
      <g data-part="arm-strip" opacity={pose.holding ? 1 : 0}>
        <Marks marks={armStrip(pose.arm)} />
      </g>
      <g data-part="arm-front">
        <Marks marks={armFront(pose.arm)} />
      </g>
      <Marks marks={STATIC.rulesLink} />
      <Marks marks={STATIC.glassWall} />
      <g data-part="crank">
        <Marks marks={crank(pose.drum)} />
      </g>
      <Marks marks={STATIC.printer} />
      <Marks marks={STATIC.tape} />
      <path
        className="mbx-line"
        d={tapeEntries(pose)}
        data-free=""
        data-part="entries"
        data-tone="lo"
      />
    </svg>
  );
};

export const Art = memo(Drawing);
