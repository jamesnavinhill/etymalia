// User-directed mixing over the curated corpus. Where generateNames() answers
// "what names follow from these keywords", this module answers "show me the
// full table for THE words I picked, and the interesting ways they combine".
//
// Everything here is deterministic and complete by construction: the same
// source words always produce the same tables, pieces, and ranked hybrids.

import { entries, languageLabel, toStem } from "./corpus";
import { estimateSyllables, normalizeLetters, pronounceability } from "./phonetics";

/** Language/era layers shown in tables, ordered oldest to most recent. */
export const TABLE_LAYERS = [
  "pie",
  "protoGermanic",
  "oldEnglish",
  "oldNorse",
  "middleEnglish",
  "classicalLatin",
  "vulgarLatin",
  "ancientGreek",
  "oldFrench",
  "sanskrit",
  "arabic",
  "persian",
  "hebrew",
  "celtic",
] as const;

/** Language/era layers that mixing draws stems from by default. */
export const DEFAULT_MIX_LAYERS = [
  "classicalLatin",
  "ancientGreek",
  "oldFrench",
  "oldEnglish",
  "oldNorse",
  "middleEnglish",
  "sanskrit",
] as const;

const VALID_LAYER = new Set<string>(TABLE_LAYERS);

/** Optional brand-suffix families for single-stem affixation. */
export const SUFFIX_FAMILIES = {
  latin: ["a", "ia", "ium", "is", "or", "ara"],
  greek: ["ia", "on", "os", "ea"],
  norse: ["r", "en"],
} as const;

export type SuffixFamily = keyof typeof SUFFIX_FAMILIES;

// ---------------------------------------------------------------------------
// Etymology tables — everything we know about one picked source word.
// ---------------------------------------------------------------------------

export interface FormDescriptor {
  layer: string;
  language: string;
  form: string;
  stem: string;
  syllables: number;
}

export interface EtymologyTable {
  word: string;
  semanticField: string;
  tone: string;
  driftNotes: string;
  syllables: number | null;
  forms: FormDescriptor[];
  curatedNames: string[];
}

/** Full etymology tables for arbitrary modern words, in corpus order. Words
 * that are not in the corpus are omitted (the UI blocks selecting them). */
export function etymologyTables(words: string[]): EtymologyTable[] {
  const wanted = words.map((word) => normalizeLetters(word)).filter(Boolean);
  return entries
    .filter((entry) => wanted.includes(normalizeLetters(entry.word)))
    .map((entry) => ({
      word: entry.word,
      semanticField: entry.semanticField,
      tone: entry.tone,
      driftNotes: entry.driftNotes,
      syllables: entry.syllables,
      forms: TABLE_LAYERS
        .filter((layer) => Boolean(entry.layers[layer]))
        .map((layer) => ({
          layer,
          language: languageLabel(layer),
          form: entry.layers[layer],
          stem: toStem(entry.layers[layer]),
          syllables: estimateSyllables(toStem(entry.layers[layer])),
        })),
      curatedNames: entry.candidates,
    }));
}

// ---------------------------------------------------------------------------
// Blend pieces — every selectable head/tail of every stem of a picked word.
// ---------------------------------------------------------------------------

export interface BlendPiece {
  /** Head/tail text (normalized lowercase letters). */
  value: string;
  /** "full" | "onset" | "opening" (heads) or "full" | "rhyme" | "ending" (tails). */
  partOf: string;
  lexicalId: string;
  word: string;
  gloss: string;
  form: string;
  language: string;
  layer: string;
  syllables: number;
}

interface StemSource {
  lexicalId: string;
  word: string;
  gloss: string;
  form: string;
  language: string;
  layer: string;
  stem: string;
}

function stemSources(word: string, layers: string[]): StemSource[] {
  const normalized = normalizeLetters(word);
  const entry = entries.find((candidate) => normalizeLetters(candidate.word) === normalized);
  if (!entry) return [];
  const wantedLayers = (layers.length ? layers : DEFAULT_MIX_LAYERS).filter((layer) => VALID_LAYER.has(layer));
  return wantedLayers
    .filter((layer) => Boolean(entry.layers[layer]))
    .map((layer) => ({
      lexicalId: `${normalized}:${layer}`,
      word: entry.word,
      gloss: entry.semanticField,
      form: entry.layers[layer],
      language: languageLabel(layer),
      layer,
      stem: toStem(entry.layers[layer]),
    }))
    .filter((source) => source.stem.length >= 3);
}

function uniqueParts(parts: BlendPiece[]): BlendPiece[] {
  const seen = new Set<string>();
  return parts.filter((part) => {
    if (!part.value || seen.has(part.value)) return false;
    seen.add(part.value);
    return true;
  });
}

/** Head preserves for a stem: whole stem, onset, opening half. */
export function headPiecesFor(word: string, layers: string[] = []): BlendPiece[] {
  const parts: BlendPiece[] = [];
  for (const source of stemSources(word, layers)) {
    const stem = source.stem;
    const onset = stem.match(/^[^aeiouy]*[aeiouy]+[^aeiouy]?/)?.[0] ?? stem.slice(0, 3);
    const opening = stem.slice(0, Math.max(3, Math.ceil(stem.length / 2)));
    const descriptors: Array<[string, string]> = [
      ["full", stem],
      ["onset", onset],
      ["opening", opening],
    ];
    for (const [partOf, value] of descriptors) {
      parts.push({ ...source, partOf, value: normalizeLetters(value), syllables: estimateSyllables(normalizeLetters(value)) });
    }
  }
  return uniqueParts(parts);
}

/** Tail preserves for a stem: whole stem, rhyme (last vowel to end), ending third. */
export function tailPiecesFor(word: string, layers: string[] = []): BlendPiece[] {
  const parts: BlendPiece[] = [];
  for (const source of stemSources(word, layers)) {
    const stem = source.stem;
    const rhyme = stem.match(/[aeiouy][^aeiouy]*$/)?.[0] ?? stem.slice(-3);
    const ending = stem.slice(Math.max(0, stem.length - Math.max(3, Math.floor(stem.length / 3))));
    const descriptors: Array<[string, string]> = [
      ["full", stem],
      ["rhyme", rhyme],
      ["ending", ending],
    ];
    for (const [partOf, value] of descriptors) {
      parts.push({ ...source, partOf, value: normalizeLetters(value), syllables: estimateSyllables(normalizeLetters(value)) });
    }
  }
  return uniqueParts(parts);
}

// ---------------------------------------------------------------------------
// Hybrids — spliced combinations of one piece from each of two chosen words.
// ---------------------------------------------------------------------------

export type HybridStrategy = "portmanteau" | "compound" | "suffixation";

export interface HybridPieceRef {
  word: string;
  piece: string;
  form: string;
  language: string;
  gloss: string;
}

export interface HybridSuggestion {
  slug: string;
  term: string;
  strategy: HybridStrategy;
  syllables: number;
  pronounceability: number;
  left: HybridPieceRef;
  right: HybridPieceRef;
  note: string;
}

export interface SuggestionOptions {
  layers?: string[];
  suffixFamily?: SuffixFamily | "none";
  maxSyllables?: number;
  count?: number;
  exclusions?: string[];
}

function titleCase(slug: string): string {
  return slug ? slug[0].toUpperCase() + slug.slice(1) : slug;
}

/** Collapse a doubled letter or an over-long consonant run at a blend seam. */
export function healSeam(left: string, right: string): string {
  let joined = left + right;
  if (left.length && right.length && left[left.length - 1] === right[0]) {
    joined = left + right.slice(1);
  }
  return joined.replace(/([^aeiouy])\1*([^aeiouy])([^aeiouy])/g, "$1$2$3");
}

function noteFor(left: HybridPieceRef, right: HybridPieceRef): string {
  return `${left.piece} of ${left.language} ${left.form} '${left.gloss.toLowerCase()}' + ${right.piece} of ${right.language} ${right.form} '${right.gloss.toLowerCase()}'.`;
}

/** Score a joined hybrid so the top of the list reads as brandable first. */
function hybridScore(slug: string): number {
  const syllables = estimateSyllables(slug);
  const lengthScore = slug.length >= 4 && slug.length <= 10
    ? 1
    : Math.max(0, 1 - Math.abs(slug.length - 7) / 7);
  const syllableScore = syllables >= 2 && syllables <= 3
    ? 1
    : syllables === 4 ? 0.75 : Math.max(0, 1 - Math.abs(syllables - 2.5) / 3);
  return pronounceability(slug) * 0.5 + lengthScore * 0.25 + syllableScore * 0.25;
}

/**
 * Preview a single splice exactly as the mix lab shaped it. Returns null when
 * the joined form is outside brandable length bounds.
 */
export function previewSplice(left: BlendPiece, right: BlendPiece): HybridSuggestion | null {
  const slug = healSeam(normalizeLetters(left.value), normalizeLetters(right.value));
  if (slug.length < 3 || slug.length > 14) return null;
  return {
    slug,
    term: titleCase(slug),
    strategy: "portmanteau",
    syllables: estimateSyllables(slug),
    pronounceability: Math.round(pronounceability(slug) * 100) / 100,
    left: { word: left.word, piece: left.value, form: left.form, language: left.language, gloss: left.gloss },
    right: { word: right.word, piece: right.value, form: right.form, language: right.language, gloss: right.gloss },
    note: noteFor(
      { word: left.word, piece: left.value, form: left.form, language: left.language, gloss: left.gloss },
      { word: right.word, piece: right.value, form: right.form, language: right.language, gloss: right.gloss },
    ),
  };
}

/**
 * Suggest hybrids between the caller's chosen words. Deterministic and
 * complete: every era piece of every chosen word is crossed with every other,
 * in both orders and across all non-redundant piece combinations — then
 * ranked, de-duplicated, syllable-bounded, and capped for presentation.
 */
export function suggestHybrids(words: string[], options: SuggestionOptions = {}): HybridSuggestion[] {
  const cleanWords = words.map((word) => normalizeLetters(word)).filter(Boolean);
  const includeSuffixes = Boolean(options.suffixFamily && options.suffixFamily !== "none");
  if (cleanWords.length < 2 && !includeSuffixes) return [];

  const layers = options.layers ?? [];
  const maxSyllables = Math.max(1, options.maxSyllables ?? 6);
  const count = Math.max(1, Math.min(options.count ?? 60, 200));
  const exclusions = new Set((options.exclusions ?? []).map(normalizeLetters).filter(Boolean));
  const sourceSlugs = new Set(cleanWords);

  const suggestions: HybridSuggestion[] = [];
  const seen = new Set<string>();
  const push = (candidate: HybridSuggestion | null) => {
    if (!candidate) return;
    if (seen.has(candidate.slug) || sourceSlugs.has(candidate.slug)) return;
    if ([...exclusions].some((term) => candidate.slug.includes(term))) return;
    if (candidate.syllables > maxSyllables) return;
    seen.add(candidate.slug);
    suggestions.push(candidate);
  };

  const heads = new Map<string, BlendPiece[]>();
  const tails = new Map<string, BlendPiece[]>();
  for (const word of cleanWords) {
    heads.set(word, headPiecesFor(word, layers));
    tails.set(word, tailPiecesFor(word, layers));
  }

  for (const leftWord of cleanWords) {
    for (const rightWord of cleanWords) {
      if (leftWord === rightWord) continue;
      const leftParts = heads.get(leftWord) ?? [];
      const rightParts = tails.get(rightWord) ?? [];
      for (const left of leftParts) {
        for (const right of rightParts) {
          // Skip only the redundant full × full crossing — plain concatenation
          // is covered by the compound pass below with a healed seam.
          if (left.partOf === "full" && right.partOf === "full") continue;
          push(previewSplice(left, right));
        }
      }
    }
  }

  // Compounds: whole head stem + another word's ending tail.
  for (const leftWord of cleanWords) {
    for (const rightWord of cleanWords) {
      if (leftWord === rightWord) continue;
      const leftFull = (heads.get(leftWord) ?? []).filter((piece) => piece.partOf === "full");
      const rightEndings = (tails.get(rightWord) ?? []).filter((piece) => piece.partOf === "ending");
      for (const left of leftFull) {
        for (const right of rightEndings) {
          const slug = healSeam(left.value, right.value);
          if (slug.length < 3 || slug.length > 14) continue;
          push({
            slug,
            term: titleCase(slug),
            strategy: "compound",
            syllables: estimateSyllables(slug),
            pronounceability: Math.round(pronounceability(slug) * 100) / 100,
            left: { word: left.word, piece: left.value, form: left.form, language: left.language, gloss: left.gloss },
            right: { word: right.word, piece: right.value, form: right.form, language: right.language, gloss: right.gloss },
            note: noteFor(
              { word: left.word, piece: left.value, form: left.form, language: left.language, gloss: left.gloss },
              { word: right.word, piece: right.value, form: right.form, language: right.language, gloss: right.gloss },
            ),
          });
        }
      }
    }
  }

  // Optional brand suffixes on each chosen stem.
  const family = includeSuffixes ? SUFFIX_FAMILIES[options.suffixFamily as SuffixFamily] : null;
  if (family) {
    for (const word of cleanWords) {
      for (const stemPiece of (heads.get(word) ?? []).filter((piece) => piece.partOf === "full")) {
        for (const suffix of family) {
          if (stemPiece.value.endsWith(suffix[0]) && /[aeiouy]/.test(suffix[0])) continue;
          const slug = healSeam(stemPiece.value, suffix);
          if (slug.length < 3 || slug.length > 14) continue;
          const familyName = family === SUFFIX_FAMILIES.latin ? "Latin" : family === SUFFIX_FAMILIES.greek ? "Greek" : "Norse";
          const left: HybridPieceRef = { word: stemPiece.word, piece: stemPiece.value, form: stemPiece.form, language: stemPiece.language, gloss: stemPiece.gloss };
          const right: HybridPieceRef = { word: stemPiece.word, piece: `-${suffix}`, form: `${familyName} brand ending`, language: familyName, gloss: `a ${familyName.toLowerCase()} brand ending` };
          push({
            slug,
            term: titleCase(slug),
            strategy: "suffixation",
            syllables: estimateSyllables(slug),
            pronounceability: Math.round(pronounceability(slug) * 100) / 100,
            left,
            right,
            note: `${stemPiece.value} from ${stemPiece.language} ${stemPiece.form} '${stemPiece.gloss.toLowerCase()}' + -${suffix} (${familyName} brand ending).`,
          });
        }
      }
    }
  }

  return suggestions
    .sort((left, right) => hybridScore(right.slug) - hybridScore(left.slug))
    .slice(0, count);
}
