import { describe, expect, it } from "@effect/vitest";
import { VisibilityPolicy } from "@repo/protocol/domain/visibility";
import type { Posture } from "@repo/protocol/posture";
import { Option, Schema } from "effect";

import { narrows, postureOf } from "../src/posture.ts";

const deciders = { readers: "deciders", writers: "deciders" } as const;

const maintainers = {
  ...deciders,
  audience: "maintainers",
  disclose: "sealed",
  holds: ["checks", "agent-config", "notes", "experiment"],
  name: "maintainers",
  reason: "Held-back checks keep answers honest.",
  repo: "datekit--maintainers",
};

const personal = {
  ...deciders,
  audience: "personal",
  disclose: "hidden",
  holds: ["personal"],
  name: "me",
  reason: "My own agent settings.",
};

const security = {
  ...deciders,
  audience: "security",
  disclose: "counted",
  holds: ["fix"],
  maxDays: 14,
  name: "security",
  reason: "Fixes wait for their advisory.",
};

const enterprise = {
  ...deciders,
  audience: "sponsors",
  disclose: "declared",
  holds: ["source"],
  name: "enterprise",
  reason: "Paid features.",
};

const sealedChecks = {
  // Declared out of order (an object literal's keys would be sorted by
  // lint), so the label's order is the posture's own sort.
  areas: Object.fromEntries([
    ["parser", "src/parse/**"],
    ["export", "src/export/**"],
  ]),
  attempts: { perClaim: 3, perPersonPerAreaPerWeek: 10 },
  canary: true,
  commit: "salted-sha256-merkle",
  layer: "maintainers",
  pin: "claim",
  result: "area-bit",
};

const config = {
  env: { setters: "deciders" },
  flows: { noWriteDown: true, release: "deciders" },
  notice: { narrowingDays: 7 },
};

const decode = Schema.decodeUnknownSync(VisibilityPolicy);

const policy = (layers: readonly unknown[]) => decode({ ...config, layers });

/** A policy whose maintainers layer holds the held-back checks. */
const sealed = (layers: readonly unknown[]) =>
  decode({ ...config, checks: sealedChecks, layers });

const mit = Option.some("MIT");

const of = (visibility: VisibilityPolicy, licence = mit) =>
  postureOf({ licence, visibility: Option.some(visibility) });

const postureUnder = (licence: string) =>
  of(policy([]), Option.some(licence)).posture;

// OSR §2.6's table, one row at a time.
describe("a project's posture", () => {
  it("is Open with no visibility config", () => {
    expect(
      postureOf({ licence: mit, visibility: Option.none() })
    ).toStrictEqual({ label: "Open", posture: "open" });
  });

  it("is Open with no layers but personal ones", () => {
    expect(of(policy([]))).toStrictEqual({ label: "Open", posture: "open" });
    expect(of(policy([personal]))).toStrictEqual({
      label: "Open",
      posture: "open",
    });
  });

  // A public layer hides nothing from anyone, so it narrows nothing.
  it("is Open with a layer everyone may read", () => {
    expect(
      of(policy([{ ...enterprise, audience: "public", disclose: "public" }]))
    ).toStrictEqual({ label: "Open", posture: "open" });
  });

  it("is Open with sealed evidence when layers hold only evidence, naming the sealed areas in order", () => {
    expect(of(sealed([maintainers, personal]))).toStrictEqual({
      label: "Open with sealed evidence · sealed checks in export, parser",
      posture: "openWithSealedEvidence",
    });
  });

  it("names no areas when no held-back checks are declared", () => {
    expect(
      of(policy([{ ...maintainers, holds: ["notes", "experiment"] }]))
    ).toStrictEqual({
      label: "Open with sealed evidence",
      posture: "openWithSealedEvidence",
    });
  });

  it("is Open on schedule with an embargoed fix, naming its longest wait", () => {
    expect(of(sealed([maintainers, security]))).toStrictEqual({
      label: "Open on schedule · embargo ≤ 14 days",
      posture: "openOnSchedule",
    });
    expect(
      of(sealed([security, { ...security, maxDays: 30, name: "disclosures" }]))
    ).toStrictEqual({
      label: "Open on schedule · embargo ≤ 30 days",
      posture: "openOnSchedule",
    });
    expect(of(policy([{ ...security, maxDays: 1 }]))).toStrictEqual({
      label: "Open on schedule · embargo ≤ 1 day",
      posture: "openOnSchedule",
    });
  });

  it("is Open core when a layer holds source, naming the closed layers", () => {
    expect(of(sealed([maintainers, security, enterprise]))).toStrictEqual({
      label: "Open core · closed: enterprise",
      posture: "openCore",
    });
  });

  // OSR §5.6: sponsorware is source that opens after a declared delay.
  it("is Open on schedule when the source layer opens within a declared delay", () => {
    expect(of(policy([{ ...enterprise, maxDays: 90 }]))).toStrictEqual({
      label: "Open on schedule · embargo ≤ 90 days",
      posture: "openOnSchedule",
    });
  });

  // An embargo with no limit never promises to open: it is closed.
  it("is Open core when an embargoed fix has no limit", () => {
    const { maxDays: _, ...unbounded } = security;

    expect(of(policy([unbounded, enterprise]))).toStrictEqual({
      label: "Open core · closed: enterprise, security",
      posture: "openCore",
    });
  });

  it("is Source available under a licence that is not OSI-approved, whatever the layers", () => {
    const sourceAvailable = {
      label: "Source available",
      posture: "sourceAvailable",
    };

    for (const licence of [
      "BUSL-1.1",
      "SSPL-1.0",
      "LicenseRef-Proprietary",
      "UNLICENSED",
    ]) {
      expect(of(policy([]), Option.some(licence))).toStrictEqual(
        sourceAvailable
      );
      expect(
        of(sealed([maintainers, enterprise]), Option.some(licence))
      ).toStrictEqual(sourceAvailable);
    }
  });

  it("reads every licence on the OSI list as open, however it is spelled", () => {
    for (const licence of [
      "MIT",
      "mit",
      "Apache-2.0",
      "BSD-2-Clause",
      "BSD-3-Clause",
      "ISC",
      "MPL-2.0",
      "GPL-2.0",
      "GPL-2.0-only",
      "GPL-3.0-or-later",
      "LGPL-2.1+",
      "LGPL-3.0",
      "AGPL-3.0-only",
      " MIT ",
    ]) {
      expect(of(policy([]), Option.some(licence)).posture).toBe("open");
    }
  });

  it("reads an SPDX expression as open when any choice is, or every part of a conjunction", () => {
    expect(postureUnder("MIT OR Apache-2.0")).toBe("open");
    expect(postureUnder("BUSL-1.1 OR MIT")).toBe("open");
    expect(postureUnder("(MIT AND Apache-2.0)")).toBe("open");
    expect(postureUnder("GPL-2.0-only WITH Classpath-exception-2.0")).toBe(
      "open"
    );
    expect(postureUnder("Apache-2.0 WITH LLVM-exception")).toBe("open");
  });

  // SPDX lists exceptions that only add permissions. `Commons-Clause` is not
  // one of them: it forbids selling the code, so the code is source available.
  it("reads an exception it does not know as closing the licence", () => {
    expect(postureUnder("Apache-2.0 WITH Commons-Clause")).toBe(
      "sourceAvailable"
    );
    expect(postureUnder("MIT WITH AdditionRef-no-resale")).toBe(
      "sourceAvailable"
    );
    expect(postureUnder("Apache-2.0 WITH Commons-Clause OR MIT")).toBe("open");
  });

  it("reads an SPDX expression as closed when one part of a conjunction is, or it does not parse", () => {
    expect(postureUnder("MIT AND BUSL-1.1")).toBe("sourceAvailable");
    expect(postureUnder("(BUSL-1.1 OR SSPL-1.0) AND MIT")).toBe(
      "sourceAvailable"
    );
    expect(postureUnder("")).toBe("sourceAvailable");
    expect(postureUnder("MIT OR")).toBe("sourceAvailable");
    expect(postureUnder("(MIT")).toBe("sourceAvailable");
  });

  // ASSUMPTION: no licence found is not a judgement on one; the layers decide.
  it("goes by the layers alone when no licence was found", () => {
    expect(of(sealed([maintainers]), Option.none())).toStrictEqual({
      label: "Open with sealed evidence · sealed checks in export, parser",
      posture: "openWithSealedEvidence",
    });
  });
});

// OSR §2.6's ratchet: narrowing is a `PostureChange` decision, widening is not.
describe("narrowing a posture", () => {
  const furtherFromOpen: readonly Posture[] = [
    "open",
    "openWithSealedEvidence",
    "openOnSchedule",
    "openCore",
    "sourceAvailable",
  ];

  it("is moving further from Open", () => {
    expect(narrows("open", "openWithSealedEvidence")).toBeTruthy();
    expect(narrows("openWithSealedEvidence", "openCore")).toBeTruthy();
    expect(narrows("openOnSchedule", "sourceAvailable")).toBeTruthy();
  });

  it("is never widening or staying put", () => {
    expect(narrows("openCore", "openOnSchedule")).toBeFalsy();
    expect(narrows("sourceAvailable", "open")).toBeFalsy();
    expect(
      narrows("openWithSealedEvidence", "openWithSealedEvidence")
    ).toBeFalsy();
  });

  it("holds over every pair, in the table's order", () => {
    for (const [i, from] of furtherFromOpen.entries()) {
      for (const [j, to] of furtherFromOpen.entries()) {
        expect(narrows(from, to)).toBe(j > i);
      }
    }
  });
});
