/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Where `/api/…` lives, when it does not live beside the page.
   *
   * Empty by default, which means same origin: `pnpm dev` and `pnpm start` serve the
   * endpoints themselves, and the published static build has none at all and falls back
   * to the committed snapshot. Set it to a Worker's address (no trailing slash) and the
   * static build gets live notices and the operator's own minutes back.
   *
   * Set at build time, never read at runtime: a static host has nothing to configure
   * afterwards, so the address has to be in the bundle. It is also added to `connect-src`
   * in the policy, so a build that names one origin cannot quietly talk to another.
   */
  readonly VITE_API_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
