import {
  createFileRoute,
  getRouteApi,
  useRouter,
} from "@tanstack/react-router";

import { commands } from "../features/agents/catalog.ts";
import {
  INSTALL_LEDE,
  INSTALL_TITLE,
  InstallView,
} from "../features/agents/install-page.tsx";
import { pageHead } from "../features/shared/head.ts";
import { branchPage } from "../server/cache-headers.ts";

const root = getRouteApi("__root__");

const InstallPage = () => {
  const { platformUrl } = root.useLoaderData();
  const { origin } = useRouter();

  return (
    <InstallView
      commands={commands}
      platformUrl={platformUrl}
      webUrl={origin}
    />
  );
};

export const Route = createFileRoute("/install")({
  staticData: { shell: "site" },
  component: InstallPage,
  headers: () => branchPage,
  head: () => pageHead({ description: INSTALL_LEDE, title: INSTALL_TITLE }),
});
