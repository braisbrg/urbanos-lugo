/**
 * Redraw the README diagrams from their JSON sources.
 *
 *   pnpm diagrams
 *
 * The three diagrams in the README are pictures of a repository that keeps moving, so the
 * thing that has to stay true is the *source*: `docs/diagrams/*.json` is what gets edited
 * and committed, and the `.html` viewer and the two PNGs beside it are output. Archify
 * renders deterministically -- same JSON in, same bytes out -- which is why the HTML is
 * not tracked and this script exists instead.
 *
 * `deliver` is the part that must pass: it validates the source, renders it and refuses to
 * write anything that fails a layout or composition check. `visual-check` is the part that
 * needs a browser, and it is what produces the light and dark PNGs the README embeds. If
 * no Chrome or Chromium turns up, the HTML is still rewritten and the script says plainly
 * that the images are now older than the sources -- rather than leaving that to be found
 * in a diff months later.
 *
 * Point ARCHIFY_CHROME at a binary to override the search.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ARCHIFY = '.claude/skills/archify/bin/archify.mjs';
const DIR = 'docs/diagrams';

const DIAGRAMS = [
  { type: 'architecture', name: 'arquitectura', source: 'arquitectura.architecture.json' },
  { type: 'dataflow', name: 'datos', source: 'datos.dataflow.json' },
  { type: 'workflow', name: 'etiquetas', source: 'etiquetas.workflow.json' },
];

/** The capture size the README embeds; archify names its screenshots after it. */
const CAPTURE = '1440x900';

/** Chrome is only needed for the screenshots, and it lives somewhere different everywhere. */
function findChrome(): string | null {
  if (process.env.ARCHIFY_CHROME) return process.env.ARCHIFY_CHROME;
  const home = process.env.LOCALAPPDATA || process.env.HOME || '';
  const playwright = join(home, process.platform === 'win32' ? 'ms-playwright' : '.cache/ms-playwright');
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  if (existsSync(playwright)) {
    for (const dir of readdirSync(playwright).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
      candidates.unshift(
        join(playwright, dir, 'chrome-win64/chrome.exe'),
        join(playwright, dir, 'chrome-linux/chrome'),
        join(playwright, dir, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'),
      );
    }
  }
  return candidates.find(existsSync) ?? null;
}

// The renderer is an assistant skill under .claude/, which this repository does not track
// -- that directory holds session transcripts and machine paths. So a clone has the JSON
// sources and the images but not the thing that turns one into the other, and without this
// the failure is an ENOENT from execFileSync with a path and no explanation.
if (!existsSync(ARCHIFY)) {
  console.error(
    `Missing ${ARCHIFY}.\n\n` +
      'The diagrams are rendered by the archify skill, which lives under .claude/ and is\n' +
      'not tracked here. The committed .json sources and the .png images the README embeds\n' +
      'are all a reader needs; this command is only for redrawing them.',
  );
  process.exit(1);
}

const archify = (args: string[], env?: NodeJS.ProcessEnv) =>
  execFileSync(process.execPath, [ARCHIFY, ...args], { stdio: 'inherit', env: { ...process.env, ...env } });

const chrome = findChrome();

for (const { type, name, source } of DIAGRAMS) {
  console.log(`\n=== ${name} (${type}) ===`);
  archify(['deliver', type, join(DIR, source), join(DIR, `${name}.html`), '--quality', 'showcase']);
  if (!chrome) continue;
  archify(['visual-check', join(DIR, `${name}.html`)], { ARCHIFY_CHROME: chrome });
  for (const theme of ['light', 'dark']) {
    copyFileSync(join(DIR, `${name}.visual-check.${CAPTURE}.${theme}.png`), join(DIR, `${name}-${theme}.png`));
  }
}

console.log(
  chrome
    ? `\nDiagrams and README images rebuilt with ${chrome}.`
    : '\nNo Chrome or Chromium found: the HTML was rebuilt but docs/diagrams/*-light.png and\n' +
      '*-dark.png are now older than their sources. Set ARCHIFY_CHROME and run again.',
);
