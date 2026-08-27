import { describe, expect, it } from "vitest";
import {
  etymologyTables,
  headPiecesFor,
  previewSplice,
  suggestHybrids,
  tailPiecesFor,
} from "./mix";

describe("etymologyTables", () => {
  it("returns the complete table for corpus words, in requested order", () => {
    const tables = etymologyTables(["Abundance", "Alchemical"]);

    expect(tables).toHaveLength(2);
    const [abundance] = tables;
    expect(abundance.word).toBe("Abundance");
    expect(abundance.semanticField).toBe("Plenty / Overflow");
    expect(abundance.driftNotes.length).toBeGreaterThan(5);
    // Every populated language cell shows up as a form with a stem.
    expect(abundance.forms.length).toBeGreaterThan(4);
    for (const form of abundance.forms) {
      expect(form.form.length).toBeGreaterThan(1);
      expect(form.language.length).toBeGreaterThan(2);
      expect(form.stem.length).toBeGreaterThan(2);
    }
    expect(abundance.curatedNames.length).toBeGreaterThan(0);
  });

  it("omits words that are not actually in the corpus", () => {
    const tables = etymologyTables(["Notaword", "Abundance"]);
    expect(tables.map((table) => table.word)).toEqual(["Abundance"]);
  });

  it("matches selections case-insensitively", () => {
    expect(etymologyTables(["abundance"])).toHaveLength(1);
  });
});

describe("blend pieces", () => {
  it("exposes head and tail pieces across era forms for a chosen word", () => {
    const heads = headPiecesFor("Abundance", ["classicalLatin", "oldFrench"]);
    const tails = tailPiecesFor("Abundance", ["classicalLatin", "oldFrench"]);

    expect(heads.length).toBeGreaterThan(1);
    expect(tails.length).toBeGreaterThan(1);
    // Head parts carry at least a full stem and an onset for each era form.
    const latins = heads.filter((piece) => piece.language === "Latin");
    expect(latins.some((piece) => piece.partOf === "full")).toBe(true);
    expect(latins.some((piece) => piece.partOf === "onset")).toBe(true);
    // Every piece links back to its source meaning so the note makes sense.
    for (const piece of heads) {
      expect(piece.word).toBe("Abundance");
      expect(piece.gloss.length).toBeGreaterThan(3);
      expect(piece.form.length).toBeGreaterThan(1);
    }
  });

  it("shortens long stems into onset and opening heads", () => {
    const heads = headPiecesFor("Abundance", ["oldFrench"]);
    const full = heads.find((piece) => piece.partOf === "full");
    const onset = heads.find((piece) => piece.partOf === "onset");
    expect(full).toBeDefined();
    expect(onset).toBeDefined();
    expect(onset!.value.length).toBeLessThan(full!.value.length);
    expect(full!.value.startsWith(onset!.value)).toBe(true);
  });
});

describe("suggestHybrids", () => {
  it("produces deterministic portmanteaus with full provenance", () => {
    const suggestions = suggestHybrids(["Abundance", "Alchemical"], {
      layers: ["classicalLatin", "oldFrench"],
      count: 40,
      maxSyllables: 6,
    });

    expect(suggestions.length).toBeGreaterThan(3);
    expect(suggestions).toEqual(suggestHybrids(["Abundance", "Alchemical"], {
      layers: ["classicalLatin", "oldFrench"],
      count: 40,
      maxSyllables: 6,
    }));
    for (const suggestion of suggestions) {
      expect(suggestion.slug.length).toBeGreaterThanOrEqual(3);
      expect(suggestion.slug.length).toBeLessThanOrEqual(14);
      expect(suggestion.left.gloss.length).toBeGreaterThan(2);
      expect(suggestion.right.form.length).toBeGreaterThan(1);
      expect(suggestion.note.length).toBeGreaterThan(10);
      expect(["portmanteau", "compound", "suffixation"]).toContain(suggestion.strategy);
    }
  });

  it("bounds syllables and never suggests a bare source word", () => {
    const suggestions = suggestHybrids(["Apex", "Aegis"], { count: 60, maxSyllables: 4 });
    for (const suggestion of suggestions) {
      expect(suggestion.syllables).toBeLessThanOrEqual(4);
      expect(["apex", "aegis"]).not.toContain(suggestion.slug);
    }
  });

  it("returns an empty set with fewer than two words and no suffix family", () => {
    expect(suggestHybrids(["Abundance"])).toEqual([]);
    expect(suggestHybrids([])).toEqual([]);
  });

  it("can suffix a single word when a suffix family is chosen", () => {
    const suggestions = suggestHybrids(["Apex"], {
      suffixFamily: "latin",
      layers: ["classicalLatin"],
      count: 12,
    });
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.every((suggestion) => suggestion.strategy === "suffixation")).toBe(true);
  });

  it("drops excluded results", () => {
    const all = suggestHybrids(["Abundance", "Aegis"], { layers: ["oldFrench"], count: 60 });
    const [first] = all;
    const filtered = suggestHybrids(["Abundance", "Aegis"], {
      layers: ["oldFrench"],
      count: 60,
      exclusions: [first.slug],
    });
    expect(filtered.some((suggestion) => suggestion.slug === first.slug)).toBe(false);
  });
});

describe("previewSplice", () => {
  it("reconstructs exactly the splice a user shaped", () => {
    const heads = headPiecesFor("Abundance", ["classicalLatin"]);
    const tails = tailPiecesFor("Abundance", ["classicalLatin"]);
    const head = heads.find((piece) => piece.partOf === "onset") ?? heads[0];
    const tail = tails.find((piece) => piece.partOf === "rhyme") ?? tails[0];
    const preview = previewSplice(head, tail);

    expect(preview).not.toBeNull();
    expect(preview!.slug.startsWith(head.value.slice(0, 1))).toBe(true);
    expect(preview!.slug.endsWith(tail.value.slice(-1))).toBe(true);
    expect(preview!.left.piece).toBe(head.value);
    expect(preview!.right.piece).toBe(tail.value);
    expect(preview!.note).toContain(head.form);
    expect(preview!.note).toContain(tail.form);
  });

  it("rejects splices that grow past brandable bounds", () => {
    const fake = {
      value: "supercalifragilisticexpialidocious",
      word: "Test",
      gloss: "Testing",
      partOf: "full",
      lexicalId: "test:x",
    } as never;
    const head = headPiecesFor("Abundance", ["classicalLatin"])[0];
    expect(previewSplice(head, fake)).toBeNull();
  });
});
