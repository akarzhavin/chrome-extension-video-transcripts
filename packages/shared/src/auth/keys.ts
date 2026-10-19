// Key inventories with no store behind them, so a module needing only its keys loads nothing else.
// ./storage re-exports them and stays the one inventory the privacy policy's "Local Storage" documents.

// The installation (english repo spec 034), read/written only by ../installation/.
// Its own random UUID, never stored or sent with the analytics keys; it survives sign-out.
export const INSTALLATION_KEYS = {
    id: 'installation.id',
    // Install (true) or update (false) as known at mint; dropped once the server recorded it.
    fresh: 'installation.fresh',
    recorded: 'installation.recorded',
} as const;
