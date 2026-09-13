"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  EMPTY_LAB_STATE,
  ERA_COLUMNS,
  LAB_STORAGE_KEY,
  formBrief,
  sanitizeLabState,
  type LabCorpus,
  type LabEntry,
  type LabState,
  type LabView,
} from "@/lib/etymology/lab";

interface EtymologyLabProps {
  corpus: LabCorpus;
}

const SUGGESTION_LIMIT = 8;

/** One matrix row: a root word with its era forms across the columns. Memoized
 * on the row's selected-id string so toggling one cell re-renders one row. */
const MatrixRow = memo(
  function MatrixRow({
    entry,
    selectedKey,
    onToggle,
    onToggleRow,
  }: {
    entry: LabEntry;
    selectedKey: string;
    onToggle: (id: string) => void;
    onToggleRow: (entry: LabEntry) => void;
  }) {
    const byLayer = useMemo(() => new Map(entry.forms.map((form) => [form.layer, form])), [entry]);
    const selectedIds = useMemo(() => new Set(selectedKey ? selectedKey.split(" ") : []), [selectedKey]);
    const rowComplete =
      entry.forms.every((form) => selectedIds.has(form.id))
      && entry.candidates.every((candidate) => selectedIds.has(candidate.id))
      && (entry.forms.length > 0 || entry.candidates.length > 0);

    return (
      <tr>
        <th scope="row" className="lab-matrix__word">
          <button
            type="button"
            className={rowComplete ? "lab-rowhead lab-rowhead--all" : "lab-rowhead"}
            onClick={() => onToggleRow(entry)}
            title="Select every variation of this word"
          >
            <span className="lab-rowhead__mark" aria-hidden="true">{rowComplete ? "✓" : "+"}</span>
            <span className="lab-rowhead__text">
              <strong>{entry.word}</strong>
              <span>{entry.semanticField}</span>
            </span>
          </button>
        </th>
        {ERA_COLUMNS.map((column) => {
          const form = byLayer.get(column.layer);
          if (!form) {
            return <td key={column.layer} className="lab-matrix__cell lab-matrix__cell--empty" />;
          }
          const isSelected = selectedIds.has(form.id);
          return (
            <td
              key={column.layer}
              className={isSelected ? "lab-matrix__cell lab-matrix__cell--selected" : "lab-matrix__cell"}
              onClick={() => onToggle(form.id)}
              title={`${column.title} · ${form.stem}`}
            >
              {form.form}
            </td>
          );
        })}
        <td className="lab-matrix__marks">
          <div className="lab-marks">
            {entry.candidates.map((candidate) => {
              const isSelected = selectedIds.has(candidate.id);
              return (
                <button
                  key={candidate.id}
                  type="button"
                  className={isSelected ? "lab-mark lab-mark--selected" : "lab-mark"}
                  onClick={() => onToggle(candidate.id)}
                  aria-pressed={isSelected}
                  title={candidate.stem}
                >
                  {candidate.name}
                </button>
              );
            })}
          </div>
        </td>
      </tr>
    );
  },
  (a, b) =>
    a.entry === b.entry
    && a.selectedKey === b.selectedKey
    && a.onToggle === b.onToggle
    && a.onToggleRow === b.onToggleRow,
);

interface PoolRow {
  id: string;
  entry: LabEntry;
  kind: "form" | "candidate";
  era: string;
  word: string;
  firstOfGroup: boolean;
}

export function EtymologyLab({ corpus }: EtymologyLabProps) {
  const [state, setState] = useState<LabState>(EMPTY_LAB_STATE);
  const [ready, setReady] = useState(false);
  const [search, setSearch] = useState("");
  const [activeSuggest, setActiveSuggest] = useState(0);

  // Picks, selections, notes, and the current view persist in this browser.
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    try {
      const saved = localStorage.getItem(LAB_STORAGE_KEY);
      if (saved) setState(sanitizeLabState(JSON.parse(saved), corpus));
    } catch {
      /* storage is a nicety */
    }
    setReady(true);
  }, [corpus]);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(LAB_STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* fine */
    }
  }, [state, ready]);

  const selectedSet = useMemo(() => new Set(state.selected), [state.selected]);
  const pickedSet = useMemo(() => new Set(state.picked), [state.picked]);

  const toggleSelected = useCallback((id: string) => {
    setState((cur) => ({
      ...cur,
      selected: cur.selected.includes(id)
        ? cur.selected.filter((s) => s !== id)
        : [...cur.selected, id],
    }));
  }, []);

  const toggleRowAll = useCallback((entry: LabEntry) => {
    setState((cur) => {
      const ids = [...entry.forms.map((form) => form.id), ...entry.candidates.map((c) => c.id)];
      const allSelected = ids.length > 0 && ids.every((id) => cur.selected.includes(id));
      return {
        ...cur,
        selected: allSelected
          ? cur.selected.filter((id) => !ids.includes(id))
          : [...new Set([...cur.selected, ...ids])],
      };
    });
  }, []);

  const addRoot = useCallback((slug: string) => {
    setState((cur) => (cur.picked.includes(slug) ? cur : { ...cur, picked: [...cur.picked, slug] }));
  }, []);

  const removeRoot = useCallback((slug: string) => {
    setState((cur) => ({ ...cur, picked: cur.picked.filter((s) => s !== slug) }));
  }, []);

  const setNote = useCallback((id: string, note: string) => {
    setState((cur) => ({ ...cur, notes: { ...cur.notes, [id]: note } }));
  }, []);

  const setView = useCallback((view: LabView) => {
    setState((cur) => ({ ...cur, view }));
  }, []);

  const pickedEntries = useMemo(
    () =>
      state.picked
        .map((slug) => corpus.entries.find((entry) => entry.slug === slug))
        .filter((entry): entry is LabEntry => Boolean(entry)),
    [state.picked, corpus],
  );

  // The multi-select suggestions: ranked matches, already-picked words removed.
  const suggestions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return [];
    const scored: Array<{ entry: LabEntry; score: number }> = [];
    for (const entry of corpus.entries) {
      if (pickedSet.has(entry.slug)) continue;
      const word = entry.word.toLowerCase();
      let score = -1;
      if (word === query) score = 0;
      else if (word.startsWith(query)) score = 1;
      else if (word.includes(query)) score = 2;
      else if (entry.semanticField.toLowerCase().includes(query)) score = 3;
      else if (entry.tone.toLowerCase().includes(query)) score = 4;
      else if (entry.forms.some((form) => form.stem.includes(query))) score = 5;
      else if (entry.candidates.some((c) => c.stem.includes(query))) score = 6;
      if (score >= 0) scored.push({ entry, score });
    }
    return scored
      .sort((a, b) => a.score - b.score || a.entry.word.localeCompare(b.entry.word))
      .slice(0, SUGGESTION_LIMIT)
      .map((hit) => hit.entry);
  }, [search, corpus, pickedSet]);

  useEffect(() => setActiveSuggest(0), [search]);

  const pickSuggestion = useCallback(
    (entry: LabEntry | undefined) => {
      if (!entry) return;
      addRoot(entry.slug);
      setSearch("");
    },
    [addRoot],
  );

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSuggest((i) => (suggestions.length ? (i + 1) % suggestions.length : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSuggest((i) => (suggestions.length ? (i - 1 + suggestions.length) % suggestions.length : 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      pickSuggestion(suggestions[activeSuggest] ?? suggestions[0]);
    } else if (event.key === "Escape") {
      setSearch("");
    }
  };

  // Matrix rows: the picked words, or every word when nothing is picked.
  const rows = useMemo(
    () => (pickedEntries.length ? pickedEntries : corpus.entries),
    [pickedEntries, corpus],
  );

  // Per-row selected-id strings keep MatrixRow memoization effective.
  const selectedKeys = useMemo(() => {
    const keys = new Map<string, string>();
    for (const entry of rows) {
      const ids = [
        ...entry.forms.map((form) => form.id),
        ...entry.candidates.map((candidate) => candidate.id),
      ].filter((id) => selectedSet.has(id));
      keys.set(entry.slug, ids.join(" "));
    }
    return keys;
  }, [rows, selectedSet]);

  // The curated pool: selected words grouped under their root word.
  const poolRows = useMemo<PoolRow[]>(() => {
    const grouped: PoolRow[] = [];
    for (const entry of corpus.entries) {
      const group: PoolRow[] = [];
      for (const form of entry.forms) {
        if (selectedSet.has(form.id)) {
          group.push({ id: form.id, entry, kind: "form", era: form.language, word: form.form, firstOfGroup: false });
        }
      }
      for (const candidate of entry.candidates) {
        if (selectedSet.has(candidate.id)) {
          group.push({
            id: candidate.id,
            entry,
            kind: "candidate",
            era: "Curated mark",
            word: candidate.name,
            firstOfGroup: false,
          });
        }
      }
      if (group.length) {
        group[0] = { ...group[0], firstOfGroup: true };
        grouped.push(...group);
      }
    }
    return grouped;
  }, [corpus, selectedSet]);

  // Selected-words sidebar chips.
  const chips = useMemo(
    () =>
      state.selected
        .map((id) => {
          const [slug, kind, rest] = id.split(":");
          const entry = corpus.entries.find((candidate) => candidate.slug === slug);
          if (!entry) return null;
          if (kind === "candidate") {
            const candidate = entry.candidates.find((c) => c.name === rest);
            return candidate ? { id, label: candidate.name, sub: `${entry.word} · mark` } : null;
          }
          const form = entry.forms.find((f) => f.layer === kind);
          return form ? { id, label: formBrief(form.form), sub: `${entry.word} · ${form.language}` } : null;
        })
        .filter((chip): chip is { id: string; label: string; sub: string } => Boolean(chip)),
    [state.selected, corpus],
  );

  return (
    <main className="app-shell lab">
      <header className="app-header">
        <a className="wordmark" href="/" aria-label="Etymalia home">
          etymalia
        </a>
        <div className="header-actions">
          <ThemeToggle />
        </div>
      </header>

      <div className="lab-top">
        <div className="lab-switch" role="group" aria-label="Table view">
          <button
            type="button"
            className={state.view === "all" ? "lab-switch__btn lab-switch__btn--active" : "lab-switch__btn"}
            aria-pressed={state.view === "all"}
            onClick={() => setView("all")}
          >
            All <span>{rows.length}</span>
          </button>
          <button
            type="button"
            className={state.view === "selected" ? "lab-switch__btn lab-switch__btn--active" : "lab-switch__btn"}
            aria-pressed={state.view === "selected"}
            onClick={() => setView("selected")}
          >
            Selected <span>{state.selected.length}</span>
          </button>
        </div>
      </div>

      <div className="lab-layout">
        <aside className="lab-side" aria-label="Word entry and selections">
          <section className="lab-panel">
            <span className="lab-panel__label">
              Words &amp; variations {pickedEntries.length ? <em>{pickedEntries.length}</em> : null}
            </span>
            {pickedEntries.length ? (
              <div className="lab-wv">
                {pickedEntries.map((entry) => (
                  <div key={entry.slug} className="lab-wv__group">
                    <div className="lab-wv__head">
                      <strong>{entry.word}</strong>
                      <button
                        type="button"
                        onClick={() => removeRoot(entry.slug)}
                        aria-label={`Remove ${entry.word}`}
                      >
                        ×
                      </button>
                    </div>
                    <div className="lab-wv__chips">
                      {entry.forms.map((form) => {
                        const isSelected = selectedSet.has(form.id);
                        return (
                          <button
                            key={form.id}
                            type="button"
                            className={isSelected ? "lab-wv__chip lab-wv__chip--selected" : "lab-wv__chip"}
                            onClick={() => toggleSelected(form.id)}
                            aria-pressed={isSelected}
                            title={`${form.language} · ${form.form}`}
                          >
                            {formBrief(form.form)}
                          </button>
                        );
                      })}
                      {entry.candidates.map((candidate) => {
                        const isSelected = selectedSet.has(candidate.id);
                        return (
                          <button
                            key={candidate.id}
                            type="button"
                            className={isSelected ? "lab-wv__chip lab-wv__chip--selected" : "lab-wv__chip"}
                            onClick={() => toggleSelected(candidate.id)}
                            aria-pressed={isSelected}
                            title={`Curated mark · ${candidate.stem}`}
                          >
                            {candidate.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="lab-side__hint">No words picked.</p>
            )}
          </section>

          <section className="lab-panel">
            <span className="lab-panel__label">
              Selected words {state.selected.length ? <em>{state.selected.length}</em> : null}
            </span>
            {chips.length ? (
              <ul className="studio-tray" aria-label="Selected words">
                {chips.map((chip) => (
                  <li key={chip.id} title={chip.sub}>
                    <button type="button" onClick={() => toggleSelected(chip.id)} aria-label={`Remove ${chip.label}`}>
                      {chip.label}
                      <span aria-hidden="true">×</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="lab-side__hint">None.</p>
            )}
          </section>

          <section className="lab-panel">
            <label className="lab-panel__label" htmlFor="lab-word-search">
              Enter word
            </label>
            <div className="lab-enter">
              <input
                id="lab-word-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={onSearchKeyDown}
                placeholder="Search root words…"
                autoComplete="off"
              />
              {search.trim() && suggestions.length ? (
                <ul className="lab-suggest" role="listbox" aria-label="Matching root words">
                  {suggestions.map((entry, index) => (
                    <li key={entry.slug}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={index === activeSuggest}
                        className={index === activeSuggest ? "lab-suggest__item lab-suggest__item--active" : "lab-suggest__item"}
                        onClick={() => pickSuggestion(entry)}
                      >
                        <strong>{entry.word}</strong>
                        <span>{entry.semanticField}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : search.trim() ? (
                <p className="lab-suggest__empty">No match.</p>
              ) : null}
            </div>
            {pickedEntries.length ? (
              <button
                type="button"
                className="lab-side__clear"
                onClick={() => setState((cur) => ({ ...cur, picked: [] }))}
              >
                Clear picked words
              </button>
            ) : null}
          </section>
        </aside>

        {state.view === "all" ? (
          <section className="lab-main" aria-label="All words and variations">
            <div className="lab-matrix-wrap">
              <table className="lab-matrix">
                <caption className="sr-only">Root words across language eras</caption>
                <thead>
                  <tr>
                    <th scope="col">Root</th>
                    {ERA_COLUMNS.map((column) => (
                      <th key={column.layer} scope="col" title={column.title}>
                        {column.label}
                      </th>
                    ))}
                    <th scope="col">Marks</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((entry) => (
                    <MatrixRow
                      key={entry.slug}
                      entry={entry}
                      selectedKey={selectedKeys.get(entry.slug) ?? ""}
                      onToggle={toggleSelected}
                      onToggleRow={toggleRowAll}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <section className="lab-main" aria-label="Selected words and notes">
            {poolRows.length ? (
              <div className="lab-pool-wrap">
                <table className="lab-pool">
                  <caption className="sr-only">Selected words with notes</caption>
                  <thead>
                    <tr>
                      <th scope="col">Root</th>
                      <th scope="col">Era</th>
                      <th scope="col">Word</th>
                      <th scope="col">Variations</th>
                      <th scope="col" className="lab-pool__notes-col">Notes</th>
                      <th scope="col"><span className="sr-only">Remove</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {poolRows.map((row) => {
                      const variations = row.entry.forms.filter((form) => form.id !== row.id);
                      return (
                        <tr key={row.id} className={row.firstOfGroup ? "lab-pool__group" : undefined}>
                          <td className="lab-pool__root">
                            {row.firstOfGroup ? (
                              <>
                                <strong>{row.entry.word}</strong>
                                <span>{row.entry.semanticField}</span>
                              </>
                            ) : null}
                          </td>
                          <td>{row.era}</td>
                          <td className="lab-pool__word">{row.word}</td>
                          <td className="lab-pool__vars">
                            {variations.length ? (
                              variations.map((form) => (
                                <span key={form.id} className="lab-var" title={form.form}>
                                  {formBrief(form.form)}
                                </span>
                              ))
                            ) : (
                              <span className="lab-pool__none">—</span>
                            )}
                          </td>
                          <td className="lab-pool__notes">
                            <input
                              type="text"
                              value={state.notes[row.id] ?? ""}
                              onChange={(e) => setNote(row.id, e.target.value)}
                              aria-label={`Notes for ${row.word}`}
                            />
                          </td>
                          <td className="lab-pool__remove">
                            <button
                              type="button"
                              onClick={() => toggleSelected(row.id)}
                              aria-label={`Remove ${row.word}`}
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="lab-pool__empty">Nothing selected yet.</p>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
