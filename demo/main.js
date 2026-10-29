import { viewer } from 'higlass';

import { pluginDataFetchers, pluginTracks, registerPlugins } from '../src';
import { viewConfig } from './viewconf';

registerPlugins();

window.hgApi = await viewer(document.getElementById('demo'), viewConfig, {
  bounded: true,
  pluginTracks,
  pluginDataFetchers,
});
