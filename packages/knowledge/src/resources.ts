// The Resources page in Learn: books, key studies, organisations and websites, communities. Every entry points at
// a reference in sources.md (the merged reference lists of RESEARCH.md), and its link is the first address in that
// reference text, so no link is invented. Nothing is marked as recommended: RESEARCH.md does not rank them.
import type { Source } from "./content";

export interface Resource {
  title: string;
  /** Who and when, in plain words. */
  by: string;
  /** One plain line: what it is, or for a study what it found. */
  note?: string;
  /** Reference ids in sources.md; the first one supplies the link, if it has one. */
  src: string[];
}

export interface ResourceGroup { id: string; title: string; items: Resource[] }

export const resourceGroups: readonly ResourceGroup[] = [
  { id: "books", title: "Books", items: [
    { title: "Exploring the World of Lucid Dreaming", by: "Stephen LaBerge and Howard Rheingold, 1990", note: "Dreamsigns and critical state testing are in chapters 2 and 3.", src: ["A1"] },
    { title: "A Course in Lucid Dreaming", by: "Lucy Levitan and Stephen LaBerge, The Lucidity Institute, 1995", note: "A unit-by-unit course that allows at least three weeks for each unit.", src: ["D5"] },
    { title: "Creative Dreaming", by: "Patricia Garfield, 1974", src: ["A29"] },
    { title: "Are You Dreaming? Exploring Lucid Dreams", by: "Daniel Love, 2013", note: "Runs from reality checks and dream diaries through MILD and WILD to his own CAT technique.", src: ["C43"] },
    { title: "Lucid Dreaming: A Beginner's Guide to Becoming Conscious in Your Dreams", by: "Charlie Morley, 2013", src: ["C44"] },
    { title: "Dreams of Awakening", by: "Charlie Morley, 2013, revised 2024", note: "Lucid dreaming with mindfulness of dream and sleep.", src: ["D32"] },
    { title: "Lucid Dreaming: Gateway to the Inner Self", by: "Robert Waggoner, 2008", src: ["C41"] },
    { title: "The Tibetan Yogas of Dream and Sleep", by: "Tenzin Wangyal Rinpoche, 1998", src: ["D28"] },
    { title: "Dream Yoga and the Practice of Natural Light", by: "Namkhai Norbu, 1992", src: ["D29"] },
    { title: "Dreaming Yourself Awake", by: "B. Alan Wallace, 2012", src: ["D31"] },
    { title: "Dream Yoga", by: "Andrew Holecek, 2016", src: ["D33"] },
    { title: "The Mystique of Dreams", by: "G. William Domhoff, 1985", note: "A critical look at Senoi dream theory.", src: ["A31"] },
  ] },
  { id: "studies", title: "Key studies", items: [
    { title: "Lucid dreaming verified by volitional communication during REM sleep", by: "LaBerge, Nagel, Dement and Zarcone, 1981", note: "Dreamers signalled with agreed eye movements while the lab recorded REM sleep.", src: ["A38"] },
    { title: "Lucid dreaming incidence: a meta-analysis of 50 years of research", by: "Saunders, Roe, Smith and Clegg, 2016", note: "55 percent of people have had a lucid dream and 23 percent have them monthly or more.", src: ["A21"] },
    { title: "Lucid dreaming: a state of consciousness with features of both waking and non-lucid dreaming", by: "Voss, Holzmann, Tuin and Hobson, 2009", note: "Lucid dreaming looked like a hybrid state with features of waking and of REM.", src: ["A44"] },
    { title: "Neural correlates of dream lucidity", by: "Dresler and colleagues, 2012", note: "In one person, lucid REM activated regions that are normally quiet in REM. It is still one case.", src: ["A47"] },
    { title: "Induction of lucid dreams: a systematic review of evidence", by: "Stumbrys, Erlacher, Schaedlich and Schredl, 2012", note: "Of 35 studies, none showed a technique that works reliably; MILD with wake-back-to-bed looked most promising.", src: ["A49"] },
    { title: "National Australian and International Lucid Dream Induction Studies", by: "Aspy and colleagues, 2017 and 2020", note: "MILD with wake-back-to-bed led to lucid dreams on roughly 17 to 20 percent of nights; reality testing alone was the least effective.", src: ["A50", "A51"] },
    { title: "Wake up, work on dreams, back to bed and lucid dream", by: "Erlacher and Stumbrys, 2020", note: "In a sleep laboratory, an alarm at 4.5 hours was too early and an hour awake did better than 30 minutes.", src: ["D13"] },
    { title: "Real-time dialogue between experimenters and dreamers during REM sleep", by: "Konkoly and colleagues, 2021", note: "Sleepers in lucid REM answered questions by eye or facial signals: 29 correct answers from six people.", src: ["A54"] },
    { title: "Pre-sleep treatment with galantamine stimulates lucid dreaming", by: "LaBerge, LaMarca and Baird, 2018", note: "A double-blind crossover: lucid dreams on 14 percent of placebo nights and 42 percent with 8 mg. A prescription drug.", src: ["A52"] },
    { title: "Practicing a motor task in a lucid dream enhances subsequent performance", by: "Erlacher and Schredl, 2010", note: "The seven people who practised a coin-tossing task in a lucid dream improved more than controls. The group is tiny.", src: ["B64"] },
    { title: "Lucid dreaming treatment for nightmares: a pilot study", by: "Spoormaker and van den Bout, 2006", note: "Nightmare frequency fell in both treatment groups at 12 weeks; sleep quality and PTSD severity did not change.", src: ["B57"] },
    { title: "Increased lucid dream frequency in long-term meditators but not following mindfulness-based stress reduction training", by: "Baird and colleagues, 2019", note: "Long-term meditators had more lucid dreams; an eight-week course did not change the frequency.", src: ["B46"] },
    { title: "Is dream recall underestimated by retrospective measures and enhanced by keeping a logbook?", by: "Aspy, 2016", note: "Single questions underestimate recall, and keeping a logbook enhances it.", src: ["B48"] },
  ] },
  { id: "orgs", title: "Organisations and labs", items: [
    { title: "International Association for the Study of Dreams", by: "IASD", note: "The society for dream research; the reference covers its history.", src: ["A40"] },
    { title: "The Lucidity Institute", by: "Stephen LaBerge's institute", note: "Its Lucid Dreaming FAQ is an archived copy.", src: ["D3"] },
    { title: "Lucidity Letter archive", by: "MacEwan University", note: "The back issues of the Lucidity Letter, with its history.", src: ["A39"] },
    { title: "DreamBank", by: "G. William Domhoff and Adam Schneider", note: "More than 20,000 dream reports to read and search.", src: ["C10"] },
  ] },
  { id: "sites", title: "Websites and tutorials", items: [
    { title: "What is the state of the art on lucid dreaming?", by: "Ursula Voss and J. Allan Hobson, 2015, Open MIND", src: ["A2"] },
    { title: "Who really proved lucid dreaming? Hearne vs LaBerge", by: "The Lucid Guide", src: ["A35"] },
    { title: "Science (including lucid dream research)", by: "Keith Hearne", src: ["A34"] },
    { title: "Bringing to life the secret history of lucid dreaming", by: "Dream Studies Portal", note: "On the Marquis d'Hervey de Saint-Denys.", src: ["A18"] },
    { title: "SSILD official tutorial 2.0", by: "Cosmic Iron, 2013", src: ["D19"] },
  ] },
  { id: "communities", title: "Communities", items: [
    { title: "LD4all", by: "Community forum", note: "The reference tells the history of the forum.", src: ["A58"] },
    { title: "DreamViews", by: "Community forum", note: "Home of the All Day Awareness and FILD threads cited in the techniques.", src: ["D20"] },
  ] },
];

export interface ResolvedResource extends Resource { link: string | null }

/** The link is the first web address in the first reference's text, exactly as written there; none if it has none. */
export function linkOf(r: Resource, sources: ReadonlyMap<string, Source>): string | null {
  const text = sources.get(r.src[0]!)?.text ?? "";
  return /https?:\/\/[^\s;)]+/.exec(text)?.[0].replace(/[.,]+$/, "") ?? null;
}

export function resolveResources(sources: ReadonlyMap<string, Source>): { id: string; title: string; items: ResolvedResource[] }[] {
  return resourceGroups.map((g) => ({ ...g, items: g.items.map((r) => ({ ...r, link: linkOf(r, sources) })) }));
}
