import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { playwright } from '@vitest/browser-playwright';

const root = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));

// Runtime dependencies and peers stay as imports in the build output so that
// the consuming app (e.g. smaht-portal) resolves and dedupes them itself.
const externals = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
];

const CHROME_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

/**
 * Vite's dev server sends `.gz` files with `Content-Encoding: gzip`. Browsers
 * then only decode the first gzip member of a bgzipped file (e.g. just the VCF
 * header), so serve them as plain binary files, as S3 does.
 */
const serveGzipAsBinary = {
  name: 'serve-gzip-as-binary',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      const file = path.join(root, urlPath);
      if (
        !urlPath.endsWith('.gz') ||
        !file.startsWith(root + path.sep) ||
        !fs.existsSync(file)
      ) {
        next();
        return;
      }
      res.setHeader('Content-Type', 'application/gzip');
      fs.createReadStream(file).pipe(res);
    });
  },
};

/** @type {import("vite").UserConfig} */
export default {
  plugins: [serveGzipAsBinary],
  define: {
    // Required by some HiGlass dependencies when running the demo and tests.
    global: 'globalThis',
  },
  build: {
    target: 'es2020',
    sourcemap: true,
    lib: {
      entry: 'src/index.js',
      formats: ['es'],
      fileName: () => 'smaht-higlass-plugins.js',
    },
    rollupOptions: {
      external: (id) =>
        externals.some((dep) => id === dep || id.startsWith(`${dep}/`)),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'jsdom',
          include: ['test/unit/**/*.test.js'],
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include: ['test/browser/**/*.test.js'],
          browser: {
            enabled: true,
            // Uses the installed Google Chrome, so no browser download is needed.
            provider: playwright({
              launchOptions: { channel: 'chrome', args: CHROME_ARGS },
            }),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
};
