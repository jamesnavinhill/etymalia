// Shared view-model and state types for the focused etymology lab (`/names`).
// Client-safe by design: the page ships the whole corpus view-model once so
// the matrix, selection, and notes all run without server round trips.

export interface LabForm {
  /** Stable selection key, `${slug}:${layer}`. */
  id: string;
  layer: string;
  language: string;
  /** Corpus display form, e.g. "*wed- (water, wave)". */
  form: string;
  stem: string;
  syllables: number;
}

export interface LabCandidate {
  /** Stable selection key, `${slug}:candidate:${name}`. */
  id: string;
  name: string;
  stem: string;
}

export interface LabEntry {
  slug: string;
  word: string;
  semanticField: string;
  tone: string;
  syllables: number | null;
  driftNotes: string;
  /** Era forms ordered oldest first, matching the matrix column order. */
  forms: LabForm[];
  candidates: LabCandidate[];
}

export interface LabCorpus {
  entries: LabEntry[];
  stats: { words: number; forms: number; candidates: number };
}

export type LabView = "all" | "selected";

export interface LabState {
  /** Picked root-word slugs, in pick order. Empty picks = show every word. */
  picked: string[];
  /** Selected form/candidate ids, in selection order. */
  selected: string[];
  /** Idea notes keyed by selection id. */
  notes: Record<string, string>;
  view: LabView;
}

export const LAB_STORAGE_KEY = "etymalia-etymology-lab:v1";

export const EMPTY_LAB_STATE: LabState = {
  picked: [],
  selected: [],
  notes: {},
  view: "all",
};

/** Matrix columns, oldest era first — mirrors the corpus table order. */
export const ERA_COLUMNS = [
  { layer: "pie", label: "PIE", title: "Proto-Indo-European" },
  { layer: "protoGermanic", label: "Proto-Germanic", title: "Proto-Germanic" },
  { layer: "oldEnglish", label: "Old English", title: "Old English" },
  { layer: "oldNorse", label: "Old Norse", title: "Old Norse" },
  { layer: "middleEnglish", label: "Middle English", title: "Middle English" },
  { layer: "classicalLatin", label: "Latin", title: "Classical Latin" },
  { layer: "vulgarLatin", label: "Medieval Latin", title: "Medieval Latin" },
  { layer: "ancientGreek", label: "Greek", title: "Ancient Greek" },
  { layer: "oldFrench", label: "Old French", title: "Old French" },
  { layer: "sanskrit", label: "Sanskrit", title: "Sanskrit" },
  { layer: "arabic", label: "Arabic", title: "Arabic" },
  { layer: "persian", label: "Persian", title: "Persian" },
  { layer: "hebrew", label: "Hebrew", title: "Hebrew" },
  { layer: "celtic", label: "Celtic", title: "Celtic" },
] as const;

/** Compact display of a corpus form: drops the parenthetical gloss/script. */
export function formBrief(form: string): string {
  return form.split(" (")[0].trim();
}

/** Drop unknown or foreign ids so a stale saved state cannot reference words
 * that no longer exist in the shipped corpus. */
export function sanitizeLabState(parsed: unknown, corpus: LabCorpus): LabState {
  if (typeof parsed !== "object" || parsed === null) return { ...EMPTY_LAB_STATE };
  const raw = parsed as Partial<LabState>;

  const knownSlugs = new Set(corpus.entries.map((entry) => entry.slug));
  const knownIds = new Set<string>();
  for (const entry of corpus.entries) {
    for (const form of entry.forms) knownIds.add(form.id);
    for (const candidate of entry.candidates) knownIds.add(candidate.id);
  }

  const picked = Array.isArray(raw.picked)
    ? raw.picked.filter((slug): slug is string => typeof slug === "string" && knownSlugs.has(slug))
    : [];
  const selected = Array.isArray(raw.selected)
    ? raw.selected.filter((id): id is string => typeof id === "string" && knownIds.has(id))
    : [];

  const notes: Record<string, string> = {};
  if (typeof raw.notes === "object" && raw.notes !== null) {
    for (const [id, value] of Object.entries(raw.notes)) {
      if (knownIds.has(id) && typeof value === "string" && value.trim()) notes[id] = value;
    }
  }

  return {
    picked: [...new Set(picked)],
    selected: [...new Set(selected)],
    notes,
    view: raw.view === "selected" ? "selected" : "all",
  };
}
