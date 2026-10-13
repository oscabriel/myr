import { Workspace } from "../shared/shell/workspace.tsx";
import { Appearance } from "./appearance.tsx";

export const SETTINGS_TITLE = "Settings";

export const SETTINGS_LEDE =
  "Choose how the web looks in this browser. Nothing here is sent to the server.";

export const SettingsView = () => (
  <Workspace crumbs={[{ label: SETTINGS_TITLE }]} title={SETTINGS_TITLE}>
    <section aria-labelledby="appearance" className="flex flex-col gap-3">
      <h2 className="text-title font-semibold" id="appearance">
        Appearance
      </h2>
      <p className="text-ui text-muted-foreground">
        Light and dark follow your system, or its opposite. The choice is kept
        in this browser only.
      </p>
      <Appearance />
    </section>
  </Workspace>
);
