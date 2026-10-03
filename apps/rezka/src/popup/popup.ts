import { initPopup, initWelcome } from '@video-transcripts/shared';
import { SUBTITLE_LANGUAGES } from '../config';

// HDrezka only ships subtitles in these languages — limit the picker to them.
// One bundle, two pages: the toolbar popup and the welcome page opened on
// install (welcome.html), told apart by their root element.
if (document.getElementById('welcome-root')) void initWelcome({ edition: 'rezka', languages: SUBTITLE_LANGUAGES });
else initPopup({ languages: SUBTITLE_LANGUAGES, edition: 'rezka' });
