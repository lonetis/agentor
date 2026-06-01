export const WINDOW_NAME_RE = /^[a-zA-Z0-9_-]+$/;
/** Maximum length of a worker's user-facing display name. The internal worker
 * identity is a UUID, so the display name is a free-form label with only a
 * sanity bound on length. */
export const MAX_DISPLAY_NAME_LENGTH = 100;
