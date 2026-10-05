import { initSettings } from '../../../../packages/shared/src/settings/settings';
import { SUBTITLE_LANGUAGES } from '../config';

// HDrezka only ships subtitles in these languages: limit the pickers to them.
initSettings({ edition: 'rezka', languages: SUBTITLE_LANGUAGES });
