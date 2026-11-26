// Copies the MediaPipe vision WASM runtime (Apache-2.0) from node_modules into
// public/ so the web build serves it locally: no third-party CDN, and camera
// frames never leave the device. The face model is committed (see
// THIRD_PARTY_NOTICES.md).
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pkg = dirname(require.resolve('@mediapipe/tasks-vision'));
const dest = join(here, '..', 'public', 'mediapipe', 'wasm');
mkdirSync(dest, { recursive: true });
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) {
  const src = join(pkg, 'wasm', f);
  if (!existsSync(src)) throw new Error(`missing ${src}`);
  cpSync(src, join(dest, f));
}
// The ES module itself is also served from public/: Metro cannot bundle its
// internal dynamic import(), so the scanner loads it at runtime instead.
cpSync(join(pkg, 'vision_bundle.mjs'), join(dest, '..', 'vision_bundle.mjs'));
console.log('mediapipe wasm copied to', dest);
