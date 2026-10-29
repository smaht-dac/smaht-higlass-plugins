import { afterEach, describe, expect, it, vi } from 'vitest';

import { pluginDataFetchers, pluginTracks, registerPlugins } from '../../src';
import { dataFetchers } from '../../src/data-fetchers';
import { tracks } from '../../src/tracks';
import { byType } from '../../src/utils/byType';

describe('plugin tracks', () => {
  it('are factory functions with a config type', () => {
    for (const track of tracks) {
      expect(typeof track).toBe('function');
      expect(typeof track.config?.type).toBe('string');
    }
  });

  it('are keyed by their config type', () => {
    expect(Object.keys(pluginTracks)).toEqual(tracks.map((t) => t.config.type));
    for (const [type, def] of Object.entries(pluginTracks)) {
      expect(def.config.type).toBe(type);
    }
  });

  it('include the text and somatic variant tracks', () => {
    expect(pluginTracks.text.track).toBeDefined();
    expect(pluginTracks['smaht-somatic-variants'].track).toBeDefined();
  });
});

describe('plugin data fetchers', () => {
  it('are keyed by their config type', () => {
    expect(Object.keys(pluginDataFetchers)).toEqual(
      dataFetchers.map((f) => f.config.type),
    );
  });

  it('include the somatic VCF data fetcher', () => {
    expect(pluginDataFetchers['smaht-somatic-vcf'].dataFetcher).toBeDefined();
  });
});

describe('byType', () => {
  it('throws on duplicate types', () => {
    const a = () => {};
    a.config = { type: 'dup' };
    expect(() => byType([a, a], 'track')).toThrow(/Duplicate/);
  });

  it('throws on missing type', () => {
    const a = () => {};
    expect(() => byType([a], 'track')).toThrow(/config.type/);
  });
});

describe('registerPlugins', () => {
  afterEach(() => {
    delete window.higlassTracksByType;
    delete window.higlassDataFetchersByType;
    vi.restoreAllMocks();
  });

  it('adds the plugins to the window registries', () => {
    registerPlugins();
    expect(window.higlassTracksByType.text).toBe(pluginTracks.text);
    expect(window.higlassDataFetchersByType['smaht-somatic-vcf']).toBe(
      pluginDataFetchers['smaht-somatic-vcf'],
    );
  });

  it('does not override other plugins with the same type unless forced', () => {
    const other = { track: () => {}, config: { type: 'text' } };
    window.higlassTracksByType = { text: other };
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    registerPlugins();
    expect(window.higlassTracksByType.text).toBe(other);
    expect(console.warn).toHaveBeenCalled();

    registerPlugins({ force: true });
    expect(window.higlassTracksByType.text).toBe(pluginTracks.text);
  });
});
