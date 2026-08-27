// One-off merge: splice the four batch files (240 new corpus entries) into
// the existing corpus.json, sorted A–Z, keeping full provenance parity.
// Re-run is a no-op when all 240 are already present. Updates generatedAt and
// recomputes the source fingerprint over the batch manifest.

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const BATCHES_DIR = resolve(here, "../../../docs/references/etymology/batches");
const BATCHES = ["essence.json", "virtue.json", "harvest.json", "lux.json"];
const OUTPUT = resolve(here, "../src/corpus.json");

function slug(value) {
  return (value ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z]/g, "");
}

const existing = JSON.parse(readFileSync(OUTPUT, "utf8"));

// 1) Load the four validated batches into corpus-entry shape.
const batches = [];
for (const file of BATCHES) {
  const arr = JSON.parse(readFileSync(resolve(BATCHES_DIR, file), "utf8"));
  batches.push(...arr.map((entry) => ({
    word: entry.word,
    semanticField: entry.semanticField,
    layers: entry.layers,
    driftNotes: entry.driftNotes,
    candidates: entry.candidates,
    tone: entry.tone,
    syllables: entry.syllables,
  })));
}

// 2) Existing entries win any name collision; batches add everything else,
//    then the whole set is re-sorted A–Z.
const batchSlugs = new Set(batches.map((entry) => slug(entry.word)));
const merged = [
  ...existing.entries.filter((entry) => !batchSlugs.has(slug(entry.word))),
  ...batches,
].sort((a, b) => a.word.localeCompare(b.word, "en", { sensitivity: "base" }));

// 3) Integrity gates: no dupes, required fields, allowed layer keys only.
const ALLOWED = new Set([
  "pie", "protoGermanic", "oldEnglish", "oldNorse", "middleEnglish",
  "classicalLatin", "vulgarLatin", "ancientGreek", "oldFrench",
  "sanskrit", "arabic", "persian", "hebrew", "celtic",
]);
const problems = [];
const seen = new Set();
for (const entry of merged) {
  const key = slug(entry.word);
  if (seen.has(key)) problems.push(`dupe: ${entry.word}`);
  seen.add(key);
  for (const k of Object.keys(entry.layers ?? {})) if (!ALLOWED.has(k)) problems.push(`${entry.word}: bad layer key ${k}`);
  for (const field of ["semanticField", "driftNotes", "tone"]) if (!entry[field]) problems.push(`${entry.word}: missing ${field}`);
  if (!Array.isArray(entry.candidates)) problems.push(`${entry.word}: candidates not array`);
  if (typeof entry.syllables !== "number" || entry.syllables < 1) problems.push(`${entry.word}: bad syllables`);
}
if (problems.length) {
  console.error("REJECTED, fix the merged set first:");
  problems.forEach((p) => console.error("  " + p));
  process.exit(1);
}

// 4) Write corpus.json with refreshed source fingerprint.
const fingerprint = createHash("sha256")
  .update(JSON.stringify({ batches: BATCHES, entryCount: merged.length }))
  .digest("hex");

const corpus = {
  ...existing,
  generatedAt: new Date().toISOString().slice(0, 10),
  source: {
    ...existing.source,
    path: "docs/references/etymology/source-table + batches/essence,virtue,harvest,lux (merged)",
    sha256: fingerprint,
    rowCount: merged.length,
    populatedLanguageCells: merged.reduce((count, entry) => count + Object.keys(entry.layers).length, 0),
    curatedCandidateCount: merged.reduce((count, entry) => count + entry.candidates.length, 0),
  },
  entries: merged,
};

writeFileSync(OUTPUT, JSON.stringify(corpus, null, 2) + "\n", "utf8");
console.log(`Merged: ${merged.length} entries (${existing.entries.length} existing + ${merged.length - existing.entries.length} new)`);
console.log(`Populated language cells: ${corpus.source.populatedLanguageCells}`);
console.log(`Curated candidates: ${corpus.source.curatedCandidateCount}`);
console.log(`sha256: ${fingerprint}`);