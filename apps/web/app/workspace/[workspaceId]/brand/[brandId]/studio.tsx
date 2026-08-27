"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DomainAvailability } from "@etymalia/availability";
import type { NameProvenance, NameScores } from "@etymalia/name-engine";
import type {
  StudioHybridView,
  StudioPieceView,
  StudioTableView,
  StudioWordSummary,
} from "@/lib/brand/studio";
import { MIX_LAYER_OPTIONS, type MixLayer } from "@/lib/brand/studio";

export interface StudioBoardCandidate {
  id: string;
  term: string;
  provenance: NameProvenance;
  scores: NameScores;
  availability: DomainAvailability[];
  isShortlisted: boolean;
}

interface NameStudioProps {
  workspaceId: string;
  brandId: string;
  brandName: string;
  canEdit: boolean;
  catalogue: StudioWordSummary[];
  candidates: StudioBoardCandidate[];
  addManualName: (formData: FormData) => Promise<void>;
  removeName: (formData: FormData) => Promise<void>;
  toggleShortlist: (formData: FormData) => Promise<void>;
  checkNameDomains: (formData: FormData) => Promise<void>;
  useName: (formData: FormData) => Promise<void>;
  fetchTables: (slugs: string[]) => Promise<StudioTableView[]>;
  fetchPieces: (words: string[], layers: MixLayer[]) => Promise<{ heads: StudioPieceView[]; tails: StudioPieceView[] }>;
  fetchSuggestions: (words: string[], layers: MixLayer[]) => Promise<StudioHybridView[]>;
}

const MAX_PICK = 6;
const DEFAULT_LAYERS: MixLayer[] = ["classicalLatin", "ancientGreek", "oldFrench"];

const PART_LABEL: Record<string, string> = {
  full: "whole form",
  onset: "onset",
  opening: "opening half",
  rhyme: "rhyme",
  ending: "ending",
};

function pieceKey(piece: StudioPieceView): string {
  return `${piece.lexicalId}|${piece.value}|${piece.partOf}`;
}

function healSeam(left: string, right: string): string {
  let joined = left + right;
  if (left.length && right.length && left[left.length - 1] === right[0]) {
    joined = left + right.slice(1);
  }
  return joined.replace(/([^aeiouy])\1*([^aeiouy])([^aeiouy])/g, "$1$2$3");
}

function titleCase(slug: string): string {
  return slug ? slug[0].toUpperCase() + slug.slice(1) : slug;
}

function baseScores(syllables: number, pronounceability: number): NameScores {
  const brevity = syllables >= 2 && syllables <= 3 ? 0.85 : 0.65;
  const composite = Math.round((pronounceability * 0.5 + brevity * 0.5) * 100) / 100;
  return { meaningFit: 0.6, pronounceability, brevity, distinctiveness: 0.92, composite };
}

export function NameStudio(props: NameStudioProps) {
  const {
    workspaceId, brandId, brandName, canEdit,
    catalogue, candidates,
    addManualName, removeName, toggleShortlist, checkNameDomains, useName,
    fetchTables, fetchPieces, fetchSuggestions,
  } = props;

  const [picked, setPicked] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [layers, setLayers] = useState<MixLayer[]>(DEFAULT_LAYERS);
  const [leftKey, setLeftKey] = useState("");
  const [rightKey, setRightKey] = useState("");
  const [boardFilter, setBoardFilter] = useState("");
  const [listOpen, setListOpen] = useState(false);

  const [tables, setTables] = useState<StudioTableView[]>([]);
  const [heads, setHeads] = useState<StudioPieceView[]>([]);
  const [tails, setTails] = useState<StudioPieceView[]>([]);
  const [suggestions, setSuggestions] = useState<StudioHybridView[]>([]);
  const [busy, setBusy] = useState(false);

  // --- Primo touches --------------------------------------------------------
  // Session persistence per brand (picks + mixing eras survive navigation),
  // a deterministic Surprise-me starter pair, and a picked-words NEW badge
  // sourced from a static expansion manifest the corpus build emits.
  const STORAGE_KEY = useMemo(() => `etymalia-name-studio:${brandId}`, [brandId]);
  const hydrated = useRef(false);

  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as { picked?: string[]; layers?: MixLayer[] };
        if (Array.isArray(parsed.picked)) setPicked(parsed.picked.slice(0, MAX_PICK));
        if (Array.isArray(parsed.layers) && parsed.layers.length) setLayers(parsed.layers as MixLayer[]);
      }
    } catch { /* storage is a nicety */ }
  }, [STORAGE_KEY]);

  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ picked, layers })); } catch { /* fine */ }
  }, [picked, layers, STORAGE_KEY]);

  const pickedWords = useMemo(
    () => picked.map((slug) => catalogue.find((word) => word.slug === slug)).filter((w): w is StudioWordSummary => Boolean(w)),
    [picked, catalogue],
  );

  const filteredCatalogue = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return catalogue;
    return catalogue.filter((w) =>
      w.word.toLowerCase().includes(query)
      || w.semanticField.toLowerCase().includes(query)
      || w.tone.toLowerCase().includes(query),
    );
  }, [catalogue, search]);

  // A deterministic starter pair, derived once the search catalog is ready.
  const surprisePair = useMemo<[string, string] | null>(() => {
    const pool = filteredCatalogue.length ? filteredCatalogue : catalogue;
    if (pool.length < 2) return null;
    let hash = 0;
    const seed = search.trim() || "spark";
    for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
    const a = pool[Math.abs(hash) % pool.length];
    const b = pool[Math.abs(hash * 7 + 1) % pool.length];
    return a.slug === b.slug ? null : [a.slug, b.slug];
  }, [filteredCatalogue, catalogue, search]);

  const surprise = () => {
    if (!surprisePair) return;
    setPicked(surprisePair);
    setLeftKey("");
    setRightKey("");
    setSuggestions([]);
    setListOpen(false);
  };

  // Fetch etymology tables whenever the picks change.
  useEffect(() => {
    if (!picked.length) {
      setTables([]);
      return;
    }
    let live = true;
    void fetchTables(picked).then((result) => {
      if (live) setTables(result);
    });
    return () => { live = false; };
  }, [picked, fetchTables]);

  // Fetch blend pieces whenever picks or mix layers change (needs 2+ words).
  useEffect(() => {
    if (pickedWords.length < 2) {
      setHeads([]);
      setTails([]);
      return;
    }
    let live = true;
    void fetchPieces(pickedWords.map((w) => w.word), layers).then((result) => {
      if (live) {
        setHeads(result.heads);
        setTails(result.tails);
      }
    });
    return () => { live = false; };
  }, [pickedWords, layers, fetchPieces]);

  const leftPiece = useMemo(
    () => heads.find((p) => pieceKey(p) === leftKey) ?? null,
    [heads, leftKey],
  );
  const rightPiece = useMemo(
    () => tails.find((p) => pieceKey(p) === rightKey) ?? null,
    [tails, rightKey],
  );

  const preview = useMemo(() => {
    if (!leftPiece || !rightPiece) return null;
    const slug = healSeam(leftPiece.value, rightPiece.value);
    if (slug.length < 3 || slug.length > 14) return null;
    return {
      term: titleCase(slug),
      note: `${leftPiece.value} of ${leftPiece.language} ${leftPiece.form} '${leftPiece.gloss.toLowerCase()}' + ${rightPiece.value} of ${rightPiece.language} ${rightPiece.form} '${rightPiece.gloss.toLowerCase()}'.`,
    };
  }, [leftPiece, rightPiece]);

  const boardCandidates = useMemo(() => {
    const query = boardFilter.trim().toLowerCase();
    const list = query ? candidates.filter((c) => c.term.toLowerCase().includes(query)) : candidates;
    return [...list].sort((a, b) => {
      if (a.isShortlisted !== b.isShortlisted) return a.isShortlisted ? -1 : 1;
      return (b.scores?.composite ?? 0) - (a.scores?.composite ?? 0);
    });
  }, [candidates, boardFilter]);

  const togglePick = (slug: string) => {
    setPicked((cur) => (cur.includes(slug) ? cur.filter((s) => s !== slug) : cur.length < MAX_PICK ? [...cur, slug] : cur));
    setLeftKey("");
    setRightKey("");
    setSuggestions([]);
  };

  const toggleLayer = (layer: MixLayer) =>
    setLayers((cur) =>
      cur.includes(layer) ? (cur.length > 1 ? cur.filter((l) => l !== layer) : cur) : [...cur, layer],
    );

  const runSuggestions = () => {
    if (pickedWords.length < 2) return;
    setBusy(true);
    void fetchSuggestions(pickedWords.map((w) => w.word), layers)
      .then(setSuggestions)
      .finally(() => setBusy(false));
  };
  const submitCandidate = (term: string, provenance: NameProvenance, scores: NameScores) => {
    if (!canEdit) return;
    const fd = new FormData();
    fd.set("workspaceId", workspaceId);
    fd.set("brandId", brandId);
    fd.set("term", term);
    fd.set("provenance", JSON.stringify({ provenance, scores }));
    void addManualName(fd);
  };

  const addPreview = () => {
    if (!leftPiece || !rightPiece || !preview) return;
    submitCandidate(
      preview.term,
      {
        strategy: "portmanteau",
        roots: [
          { language: leftPiece.language, form: leftPiece.form, gloss: leftPiece.gloss },
          { language: rightPiece.language, form: rightPiece.form, gloss: rightPiece.gloss },
        ],
        note: preview.note,
        sources: Array.from(new Set([leftPiece.word, rightPiece.word])),
      },
      baseScores(leftPiece.syllables + rightPiece.syllables, 0.8),
    );
    setLeftKey("");
    setRightKey("");
  };

  const addSuggestion = (s: StudioHybridView) =>
    submitCandidate(
      s.term,
      {
        strategy: s.strategy,
        roots: [
          { language: s.left.language, form: s.left.form, gloss: s.left.gloss },
          { language: s.right.language, form: s.right.form, gloss: s.right.gloss },
        ],
        note: s.note,
        sources: Array.from(new Set([s.left.word, s.right.word])),
      },
      baseScores(s.syllables, s.pronounceability),
    );

  const boardSlugs = useMemo(
    () => new Set(candidates.map((candidate) => candidate.term.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, ""))),
    [candidates],
  );

  const freshSuggestions = useMemo(
    () => suggestions.filter((suggestion) => !boardSlugs.has(suggestion.slug)),
    [suggestions, boardSlugs],
  );

  return (
    <div className="studio">
      <section className="studio-panel" aria-labelledby="studio-explorer-heading">
        <div className="studio-panel__head">
          <div>
            <h3 id="studio-explorer-heading">Word explorer</h3>
            <p className="studio-panel__lede">
              Start with base English words. Each pick opens its complete etymology table below — every era, every form, and the meaning that comes with it.
            </p>
          </div>
          <button type="button" className="button button--ghost" onClick={surprise}>
            Surprise me
          </button>
        </div>

        <div className="studio-search">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search the source table — a word, a meaning, a tone…"
            aria-label="Search base words"
          />
          <span className="studio-search__meta">{picked.length} of {MAX_PICK} picked</span>
        </div>

        {picked.length ? (
          <ul className="studio-tray" aria-label="Picked words">
            {pickedWords.map((w) => (
              <li key={w.slug}>
                <button type="button" onClick={() => togglePick(w.slug)} aria-label={`Remove ${w.word}`}>
                  {w.word}<span aria-hidden="true">×</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <button type="button" className="studio-list-toggle" onClick={() => setListOpen((o) => !o)} aria-expanded={listOpen}>
          {listOpen ? "Hide the word list" : `Show the word list (${catalogue.length} words)`}
        </button>

        {listOpen ? (
          <ul className="word-picker">
            {filteredCatalogue.map((word) => {
              const isPicked = picked.includes(word.slug);
              const isFull = picked.length >= MAX_PICK && !isPicked;
              return (
                <li key={word.slug}>
                  <button
                    type="button"
                    className={isPicked ? "word-pill word-pill--picked" : "word-pill"}
                    onClick={() => togglePick(word.slug)}
                    disabled={isFull}
                    aria-pressed={isPicked}
                  >
                    <strong>{word.word}</strong>
                    <span>{word.semanticField}</span>
                  </button>
                </li>
              );
            })}
            {!filteredCatalogue.length ? <li className="word-picker__empty">No words match that search.</li> : null}
          </ul>
        ) : null}
      </section>

      {tables.length ? (
        <section className="studio-panel" aria-labelledby="studio-tables-heading">
          <div className="studio-panel__head">
            <div>
              <h3 id="studio-tables-heading">Etymology tables</h3>
              <p className="studio-panel__lede">The full table for each picked word. Add the word itself or a curated starter straight to the board.</p>
            </div>
          </div>
          <div className="ety-tables">
            {tables.map((table) => {
              const summary = catalogue.find((w) => w.slug === table.slug);
              return (
                <article className="ety-card" key={table.slug}>
                  <header className="ety-card__head">
                    <div>
                      <h3>{table.word}</h3>
                      <p>{table.semanticField}</p>
                    </div>
                    {summary ? (
                      <button
                        type="button"
                        className="chip-button"
                        disabled={!canEdit}
                        onClick={() =>
                          submitCandidate(
                            table.word,
                            {
                              strategy: "curated",
                              roots: [{ language: "Modern English", form: table.word, gloss: table.semanticField }],
                              note: `The base word ${table.word} '${table.semanticField.toLowerCase()}', kept whole.`,
                              sources: [table.word],
                            },
                            baseScores(table.syllables ?? 2, 0.75),
                          )
                        }
                      >
                        Add base word
                      </button>
                    ) : null}
                  </header>

                  <dl className="ety-card__meta">
                    {table.tone ? <div><dt>Tone</dt><dd>{table.tone}</dd></div> : null}
                    {table.syllables != null ? <div><dt>Syllables</dt><dd>{table.syllables}</dd></div> : null}
                  </dl>

                  {table.driftNotes ? <p className="ety-card__drift">{table.driftNotes}</p> : null}

                  <div className="ety-card__table-wrap">
                    <table className="ety-card__table">
                      <caption className="sr-only">Forms of {table.word} across language eras</caption>
                      <tbody>
                        {table.forms.map((form) => (
                          <tr key={form.layer}>
                            <th scope="row">{form.language}</th>
                            <td>{form.form}</td>
                            <td><code>{form.stem}</code></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {table.curatedNames.length ? (
                    <div className="ety-card__curated">
                      <span>Curated starters</span>
                      <div>
                        {table.curatedNames.map((name) => (
                          <button
                            key={name}
                            type="button"
                            className="chip-button"
                            disabled={!canEdit || !summary}
                            onClick={() =>
                              summary &&
                              submitCandidate(
                                titleCase(name.toLowerCase()),
                                {
                                  strategy: "curated",
                                  roots: [{ language: "Modern English", form: summary.word, gloss: summary.semanticField }],
                                  note: `A curated mark drawn from ${summary.word} '${summary.semanticField.toLowerCase()}'.`,
                                  sources: [summary.word],
                                },
                                baseScores(summary.syllables ?? 2, 0.75),
                              )
                            }
                          >
                            {name}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {pickedWords.length >= 2 ? (
        <section className="studio-panel" aria-labelledby="studio-mix-heading">
          <div className="studio-panel__head">
            <div>
              <h3 id="studio-mix-heading">Mix lab</h3>
              <p className="studio-panel__lede">
                Take the opening of one form and the ending of another. Every piece keeps its source meaning, so a candidate always knows where it came from.
              </p>
            </div>
            <button type="button" className="button button--ghost" onClick={runSuggestions} disabled={busy}>
              {busy ? "Mixing…" : "Suggest hybrids"}
            </button>
          </div>

          <div className="mix-controls">
            <fieldset>
              <legend>Mixing eras</legend>
              {MIX_LAYER_OPTIONS.map((option) => (
                <label key={option.value}>
                  <input type="checkbox" checked={layers.includes(option.value)} onChange={() => toggleLayer(option.value)} />
                  {option.label}
                </label>
              ))}
            </fieldset>
          </div>

          <div className="mix-splice">
            <div className="mix-column">
              <span className="mix-column__label">Opening of…</span>
              <div className="mix-stack" role="listbox" aria-label="Opening pieces">
                {heads.length ? heads.map((piece) => {
                  const key = pieceKey(piece);
                  const selected = leftKey === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      className={selected ? "mix-piece mix-piece--selected" : "mix-piece"}
                      onClick={() => setLeftKey(selected ? "" : key)}
                      aria-pressed={selected}
                    >
                      <strong>{piece.value}</strong>
                      <span>{piece.word} · {piece.language} · {PART_LABEL[piece.partOf] ?? piece.partOf}</span>
                    </button>
                  );
                }) : <p className="studio__hint">Loading pieces…</p>}
              </div>
            </div>
            <div className="mix-column">
              <span className="mix-column__label">Ending of…</span>
              <div className="mix-stack" role="listbox" aria-label="Ending pieces">
                {tails.length ? tails.map((piece) => {
                  const key = pieceKey(piece);
                  const selected = rightKey === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      className={selected ? "mix-piece mix-piece--selected" : "mix-piece"}
                      onClick={() => setRightKey(selected ? "" : key)}
                      aria-pressed={selected}
                    >
                      <strong>{piece.value}</strong>
                      <span>{piece.word} · {piece.language} · {PART_LABEL[piece.partOf] ?? piece.partOf}</span>
                    </button>
                  );
                }) : <p className="studio__hint">Loading pieces…</p>}
              </div>
            </div>
          </div>

          <div className="mix-preview" aria-live="polite">
            <div>
              <span className="mix-preview__label">Your splice</span>
              <strong className="mix-preview__term">{preview ? preview.term : "Pick an opening and an ending"}</strong>
              {preview ? <p>{preview.note}</p> : null}
            </div>
            <button type="button" className="button button--primary" disabled={!preview || !canEdit} onClick={addPreview}>
              Add to board
            </button>
          </div>

          {freshSuggestions.length ? (
            <div className="mix-suggestions">
              <h4>Suggested hybrids <span>{freshSuggestions.length}</span></h4>
              <ul>
                {freshSuggestions.map((suggestion) => (
                  <li key={suggestion.slug}>
                    <button type="button" className="mix-suggestion" disabled={!canEdit} onClick={() => addSuggestion(suggestion)}>
                      <span className="mix-suggestion__head">
                        <strong>{suggestion.term}</strong>
                        <span>{suggestion.strategy} · {suggestion.syllables} syl</span>
                      </span>
                      <span className="mix-suggestion__note">{suggestion.note}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="studio-panel" aria-labelledby="studio-board-heading">
        <div className="studio-panel__head">
          <div>
            <h3 id="studio-board-heading">Your board</h3>
            <p className="studio-panel__lede">
              Every name you keep lands here with its etymology intact, so you always know what you are looking at. Check domains, shortlist, and pick the final name.
            </p>
          </div>
          <input
            type="search"
            value={boardFilter}
            onChange={(e) => setBoardFilter(e.target.value)}
            placeholder="Filter board…"
            aria-label="Filter board candidates"
          />
        </div>

        {boardCandidates.length ? (
          <ul className="board-list">
            {boardCandidates.map((candidate) => (
              <li key={candidate.id} className={candidate.term === brandName ? "board-card board-card--selected" : "board-card"}>
                <div className="board-card__head">
                  <h4>{candidate.term}</h4>
                  {candidate.scores?.composite ? <span className="board-card__score">{Math.round(candidate.scores.composite * 100)}</span> : null}
                </div>
                {candidate.provenance?.note ? <p className="board-card__note">{candidate.provenance.note}</p> : null}
                {candidate.provenance?.roots?.length ? (
                  <p className="board-card__roots">
                    {candidate.provenance.roots.map((root) => root.language).join(" · ")}
                    <span>{candidate.provenance.strategy}</span>
                  </p>
                ) : null}
                {candidate.availability.length ? (
                  <ul className="board-card__domains">
                    {candidate.availability.map((domain) => (
                      <li key={domain.domain} className={`domain domain--${domain.status}`}>
                        {domain.domain} <span>{domain.status}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="board-card__actions">
                  <form action={useName}>
                    <input type="hidden" name="workspaceId" value={workspaceId} />
                    <input type="hidden" name="brandId" value={brandId} />
                    <input type="hidden" name="term" value={candidate.term} />
                    <button className="chip-button" type="submit" disabled={!canEdit || candidate.term === brandName}>
                      {candidate.term === brandName ? "Selected" : "Use name"}
                    </button>
                  </form>
                  <form action={toggleShortlist}>
                    <input type="hidden" name="workspaceId" value={workspaceId} />
                    <input type="hidden" name="brandId" value={brandId} />
                    <input type="hidden" name="candidateId" value={candidate.id} />
                    <input type="hidden" name="shortlist" value={String(!candidate.isShortlisted)} />
                    <button className={candidate.isShortlisted ? "chip-button chip-button--active" : "chip-button"} type="submit" disabled={!canEdit}>
                      {candidate.isShortlisted ? "Shortlisted" : "Shortlist"}
                    </button>
                  </form>
                  <form action={checkNameDomains}>
                    <input type="hidden" name="workspaceId" value={workspaceId} />
                    <input type="hidden" name="brandId" value={brandId} />
                    <input type="hidden" name="candidateId" value={candidate.id} />
                    <button className="chip-button" type="submit" disabled={!canEdit}>
                      {candidate.availability.length ? "Re-check domains" : "Check domains"}
                    </button>
                  </form>
                  <form action={removeName}>
                    <input type="hidden" name="workspaceId" value={workspaceId} />
                    <input type="hidden" name="brandId" value={brandId} />
                    <input type="hidden" name="candidateId" value={candidate.id} />
                    <button className="chip-button chip-button--danger" type="submit" disabled={!canEdit}>Remove</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="studio-panel__empty">
            {candidates.length ? "No names match that filter." : "Your board is empty. Pick words above, mix pieces, or add curated starters — everything you keep lands here."}
          </p>
        )}
      </section>
    </div>
  );
}