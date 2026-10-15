import { Brand } from "@repo/brand";
import type { RefNameText } from "@repo/protocol/domain/common";
import type { DecisionSubject } from "@repo/protocol/domain/decision";
import { Handle } from "@repo/protocol/ids";
import type { CommitSha } from "@repo/protocol/ids";
import { Data } from "effect";
import type { DateTime } from "effect";

import type { ProjectEventInput } from "../events.ts";

export type AttentionEffect = Data.TaggedEnum<{
  Emit: { readonly event: ProjectEventInput };
  Land: { readonly subject: DecisionSubject };
  Revert: { readonly ref: RefNameText; readonly to: CommitSha };
  SetAlarm: { readonly at: DateTime.Utc };
}>;

export const AttentionEffect = Data.taggedEnum<AttentionEffect>();

export const platformHandle: Handle = Handle.make(Brand.slug);
