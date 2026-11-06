// The sealed columns (PLAN.md §4.1 and §5): everything personal is AES-256-GCM ciphertext under the account's
// data key before it reaches the engine, and the server never queries or reads these columns. Only the device
// holds plaintext (its replica), behind the app lock. New personal columns go on this list (CLAUDE.md).
//
// Why dates, times, counts, booleans and ratings stay plain: the server has to order and page rows (by night
// date, by position in the night), sum counts and keep sync working, and those values say nothing on their
// own - "lucid, level 3, woke at 06:40" is not a dream. Everything that could carry words or identify a
// person, place or thing is sealed: text, titles, notes, names, aliases, spans, answers, OCR output and the
// media files themselves. Element names are sealed too, so even the person's taxonomy (which people and places
// appear in their dreams) is unreadable on the server; the kind and colour of an element stay plain.
// A night's merged_into is sync bookkeeping (which night it was merged into, LDJ-52) and stays plain: the server
// checks and decides merges. Its absorbed (on a survivor, keyed fingerprints of the texts it took in from merged
// nights; on a merged night, that it handed its plain values over) is sealed: only a device ever reads it.
// merge_pending (a merge to try again here) is plain bookkeeping that never leaves the side that set it.
export const SEALED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  nights: ["substances", "notes", "intention", "absorbed"],
  dreams: ["title", "text", "lucid_trigger", "dismissed"],
  elements: ["name", "aliases", "note"],
  dream_elements: ["span"],
  // ocr_text as text; the file (data) is sealed as bytes (sealBytes) before upload: a text envelope, so the column is text
  media: ["ocr_text", "data"],
  reality_checks: ["note"],
  practice_log: ["note"],
  course_progress: ["answers"],
  // one JSON document (user_settings.data): flags, units and times stay plain so the device can apply them
  // without a key; every free-text value inside it is sealed by key (SEALED_SETTING_KEYS)
  user_settings: [],
};

/** Keys of free-text values in the settings document that are sealed one by one. None yet: add here before
 *  adding a free-text setting (a custom reminder text, a journal prompt, ...). */
export const SEALED_SETTING_KEYS: readonly string[] = [];

export const SEALED_TABLES: readonly string[] = Object.keys(SEALED_COLUMNS).filter((t) => SEALED_COLUMNS[t]!.length > 0);

export const isSealedColumn = (table: string, column: string): boolean => SEALED_COLUMNS[table]?.includes(column) ?? false;
export const isSealedSettingKey = (key: string): boolean => SEALED_SETTING_KEYS.includes(key);
