// Serializable view-models for the naming studio. Loaded on the server,
// consumed by the client studio without re-hydrating the full corpus.

import type { NameCandidateRecord } from "@/lib/brand/load";

export const MIX_LAYER_OPTIONS = [
  { value: "classicalLatin", label: "Latin" },
  { value: "ancientGreek", label: "Ancient Greek" },
  { value: "oldFrench", label: "Old French" },
  { value: "oldEnglish", label: "Old English" },
  { value: "oldNorse", label: "Old Norse" },
  { value: "middleEnglish", label: "Middle English" },
  { value: "sanskrit", label: "Sanskrit" },
] as const;

export type MixLayer = (typeof MIX_LAYER_OPTIONS)[number]["value"];

export interface StudioWordSummary {
  /** Display form, e.g. "Abundance". */
  word: string;
  /** Corpus key, lowercase ASCII letters only, e.g. "abundance". */
  slug: string;
  semanticField: string;
  tone: string;
  syllables: number | null;
  /** Number of language-era forms populated in the corpus. */
  formCount: number;
}

export interface StudioFormView {
  layer: string;
  language: string;
  form: string;
  stem: string;
  syllables: number;
}

export interface StudioTableView {
  slug: string;
  word: string;
  semanticField: string;
  tone: string;
  driftNotes: string;
  syllables: number | null;
  forms: StudioFormView[];
  curatedNames: string[];
}

export interface StudioPartView {
  /** Normalized letters used in the splice. */
  value: string;
  /** full | onset | opening (head) or full | rhyme | ending (tail). */
  partOf: string;
  /** "Latin", "Ancient Greek", ... */
  language: string;
  /** Corpus source form, e.g. "abundantia". */
  form: string;
}

export interface StudioPieceView extends StudioPartView {
  /** Owning source word, display form. */
  word: string;
  /** Semantic field. */
  gloss: string;
  lexicalId: string;
  syllables: number;
}

export interface StudioHybridSide {
  word: string;
  piece: string;
  form: string;
  language: string;
  gloss: string;
}

export interface StudioHybridView {
  slug: string;
  term: string;
  strategy: "portmanteau" | "compound" | "suffixation";
  syllables: number;
  pronounceability: number;
  left: StudioHybridSide;
  right: StudioHybridSide;
  note: string;
}

/** Candidate rows lifted into the client so the studio can show the same board. */
export type StudioCandidateRecord = NameCandidateRecord;
