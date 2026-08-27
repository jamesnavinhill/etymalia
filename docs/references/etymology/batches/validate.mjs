// Validates the four batch files against the existing corpus. Usage:
//   node docs/references/etymology/batches/validate.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const slug = (value) => (value ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z]/g, "");

const corpus = JSON.parse(readFileSync(resolve(here, "../../../../packages/name-engine/src/corpus.json"), "utf8"));
const existing = new Set(corpus.entries.map((e) => slug(e.word)));

const ALLOWED_LAYERS = new Set([
  "pie", "protoGermanic", "oldEnglish", "oldNorse", "middleEnglish",
  "classicalLatin", "vulgarLatin", "ancientGreek", "oldFrench",
  "sanskrit", "arabic", "persian", "hebrew", "celtic",
]);

const reports = {};
const globalSeen = new Set();

for (const name of ["essence", "virtue", "harvest", "lux"]) {
  const arr = JSON.parse(readFileSync(resolve(here, `${name}.json`), "utf8"));
  const issues = [];
  const dupes = [];
  const localDupes = [];
  const crossDupes = [];
  const seen = new Set();
  let layerSum = 0;
  for (const e of arr) {
    const key = slug(e.word);
    if (existing.has(key)) dupes.push(e.word);
    if (seen.has(key)) localDupes.push(e.word);
    if (globalSeen.has(key)) crossDupes.push(e.word);
    seen.add(key);
    globalSeen.add(key);
    for (const k of Object.keys(e.layers ?? {})) {
      if (!ALLOWED_LAYERS.has(k)) issues.push(`${e.word}.badlayer:${k}`);
    }
    if (!e.semanticField) issues.push(`${e.word}.nofield`);
    if (!e.driftNotes) issues.push(`${e.word}.nodrift`);
    if (typeof e.syllables !== "number" || e.syllables < 1) issues.push(`${e.word}.nosyl`);
    if (!e.tone) issues.push(`${e.word}.notone`);
    if (!Array.isArray(e.candidates)) issues.push(`${e.word}.nocand`);
    if (Object.keys(e.layers ?? {}).length < 2) issues.push(`${e.word}.thinlayers`);
    layerSum += Object.keys(e.layers ?? {}).length;
  }
  reports[name] = {
    count: arr.length,
    dupesVsExisting270: dupes,
    localDupes,
    crossBatchDupes: crossDupes,
    issueCount: issues.length,
    issues: issues.slice(0, 25),
    avgLayers: (layerSum / arr.length).toFixed(2),
  };
}
writeFileSync(resolve(here, "validation-report.json"), JSON.stringify(reports, null, 2));
console.log(JSON.stringify(reports, null, 2));
