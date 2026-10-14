import { Brand } from "@repo/brand";

import { AppLink } from "../link.tsx";
import {
  docsPath,
  INSTALL_PATH,
  PRIVACY_PATH,
  SETTINGS_PATH,
  TERMS_PATH,
} from "../paths.ts";
import { GUTTER } from "./gutter.ts";

const LINKS = [
  { label: "Docs", to: docsPath() },
  { label: "Install", to: INSTALL_PATH },
  { label: "Settings", to: SETTINGS_PATH },
  { label: "Privacy", to: PRIVACY_PATH },
  { label: "Terms", to: TERMS_PATH },
] as const;

const LINK =
  "text-muted-foreground hover:text-foreground no-underline transition-colors duration-[120ms]";

/**
 * The site's and the docs' foot, between the rails: a hairline across them,
 * plain links, then the brand's domain as a watermark: one line of display
 * type in the ink at a tenth of its strength, centred and sized to fill the
 * content's width exactly (`cqi`), standing on the page's bottom edge. Upper
 * case is the style's, so the text stays the brand's own (the maintainer's
 * overrides, 5).
 *
 * The size is the content width over the line's width per em: the
 * upper-cased domain sets 8.243 em wide in Plex Sans at 600 with -0.04em
 * tracking (measured in headless Chromium on 2026-10-14; measure again if
 * the domain changes). The line box is 0.9 em and ends 0.075 em under the
 * baseline, which is all the room the caps keep from the edge.
 */
export const Footer = () => (
  <footer
    className="border-rule mt-auto overflow-hidden border-t"
    data-footer=""
  >
    <div className={`@container flex w-full flex-col gap-10 pt-6 ${GUTTER}`}>
      <ul className="text-ui flex flex-wrap gap-x-5 gap-y-2">
        {LINKS.map(({ label, to }) => (
          <li key={to}>
            <AppLink className={LINK} to={to}>
              {label}
            </AppLink>
          </li>
        ))}
      </ul>
      <p
        className="text-foreground/10 text-center text-[length:12.131cqi] leading-[0.9] font-semibold tracking-[-0.04em] whitespace-nowrap uppercase select-none"
        data-domain=""
      >
        {Brand.domain}
      </p>
    </div>
  </footer>
);
