import "server-only";

import {
  DEFAULT_MIX_LAYERS,
  entries,
  etymologyTables,
  headPiecesFor,
  suggestHybrids,
  tailPiecesFor,
  type BlendPiece,
  type HybridSuggestion,
} from "@etymalia/name-engine";
import { normalizeLetters } from "./slug";
import type {
  MixLayer,
  StudioHybridView,
  StudioPieceView,
  StudioTableView,
  StudioWordSummary,
} from "./studio";

const MAX_PICKED = 6;

export function allWordSummaries(): StudioWordSummary[] {
  return entries.map((entry) => ({
    word: entry.word,
    slug: normalizeLetters(entry.word),
    semanticField: entry.semanticField,
    tone: entry.tone,
    syllables: entry.syllables,
    formCount: Object.keys(entry.layers).length,
  }));
}

export function tablesForPicked(slugs: string[]): StudioTableView[] {
  const requested = slugs.slice(0, MAX_PICKED).map((slug) => slug.trim()).filter(Boolean);
  return etymologyTables(requested).map((table) => ({
    slug: normalizeLetters(table.word),
    word: table.word,
    semanticField: table.semanticField,
    tone: table.tone,
    driftNotes: table.driftNotes,
    syllables: table.syllables,
    forms: table.forms.map((form) => ({
      layer: form.layer,
      language: form.language,
      form: form.form,
      stem: form.stem,
      syllables: form.syllables,
    })),
    curatedNames: table.curatedNames,
  }));
}

function toPieceView(piece: BlendPiece): StudioPieceView {
  return {
    lexicalId: piece.lexicalId,
    word: piece.word,
    gloss: piece.gloss,
    language: piece.language,
    form: piece.form,
    partOf: piece.partOf,
    value: piece.value,
    syllables: piece.syllables,
  };
}

export function piecesForPicked(
  words: string[],
  layers: MixLayer[] = [...DEFAULT_MIX_LAYERS] as MixLayer[],
): { heads: StudioPieceView[]; tails: StudioPieceView[] } {
  const heads: StudioPieceView[] = [];
  const tails: StudioPieceView[] = [];
  for (const word of words.slice(0, MAX_PICKED)) {
    heads.push(...headPiecesFor(word, layers).map(toPieceView));
    tails.push(...tailPiecesFor(word, layers).map(toPieceView));
  }
  return { heads, tails };
}

function toHybridView(suggestion: HybridSuggestion): StudioHybridView {
  return {
    slug: suggestion.slug,
    term: suggestion.term,
    strategy: suggestion.strategy,
    syllables: suggestion.syllables,
    pronounceability: suggestion.pronounceability,
    left: {
      word: suggestion.left.word,
      piece: suggestion.left.piece,
      form: suggestion.left.form,
      language: suggestion.left.language,
      gloss: suggestion.left.gloss,
    },
    right: {
      word: suggestion.right.word,
      piece: suggestion.right.piece,
      form: suggestion.right.form,
      language: suggestion.right.language,
      gloss: suggestion.right.gloss,
    },
    note: suggestion.note,
  };
}

export function suggestionsForPicked(
  words: string[],
  options: { layers?: MixLayer[]; maxSyllables?: number; count?: number } = {},
): StudioHybridView[] {
  const layers = options.layers && options.layers.length
    ? options.layers
    : ([...DEFAULT_MIX_LAYERS] as MixLayer[]);
  return suggestHybrids(words.slice(0, MAX_PICKED), {
    layers,
    count: options.count ?? 60,
    maxSyllables: options.maxSyllables ?? 6,
  }).map(toHybridView);
}