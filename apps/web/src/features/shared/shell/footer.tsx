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
 * The site's and the docs' foot: plain links, then the brand's domain as one
 * line of display type sized to the container (`cqi`), so it fills the
 * width at every size without wrapping. Upper case is the style's, so the
 * text stays the brand's own (the maintainer's overrides, 5).
 */
export const Footer = () => (
  <footer className="border-rule mt-16 border-t" data-footer="">
    <div
      className={`max-w-site @container mx-auto flex flex-col gap-8 pt-6 pb-4 ${GUTTER}`}
    >
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
        className="text-foreground text-[length:11.4cqi] leading-[0.9] font-semibold tracking-[-0.04em] whitespace-nowrap uppercase"
        data-domain=""
      >
        {Brand.domain}
      </p>
    </div>
  </footer>
);
