/*
 * tools/_env.mjs — resolve playwright-core from the visualizer server package.
 *
 * The site has no node_modules of its own; the only place playwright-core is
 * installed is poc/webview/server/node_modules. Resolve it from there so the
 * asset pipeline runs after a plain `clone` + `pnpm install`.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../..');
export const SERVER_DIR = path.join(ROOT, 'poc/webview/server');

const req = createRequire(path.join(SERVER_DIR, 'package.json'));

export function loadPlaywright() {
  try {
    return req('playwright-core');
  } catch (err) {
    console.error(
      'playwright-core not found in poc/webview/server/node_modules — run `pnpm install` there first.',
    );
    throw err;
  }
}

/* pngjs ships next to playwright-core (used by the style scanner). */
export function loadPng() {
  return req('pngjs').PNG;
}

