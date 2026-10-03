import { initPopup, initWelcome } from '@video-transcripts/shared';

// One bundle, two pages: the toolbar popup and the welcome page opened on
// install (welcome.html), told apart by their root element.
if (document.getElementById('welcome-root')) void initWelcome({ edition: 'youtube' });
else initPopup({ edition: 'youtube' });
