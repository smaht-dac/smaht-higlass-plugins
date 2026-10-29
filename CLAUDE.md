# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

HiGlass plugin tracks and data fetchers for the SMaHT data portal, published as one ES module package. The README documents the public API, track options, file serving requirements (CORS, `.vcf.gz` without `Content-Encoding: gzip`, CSP for bgzipped FASTA) and the steps for adding a track. Keep it up to date when changing any of these.

## Commands

Node >= 20.19 (`nvm use`, see `.nvmrc`).

```sh
npm start                    # Vite dev server with the demo page (index.html + demo/)
npm test                     # all Vitest projects: "unit" (jsdom) and "browser" (headless Chrome)
npm run lint                 # biome ci (lint + format check, as in CI)
npm run format               # biome format --write
npm run build                # dist/smaht-higlass-plugins.js

npx vitest run --project unit                    # unit tests only (no Chrome needed)
npx vitest run --project browser                 # browser tests only
npx vitest run test/unit/vcf.test.js             # one file
npx vitest run test/unit/vcf.test.js -t "<name>" # one test by name
```

The browser tests use the locally installed Google Chrome through Playwright (`channel: 'chrome'`, SwiftShader for WebGL); no Playwright browser download is needed. CI (`.github/workflows/ci.yml`) runs lint, test and build.

Biome style: 2-space indent, single quotes, semicolons, trailing commas, 80-column lines. `console.log` is a lint error; only `console.warn` / `console.error` are allowed.

## Architecture

### Plugin registration

- `src/tracks/index.js` and `src/data-fetchers/index.js` hold the lists of plugin factories. A new plugin must be added there.
- `src/plugins.js` uses `utils/byType.js` to turn those lists into the `{ [config.type]: { track | dataFetcher, config } }` maps that HiGlass expects as `options.pluginTracks` / `options.pluginDataFetchers`. It throws on a missing or duplicate `config.type`.
- `src/register.js` (`registerPlugins()`) also writes them to `window.higlassTracksByType` / `window.higlassDataFetchersByType`. This is needed because HiGlass <= 2.3.5 applies `defaultOptions` from the window registry before it reads `options.pluginTracks`. The demo and the browser tests call it before mounting HiGlass.
- `src/index.js` is the package entry and must stay free of side effects (`"sideEffects": false`, SSR-safe import). Nothing may touch `window` at module load.

### Build and dependencies

`vite.config.mjs` builds a library and keeps everything in `dependencies` and `peerDependencies` external, so the consuming app dedupes them. HiGlass, React and Pixi are never imported by the tracks. Custom tracks get them at runtime through the `HGC` argument (`HGC.tracks.*`, `HGC.libraries.PIXI`, `HGC.libraries.d3Scale`, `HGC.utils`, `HGC.services`). `higlass`, `react` and `pixi.js` are dev dependencies only for the demo and the tests. Runtime libraries that a track or data fetcher imports must go in `dependencies`.

A track factory must be a `function` (HiGlass calls it with `new`) that defines its class inside, extending an `HGC.tracks.*` base class, and carries a static `config` with a globally unique `type` (prefixed `smaht-`). See the README template.

### Somatic variants (`smaht-somatic-vcf` fetcher + `smaht-somatic-variants` track)

Data flow:

1. `SomaticVcfDataFetcher` downloads and parses the **whole** VCF in the browser (no tabix, no HiGlass server). It handles plain, gzip and BGZF input in `vcf.js` (BGZF is split into blocks because `DecompressionStream` only reads the first gzip member). Contigs are matched to `chromSizesUrl` with or without a `chr` prefix. Each ALT allele becomes a variant with absolute genome coordinates and a mutation class (`utils/mutationTypes.js`, pyrimidine-collapsed SBS classes + "Other"). The full INFO/sample parsing is deferred to `variant.details()`.
2. Downloads are cached in a module-level `Map` keyed by URL and shared by all fetcher instances. A failed load is evicted from the cache. Tests must call `clearCache()`.
3. The fetcher creates synthetic 1D tiles (`TILE_SIZE = 1024`, `max_zoom` computed from the genome length). Each tile holds the variants that overlap it; this uses `maxRefLength` so that long REF alleles from earlier tiles are included. Tiles at `max_zoom` also get the reference `sequence` from the optional indexed FASTA (`sequence.js`, `@gmod/indexedfasta`, range requests, padded with `N`).
4. `SomaticVariantTrack` (extends `HorizontalTiled1DPixiTrack`) draws all visible tiles together in `draw()`, because they share one count scale. It has two modes:
   - Bars: stacked counts per bin and mutation class.
   - Sequence: a reference row plus a sample row, used at `max_zoom` with at least `MIN_BASE_WIDTH` px per base.
5. `layout.js` contains pure functions (`binVariants`, `barRects`, `sequenceLayout`). They return the rectangles and letters that both the PIXI rendering and `exportSVG()` draw. Put geometry changes there so that both outputs stay consistent; they are unit tested in `test/unit/layout.test.js`.

Coordinate convention: a variant at VCF `POS` covers the absolute range `[chromOffset + POS - 1, chromOffset + POS)`.

### Tests and fixtures

- `test/unit/helpers.js` provides `fixtureFetch()`, a `fetch` stub that serves `test/fixtures/` and supports HTTP range requests. It also has `parseChromSizes()`, which mimics HiGlass' chromInfo service, and a minimal `bgzip()` writer.
- `test/browser/` mounts a real HiGlass `viewer` against the fixtures. The fixtures are served by the Vite dev server under `/test/fixtures`.
- The Vite config contains a dev server middleware that serves `.gz` files as `application/gzip` without `Content-Encoding`, as S3 does. Without it, browsers would only decode the first BGZF block.

### Demo

`demo/viewconf.js` uses hg38. Its chromosome sizes, genes and reference sequence are loaded from the internet. `demo/data/synthetic-somatic.vcf.gz` is generated by `node demo/data/make-synthetic-vcf.mjs`. Each new track should get an example in `demo/viewconf.js` and an entry in the README track table. The top-level `/data/` directory is git-ignored and meant for local files that must not be committed.
