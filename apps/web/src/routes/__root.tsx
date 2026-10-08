import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

// A minimal document; issue 511 replaces it with the shell and the design.

const Document = ({ children }: Readonly<{ children: ReactNode }>) => (
  <html lang="en">
    <head>
      <HeadContent />
    </head>
    <body>
      {children}
      <Scripts />
    </body>
  </html>
);

const Root = () => (
  <Document>
    <Outlet />
  </Document>
);

export const Route = createRootRoute({
  component: Root,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { content: "width=device-width, initial-scale=1", name: "viewport" },
    ],
  }),
});
