import { installAuthBackground, installOnboarding } from '@video-transcripts/shared';

chrome.runtime.onInstalled.addListener(() => {
    console.log('[YT-VTT bg] installed');
});

installAuthBackground();
installOnboarding('youtube');
