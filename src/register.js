import { pluginDataFetchers, pluginTracks } from './plugins';

function addToRegistry(registryName, plugins, force) {
  const registry = window[registryName] || {};
  window[registryName] = registry;
  for (const [type, def] of Object.entries(plugins)) {
    if (registry[type] && registry[type] !== def && !force) {
      console.warn(
        `A HiGlass plugin with type "${type}" is already registered. Pass { force: true } to override it.`,
      );
    } else {
      registry[type] = def;
    }
  }
}

/**
 * Registers all plugins on the window-level HiGlass registries
 * (`window.higlassTracksByType` / `window.higlassDataFetchersByType`).
 *
 * Call this before mounting HiGlass. HiGlass (<= 2.3.5) applies track default
 * options from the viewconf before it reads `options.pluginTracks`, so plugins
 * passed only through options render without their `defaultOptions`.
 *
 * @param {{ force?: boolean }} [options]
 */
export function registerPlugins({ force = false } = {}) {
  if (typeof window === 'undefined') return;
  addToRegistry('higlassTracksByType', pluginTracks, force);
  addToRegistry('higlassDataFetchersByType', pluginDataFetchers, force);
}
