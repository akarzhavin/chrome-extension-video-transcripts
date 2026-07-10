import { initPopup } from '@video-transcripts/shared';
import { SUBTITLE_LANGUAGES } from '../config';

// HDrezka only ships subtitles in these languages — limit the picker to them.
initPopup({ languages: SUBTITLE_LANGUAGES });
