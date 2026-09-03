/**
 * The one Deno global this project touches.
 *
 * `tsc` here runs with the DOM library, which is right for everything else in the tree —
 * the same `fetch`, `Response` and `TextDecoder` the browser has are what the deployment
 * runs on. `Deno.env` is the single thing outside it, and declaring the one method used
 * is smaller and clearer than pulling in a whole runtime's type package for it.
 */
declare const Deno: {
  env: { get(key: string): string | undefined };
};
