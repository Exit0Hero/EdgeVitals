// Production bundle for the API: one ESM file per entry point in dist/.
// Workspace packages (@edgevitals/domain ships TypeScript source) and pure-JS
// dependencies are bundled; native addons stay external and are installed in
// the runtime image. The SQL migrations are read from ../migrations at runtime.
import { build } from 'esbuild';

await build({
  entryPoints: { server: 'src/server.ts', migrate: 'src/migrate-cli.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  legalComments: 'linked',
  external: ['@node-rs/argon2', 'pg-native'],
  // CommonJS dependencies inside an ESM bundle still call require().
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'info',
});
