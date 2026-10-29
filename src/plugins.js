import { dataFetchers } from './data-fetchers';
import { tracks } from './tracks';
import { byType } from './utils/byType';

/** Pass as `options.pluginTracks` to HiGlassComponent / hglib.viewer. */
export const pluginTracks = byType(tracks, 'track');

/** Pass as `options.pluginDataFetchers` to HiGlassComponent / hglib.viewer. */
export const pluginDataFetchers = byType(dataFetchers, 'dataFetcher');
