# smaht-higlass-plugins

HiGlass plugin tracks for the SMaHT data portal, bundled as a single package.

| Track type               | Data fetcher        | Source                                                        |
| ------------------------ | ------------------- | ------------------------------------------------------------- |
| `text`                   |                     | [higlass-text](https://github.com/higlass/higlass-text) (npm) |
| `smaht-somatic-variants` | `smaht-somatic-vcf` | [src/tracks/somatic-variants](src/tracks/somatic-variants)    |

## Usage

```js
import { HiGlassComponent } from 'higlass';
import {
  pluginDataFetchers,
  pluginTracks,
  registerPlugins,
} from 'smaht-higlass-plugins';

registerPlugins();

<HiGlassComponent
  viewConfig={viewConfig}
  options={{ bounded: true, pluginTracks, pluginDataFetchers }}
/>;
```

Importing the package has no side effects. `registerPlugins()` adds the plugins to
`window.higlassTracksByType` / `window.higlassDataFetchersByType`. Call it before
HiGlass mounts. HiGlass (<= 2.3.5) applies track default options from the viewconf
before it reads `options.pluginTracks`, so without registration plugin tracks lose
their `defaultOptions`.

The package can be imported outside of a browser (e.g. during server-side rendering),
but the tracks only work in the browser, next to `higlass`.

## Somatic variants track

Shows the somatic variants of a small VCF file (up to a few MB), which is loaded
completely in the browser. No HiGlass server or tabix index is needed.

- **Zoomed out**: stacked bars. The height of a bar is the number of variants in its
  genomic bin, the blocks show the number of variants per mutation type.
- **Zoomed in** (at least 1 pixel per base): two sequence rows. The top row shows the
  reference sequence. The bottom row shows the same bases greyed out, except at variant
  positions: SNVs show the ALT base in color, other variants (indels, MNVs) color their
  REF bases with the "Other" color.

Hovering shows the number of variants per mutation type of a bar, or the variant
details (REF/ALT, ID, FILTER, QUAL, INFO) of a base.

```js
{
  uid: 'somatic',
  type: 'smaht-somatic-variants',
  height: 100,
  data: {
    type: 'smaht-somatic-vcf',
    vcfUrl: 'https://example.com/sample.vcf.gz',
    chromSizesUrl: 'https://example.com/hg38.chrom.sizes',
    fastaUrl: 'https://example.com/hg38.fa', // optional
    faiUrl: 'https://example.com/hg38.fa.fai', // optional, default: `${fastaUrl}.fai`
  },
  options: { name: 'Sample 1' },
}
```

| Data field      | Description                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `vcfUrl`        | VCF file, plain, gzipped or bgzipped                                                                                                             |
| `chromSizesUrl` | Chromosome sizes of the view's assembly, in the same order as the view's `chromInfoPath`. Contigs are matched with and without a `chr` prefix. |
| `fastaUrl`      | Indexed reference FASTA. Without it, zoomed in views only show the variant positions, with the REF bases from the VCF.                          |
| `faiUrl`        | FASTA index                                                                                                                                      |
| `gziUrl`        | Only for bgzipped FASTA files                                                                                                                    |

The files are requested with `fetch` (the FASTA with range requests), so they need
CORS headers when they are on another domain. Serve `.vcf.gz` files as they are,
without `Content-Encoding: gzip`: browsers only decode the first block of bgzipped
files sent that way. S3 does this by default, and the demo's dev server is configured
for it. A bgzipped FASTA is decompressed with WebAssembly that is loaded from a
`data:` URL, so a Content Security Policy needs `data:` in `connect-src` for it.

| Option                   | Default  | Description                                                                  |
| ------------------------ | -------- | ---------------------------------------------------------------------------- |
| `onlyPass`               | `false`  | Only show variants with `FILTER` `PASS` (or `.`)                             |
| `barWidth`               | `8`      | Approximate bar width in pixels (bars are 1-2x as wide, depending on zoom) |
| `showLegend`             | `true`   | Legend of the mutation types above the bars                                  |
| `axisPositionHorizontal` | `'left'` | Position of the count axis, or `'hidden'`                                    |

The usual label, background and border options work as well.

Mutation types are the six single base substitution classes, with the reference base
collapsed onto the pyrimidine strand (e.g. `G>A` counts as `C>T`), plus "Other". They
use the colors of the COSMIC signature plots and are exported as `MUTATION_CLASSES`:

| Type  | Color     |
| ----- | --------- |
| C>A   | `#1ebff0` |
| C>G   | `#050708` |
| C>T   | `#e62725` |
| T>A   | `#cbcacb` |
| T>C   | `#a1cf64` |
| T>G   | `#edc8c5` |
| Other | `#7f3c8d` |

Genome positions follow the other HiGlass tracks: a variant at `POS` covers the
absolute range `[chromOffset + POS - 1, chromOffset + POS)`.

## Development

Requires Node >= 20.19 (`nvm use`).

```sh
npm install
npm start       # demo page (index.html, demo/) with all plugin tracks
npm test        # vitest: unit tests in Node.js and browser tests in Chrome
npm run lint    # biome
npm run build   # dist/smaht-higlass-plugins.js (ES module)
```

The browser tests use the installed Google Chrome and the small synthetic files in
`test/fixtures/`. The demo (hg38) shows `demo/data/synthetic-somatic.vcf.gz`, random
variants with the INFO and FORMAT fields of the SMaHT somatic VCFs (zoom into
chr17:7,674,200-7,674,280 to see a few of them next to each other). It is created by
`node demo/data/make-synthetic-vcf.mjs`. The chromosome sizes, genes and reference
sequence are loaded from the internet. `data/` is ignored by git, for local files that
must not be checked in.

The build is an ES module. Everything in `dependencies` and `peerDependencies` stays
an external import, so the consuming app resolves and dedupes it. React, Pixi and
HiGlass are never bundled; plugins get HiGlass through the `HGC` argument.

## Adding a track

Each track gets a folder in `src/tracks/<name>/` and an entry in
`src/tracks/index.js`. Data fetchers work the same way in `src/data-fetchers/`.

### An existing npm plugin

1. `npm install <plugin-package>` (keeps it in `dependencies`).
2. `src/tracks/<name>/index.js`:
   ```js
   export { SomeTrack as default } from '<plugin-package>';
   ```
3. Add it to the `tracks` array in `src/tracks/index.js`.

### A custom track

`src/tracks/<name>/<Name>Track.js` follows the HiGlass plugin factory pattern:

```js
// Must be a `function`, not an arrow function: HiGlass calls it with `new`.
export default function NameTrack(HGC, ...args) {
  if (!new.target) {
    throw new Error(
      'Uncaught TypeError: Class constructor cannot be invoked without "new"',
    );
  }

  class NameTrackClass extends HGC.tracks.BarTrack {
    // ...
  }

  return new NameTrackClass(...args);
}

NameTrack.config = {
  type: 'smaht-name', // must be unique across all plugins
  datatype: ['vector'],
  orientation: '1d-horizontal',
  availableOptions: [],
  defaultOptions: {},
};
```

Then add `src/tracks/<name>/index.js` (`export { default } from './NameTrack';`), add it
to `src/tracks/index.js`, add an example to `demo/viewconf.js`, and list it in the table
above. Runtime libraries a custom track imports go in `dependencies`.
