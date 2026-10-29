/**
 * Turns a list of HiGlass plugin factories into the `{ [type]: { <key>, config } }`
 * map expected by the `pluginTracks` / `pluginDataFetchers` HiGlass options.
 *
 * @param {Array<Function & { config: { type: string } }>} plugins
 * @param {'track' | 'dataFetcher'} key
 */
export function byType(plugins, key) {
  const result = {};
  for (const plugin of plugins) {
    const type = plugin?.config?.type;
    if (!type) {
      throw new Error(`HiGlass plugin ${plugin?.name} has no config.type`);
    }
    if (result[type]) {
      throw new Error(`Duplicate HiGlass plugin type: ${type}`);
    }
    result[type] = { [key]: plugin, config: plugin.config };
  }
  return result;
}
