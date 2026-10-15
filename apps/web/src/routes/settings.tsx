import { createFileRoute } from "@tanstack/react-router";

import {
  SETTINGS_LEDE,
  SETTINGS_TITLE,
  SettingsView,
} from "../features/settings/settings-page.tsx";
import { pageHead } from "../features/shared/head.ts";
import { branchPage } from "../server/cache-headers.ts";

// Reads nothing on the server: the preference lives in the reader's browser, so the page is the same for everyone and the edge may keep it.
export const Route = createFileRoute("/settings")({
  staticData: { shell: "site" },
  component: SettingsView,
  headers: () => branchPage,
  head: () => pageHead({ description: SETTINGS_LEDE, title: SETTINGS_TITLE }),
});
