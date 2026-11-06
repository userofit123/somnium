# Lexicon sources

What each file is built from. References are to `RESEARCH.md`: `C13` is number 13 in the reference list of Part C,
`D8` is number 8 in the list of Part D, `B37` is number 37 in the list of Part B. The lists are numbered separately,
so C1 and D1 happen to be the same book while C3 and D3 are not. `C§7` and `D§1.2` point to a section, for statements that have no numbered reference (usually
"no study was found").

## Licence

Every word list and cue pattern here was written for Somnium and ships under the licence of this repository. No
third-party word list was copied. What comes from the literature is limited to category names, published figures and
short attributed quotations:

- the Hall and Van de Castle coding categories, used as a grouping idea only;
- the 55 theme names and prevalence figures of Nielsen et al. (2003), Table 1, with attribution;
- LaBerge's category and sub-type structure, and his short example reports, quoted in the `example` field of `signs.json`.

DreamBank reports (C10, CC BY-NC-SA 4.0) were not used to build any file.

## Files

| File | Built from | Written by us |
|---|---|---|
| `characters.json` | Groups are adapted from the HVDC character codes: the identity codes (immediate family, relative, known, prominent, occupational, ethnic or national, stranger, uncertain) and the number codes for dead and imaginary characters, plus animals (C9a; RESEARCH.md Part C section 2.1). Our group names are not the HVDC names. | All terms. |
| `places.json` | Groups follow the plan (PLAN.md section 7.1); the HVDC setting codes for familiar, distorted, unfamiliar and questionable settings motivate the `unknown` group (C9a). | All terms. |
| `objects.json` | HVDC object classes as a starting point (C9a), extended with the objects that matter for dream signs and reality checks: clocks, mirrors, text, light switches (C1, D1). | All terms. |
| `actions.json` | HVDC activities, aggression, friendliness, sexuality and misfortune codes (C9a), and the typical themes (C13). | All terms. |
| `sensations.json` | The five HVDC emotion classes: anger, apprehension, sadness, confusion, happiness (C9a). Awe, body sensations, weightlessness and paralysis come from the plan and the inner-awareness category (C1). | All terms. |
| `emotions.json` | Nothing external. See below. | All terms. |
| `themes.json` | The Typical Dreams Questionnaire table in Part C section 2.4 (C13). Figures were parsed from that table, not retyped. Stability across samples: C14. | The `terms` cue phrases and `id`. |
| `signs.json` | The Dreamsign Inventory table in Part C section 1.2: 4 categories, 18 sub-types, examples (C1). Definition and scale context: C2. | The `cues`, and the sub-type `description` paraphrases. |
| `checks.json` | Part C section 7 and Part D section 1.2. Each entry lists its own references. | The `howTo` wording, and `pairsWith`. |

Three limits to keep in mind when using these:

- **The cue patterns are ours, not LaBerge's.** He gives categories and examples, not a word list. A cue hit is a
  suggestion for the person to confirm (PLAN.md section 7.1), not a finding.
- **`pairsWith` in `checks.json` is our design judgement.** The sources link testing to dreamsigns in general (C1, D1)
  but do not pair specific checks with specific categories.
- **Prevalence means "ever dreamed".** TDQ respondents tick each theme they have ever dreamed, in a sample of 1,181
  Canadian first-year students (C13). The figures are lifetime prevalence, not how often a theme occurs per dream.
  Ranks follow the paper's combined criterion, so a few adjacent rows are not strictly sorted by the total column.

## Why the emotion lexicon is original

`emotions.json` covers the 8 basic emotions (joy, fear, anger, sadness, disgust, surprise, trust, anticipation) plus
positive and negative valence, and was written from scratch for this project.

The NRC Word-Emotion Association Lexicon (EmoLex, C37) would be the obvious source, and it was **not used**: it is free
only for non-commercial research and educational use, it prohibits redistribution of the data, and commercial use needs
a licence from NRC. Bundling it in a distributed app would break those terms. No EmoLex data was consulted, copied or
derived from. The eight emotion labels and the two valence labels are our own choice of categories; no source in RESEARCH.md
lists them, and the words under them are ours.

VADER (C38, MIT licence) is the alternative Part C names for valence. It is not bundled here; ours keeps the app free of
extra data files.

Text-derived emotion has a known bias: narrative text under-reports positive feeling, so a lexicon run over dream
reports skews negative (C21, C21a). The person's own rating should always win over these lists.

## Reality checks: strength of evidence

Reality testing on its own did not raise lucid dreaming over one week in two field studies (D11, D12; also C32, C33;
RESEARCH.md Part B sections 3.3 and 3.12, B37 and B38), and a systematic review found no induction technique verified
to work reliably (C34). Every `evidence` note in `checks.json` carries that caveat and cites B§3.12, B37 and B38, and
marks community checks (nose pinch, finger through palm, counting fingers, jumping, mirror) as such instead of claiming
support for them. Pinching yourself is left out on purpose: LaBerge rejects it because it just
produces a convincing pinch (D§1.2).
