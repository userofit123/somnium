---
title: Existing journal apps
section: tools
summary: A neutral survey of the dream-journal apps and open-source projects that exist, what their users praise and complain about, and the gaps this app set out to fill.
reviewed: 2026-11-06
sources: [C13, C18, C39a, C39b, C39c, C39d, C39e, C39f, C39g, C39h, C39i, C39j, C39k, C39l, C39m, C39n, C39o, C39p, C39q, C39r, C40a, C40b, C40c, C40d, C40e, C40f, C40g, C40h, C40i, C40j]
---

RESEARCH.md surveyed the dream-journal market from store listings, repositories and developer pages on 6 November 2026 [C39a]. Prices and ratings change often; this is a snapshot.

## Commercial apps

- Awoken (Android, over a million installs) offers a journal with a silent morning prompt, hashtags, sketches, a lucid flag per entry, reality-check reminders by waking window and count, a "dream clues" totem sound during a sleep window, achievements, speech-to-text, and a premium pattern analyser. Free with ads; optional cloud backup [C39a][C39c].
- Lucidity (Android, by Christopher Benz) has writing or voice recording, a calendar with streaks, automatic extraction of symbols, themes, characters and settings into a personal dictionary, lessons on MILD, WILD, SSILD and WBTB, reality-check alerts, statistics, an emotion wheel, AI interpretation and PIN lock. It is closed source, contrary to a common assumption; AI interpretation implies cloud processing [C39b].
- Lucidity (iOS, by Shane Curtis) has tags, moods, guides, interval reminders, binaural beats and sync via sign-in; its privacy label links name, email and content to identity [C39d].
- Oniri (iOS) offers writing, recording and transcription, emotion and people tracking, AI interpretation and images, correlation modules, reminders, night cues, guided techniques and export. Its privacy label lists data used to track you; several reviews report lost dreams and forced logouts [C39e][C39f].
- Elsewhere (iOS) generates an AI image per dream, tracks recurring characters, settings and symbols, and offers interpretation styles in paid tiers; AI processing is in the cloud [C39g].
- Dream Journal Ultimate, DreamWell, DreamKeeper, Luci, Dreamboard, Dream Catcher, the Lucid Dreamer app, HowToLucid, Lucid Reality and MILD Trainer round out the field, from paid one-off purchases to subscriptions of around 13 dollars a month [C39h][C39i][C39j][C39k][C39l][C39m][C39n][C39o][C39p][C39q]. Reality Check: Lucid Dreams by Oneironaut LLC is a reminder app [C39r].

Apps named "Mindfield", "Lucid Dreaming Journal by Nimbus", "Luci (Morpheus)" and "Lucid (iOS)" could not be found in store listings and should be treated as unverified or defunct [C39a].

## Open-source and self-hosted projects

- LucidSourceKit (Android, GPL-3.0): journal with audio, text and templates, questionnaires, a prospective-memory trainer, binaural beats, alarms, statistics and export; no internet permission; local unencrypted storage [C40a].
- drem (Next.js, Postgres, Docker, Ollama): multiple dreams per night, tags, techniques, ratings, recall and lucid heatmaps and streaks, technique effectiveness, dream-sign detection with per-sign lucid rate versus baseline, handwriting OCR, voice memos, semantic search, encryption at rest, local or remote models assignable per task [C40c].
- Lightened Dream (Windows), dreamlog (browser, encrypted on device), DreamJournal (client-side PWA), dream-journal (Python Flask, MIT), dreamy (Windows, one Markdown file per dream), lucidlog, and openlucid (Muse EEG with a sound cue) [C40b][C40d][C40e][C40f][C40g][C40h][C40i].
- Obsidian has community "Dream Journal" and "Dream Analyzer" plugins [C40j].

## What users praise and complain about

Praise: quick capture by voice or silent morning prompt; random reality-check prompts ("10 times a day on random" improved one user's recall within a week); AI artwork as a memory aid for finding old dreams; privacy-minded design and local lock; streak heatmaps [C39o][C39g][C39b][C39d][C40c].

Complaints: reminders that stop firing after a day; no way to restrict random reminders to waking hours; sound-only alerts with no vibration-only option; a pile of queued notifications dumped in the morning; lost entries and forced logouts on cloud-synced apps; dated interfaces; paywalls on analytics and export; cloud AI that sends dream text to third-party providers [C39o][C39p][C39e][C39h][C39d][C39i][C39g].

## The gaps

No surveyed app implements the Lucidity Institute's dreamsign awareness scale; only drem logs technique use with per-technique lucid rates; none distinguishes nightmares from bad dreams or compares content with published norms; and reminders rarely offer waking-hour windows, quiet hours, vibration-only delivery and habit-anchored custom checks [C39a][C40c][C18][C13]. Those are the things this app was built to do, on your own server, with every analysis run on the device.
