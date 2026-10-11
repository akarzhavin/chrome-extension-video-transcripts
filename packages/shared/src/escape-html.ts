const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Text made safe for markup, attribute values included. */
export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ENTITIES[c]);
