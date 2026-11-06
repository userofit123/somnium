---
title: How the app finds signs
section: dream-signs
summary: The app reads each dream on your device, suggests signs, characters, settings and themes for you to confirm, and ranks signs by frequency and by their link to lucidity.
reviewed: 2026-11-06
sources: [C1, C2, C9, C9a, C11, C12, C12a, C12b, C13, C21, C23, C24, C24a, C32, C33, C39a, C39b, C40c]
---

Every analysis in this app runs on your device. No dream text is sent anywhere. This article explains what the analysis does, what it is based on, and what it cannot do.

## What it looks for

The app reads a dream entry and proposes four kinds of element for you to confirm or reject:

- Dream signs, in LaBerge's four categories and eighteen sub-types, matched from a seed lexicon built from the book's definitions and examples [C1].
- Typical themes, from the 55-item Typical Dreams Questionnaire, each with its population prevalence [C13].
- Characters, settings and objects, found by noun and name extraction, with capitalised unknown words treated as likely characters for you to confirm [C1].
- Emotion and content categories, using the Hall and Van de Castle system's five emotion classes (anger, apprehension, sadness, confusion, happiness), its setting codes (indoor or outdoor; familiar, unfamiliar or distorted) and its character identity codes (family, known, stranger, prominent, dead, imaginary) as fixed vocabularies [C9a].

Lexicon matching works on word stems and on your own synonyms (for example "teeth", "tooth", "molar"), which is what the pattern analysers in existing apps do at the product level [C39a][C39b].

## What it does with them

The first analysis the book itself prescribes is to count signs by category and rank them; the most frequent is your target [C1]. The app does that, and adds:

- A personal ranking that weights frequency by effect: for each sign, the lucid rate of dreams containing it against your overall rate, the approach taken by the open-source project drem, combined with your mean awareness rating for the sign, following the course's logic that awareness of strangeness predicts lucidity [C40c][C2].
- Co-occurrence of signs, characters and settings [C11].
- Rolling recall and lucid rates, the distribution of awareness ratings over time, and technique effectiveness by nights used versus not used, with the time-to-sleep buckets that predicted success in the induction studies [C2][C33][C32].
- Comparisons of your characters, settings, emotions and social interactions against the Hall and Van de Castle norms, with the caveat that those are mid-century American student dreams [C9].

## Why frequency, not single occurrences

Domhoff's long-series studies found "considerable continuity between the frequency with which specific people and avocations appear in a dream series and the intensity of waking personal concerns about those people and avocations" [C12a]. It is frequency across the journal, not a single appearance, that research has validated [C12]. Critics note that instruments for measuring waking concerns are lacking, so the app presents such links as patterns, not findings [C12b].

## Why your own ratings win

Text-based reading of emotion skews negative: self-ratings produce more emotional dreams and more positive emotion, while external raters find mostly negative emotion because positive feeling is under-reported in narrative [C21]. When you rate a dream's emotion, the app uses your rating and treats any lexicon result as secondary [C21].

## Day residue and dream lag

Material from the previous day appears in dreams, and so does material from five to seven days earlier, a "dream-lag" effect found in diary and laboratory studies [C23][C24][C24a]. If you keep the one-line day log, the app can show possible sources from yesterday and from a week ago when a tag reappears, treating same-weekday repetition as a confound rather than an effect [C24].

## Statistical honesty

Dream series are autocorrelated and most people have a small number of entries. The app shows counts beside every percentage, suppresses comparisons under about 20 dreams, and prefers "nights with technique X: 8 lucid of 40" over a bare rate [C12a].

## What it cannot do

It cannot interpret your dreams, and it does not try. It cannot know which oddities you will notice as odd; that is the awareness rating's job. It is a rule-based assistant that pre-fills tags for you to confirm, because the research models for automatic content coding rely on large cloud models that this app will not use [C9a]. The confirmed tags are yours; the counting is the app's.
