import "server-only";

import { entries, etymologyTables, toStem } from "@etymalia/name-engine";
import { normalizeLetters } from "@/lib/brand/slug";
import type { LabCorpus, LabEntry } from "./lab";

let cached: LabCorpus | null = null;

/** Full lab corpus, computed once per server process. The `/names` page ships
 * this whole view-model to the client so the lab is instant: no per-word
 * fetches, no round trips while selecting and annotating. */
export function labCorpus(): LabCorpus {
  if (cached) return cached;

  const labEntries: LabEntry[] = etymologyTables(entries.map((entry) => entry.word)).map((table) => {
    const slug = normalizeLetters(table.word);
    return {
      slug,
      word: table.word,
      semanticField: table.semanticField,
      tone: table.tone,
      syllables: table.syllables,
      driftNotes: table.driftNotes,
      forms: table.forms.map((form) => ({
        id: `${slug}:${form.layer}`,
        layer: form.layer,
        language: form.language,
        form: form.form,
        stem: form.stem,
        syllables: form.syllables,
      })),
      candidates: table.curatedNames.map((name) => ({
        id: `${slug}:candidate:${name}`,
        name,
        stem: toStem(name),
      })),
    };
  });

  cached = {
    entries: labEntries,
    stats: {
      words: labEntries.length,
      forms: labEntries.reduce((count, entry) => count + entry.forms.length, 0),
      candidates: labEntries.reduce((count, entry) => count + entry.candidates.length, 0),
    },
  };
  return cached;
}
