# Backups, export and import

Everything here runs on the device (PLAN.md §12). Nothing is sent anywhere to be counted, converted or opened.

## Backups (`.somniumbackup`)

A backup is JSON:

```json
{
  "format": "somnium-backup",
  "version": 1,
  "createdAt": "2026-11-07T08:00:00.000Z",
  "account": { "kdfSalt": "…", "wrappedByPassword": "v1.…", "recoverySalt": "…", "wrappedByRecovery": "v1.…" },
  "data": { "app": "somnium", "format": 1, "sealed": true, "exportedAt": "…", "settings": {}, "tables": { "nights": [], "dreams": [] } }
}
```

- `data` is the journal sealed exactly as the server stores it: every sealed column (`packages/engine/src/sealed.ts`)
  is an AES-256-GCM envelope bound to its table, column and row id, under the account's data key.
- `account` is the data key wrapped by the password (and by the recovery key, when one was made), the same values the
  server keeps. The file opens with the password the account had when the backup was made, or with the recovery key.
  Nothing else is needed and nothing else opens it.
- Readable without a key: the plain columns (dates, times, ratings, yes-or-no marks), the settings and the user name,
  which is what the server itself can read. The Backup screen says so.
- Optional extra passphrase: the whole file is wrapped once more, hiding the dates too:
  `{ "format": "somnium-backup-locked", "version": 1, "createdAt", "kdf": { "name": "argon2id", "salt", "memoryKiB", "iterations" }, "sealed": "v1.<iv>.<ciphertext>" }`.
  The key is Argon2id(passphrase, salt) with the app's parameters; the cipher is AES-256-GCM.
  Automatic backups can't ask for it, so only backups made by hand use it.

Making a backup needs the journal unlocked: the device's copy holds plaintext, so each row is sealed with the key on
the device. Automatic backups (on by default, daily, keeping the last 7) run while Somnium is open and unlocked:

| Where | Folder |
| --- | --- |
| Desktop app | `Documents/Somnium Backups` (changeable) |
| Android app | `Documents/Somnium` |
| Chromium browsers | a folder picked once (File System Access API) |
| Other browsers | can't save files on their own: a due backup is offered as a download |

Each backup is logged on the device (time, size, where) for the Security checklist.

Restoring shows a preview answered on the device (counts and date range from the plain columns), asks for the password
or recovery key, opens the rows on the device and hands them to the normal import, which seals them again under the
current account's key. So a backup restores into the same account, another account, a local or a server account.

- **Merge** adds what is missing; a row both sides have is taken from the file only when the file's copy is newer
  (`updated_at`). A night for a date the account already has is merged into that night.
- **Replace** (asked twice, and a backup of the current journal is saved first) removes the journal's rows and puts the
  file's in their place. The account, its password and recovery key stay.

## Export

From Settings → Data. None of these files are encrypted; the screen says so.

- **JSON**: everything, opened.
- **Markdown**: one file per dream in a zip (store-only zip written by `packages/shared/src/dataFiles.ts`), or one long file.
- **CSV**: `dreams.csv`, `nights.csv`, `reality-checks.csv` in a zip, RFC 4180 quoting, UTF-8 with a BOM. Words
  (titles, text, notes) only when "Include dream text in CSV" is on. Cells that a spreadsheet would run as a formula
  get a leading apostrophe.

## Import

- **Somnium backups and JSON exports**: as Restore above.
- **Markdown or text**: split at date headings (`# 2026-11-07`, `## Saturday, 7 November 2026`, `**07.11.2026**`,
  `November 7, 2026`). A file with no date headings is one dream dated by its front matter (`date:`) or its file name,
  which covers one-note-per-dream folders. Several files can be chosen at once.
- **CSV**: the person maps the date, title, text and lucid columns (guessed from the header). Comma, semicolon and tab
  delimiters are recognised.

Every proposed entry is shown for review first; the chosen ones are saved through the normal routes, so they are sealed
on the way in.

### Other apps

RESEARCH.md Part C §6 lists what the surveyed apps say they export. None documents the layout of its files, so Somnium
has no app-specific reader and claims none:

| App | Export it names | How to bring it in |
| --- | --- | --- |
| Oniri | PDF, TXT, CSV, video | TXT through Markdown or text; CSV through CSV with the column mapping |
| Lucidity (Christopher Benz) | PDF book, backup | Not readable: the PDF is a book and the backup format is not documented |
| dreamy | one Markdown file per dream | Markdown or text (choose all the files) |
| Obsidian Dream Journal plugin | Markdown notes | Markdown or text (front matter `date:` is read) |
| drem, LucidSourceKit | JSON / MD / CSV, backup | Their Markdown and CSV through the general paths; their JSON is not Somnium's and is refused |

Photos of a paper journal (OCR) are a separate task (LDJ-16).
