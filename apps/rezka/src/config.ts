// Under-the-hood feature flags for the rezka extension. These are intentionally
// NOT user-facing — flip a value here and rebuild to change behavior.
export const FEATURES = {
    // Auto-discover and load EVERY subtitle track for a title up front, by
    // reading the player's CDN data response (`get_cdn_series` / `get_cdn_movie`)
    // and any inline player config, so the user never has to open the CC menu and
    // select each language by hand.
    //
    // Set to false to fall back to MANUAL behavior: the extension only picks up a
    // subtitle track when the player actually requests it — i.e. when the user
    // selects that language in the CC menu. The baseline interceptor (direct
    // `.vtt` requests) and <track>-element detection stay on either way.
    autoSubtitleSearch: true,
};

// Languages offered in the picker (popup + in-sidebar onboarding). HDrezka only
// ships subtitle tracks in these, so showing the full list would just let users
// pick a language no title carries. Codes must exist in SUPPORTED_LANGUAGES;
// order here is the order shown.
export const SUBTITLE_LANGUAGES = ['en', 'ru', 'uk'];
