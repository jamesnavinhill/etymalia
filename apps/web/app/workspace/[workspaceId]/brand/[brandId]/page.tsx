import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { readColors, readContrast } from "@etymalia/tokens";
import { AuthButton } from "@/components/auth-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { createClient } from "@/lib/supabase/server";
import { loadBrand, type NameCandidateRecord } from "@/lib/brand/load";
import { allWordSummaries } from "@/lib/brand/studio-server";
import {
  addManualName,
  activateDirection,
  archiveDirection,
  checkNameDomains,
  deleteReference,
  duplicateDirection,
  generateBrandPalette,
  generateSelection,
  removeName,
  renameDirection,
  saveBrief,
  saveDirection,
  savePalette,
  toggleShortlist,
  uploadReference,
  useName,
} from "./actions";
import { fetchStudioPieces, fetchStudioSuggestions, fetchStudioTables } from "./studio-actions";
import { NameStudio, type StudioBoardCandidate } from "./studio";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  brief: "We could not save the brief. Please try again.",
  names: "Name generation failed. Please try again.",
  "brief-needed": "Add keywords or a description before generating names.",
  select: "We could not select that name.",
  palette: "Palette generation failed. Please try again.",
  "export-needs-palette": "Generate a palette before exporting the kit.",
  "full-kit": "The full-kit job could not be queued. Please try again.",
  direction: "We could not save or activate that direction. Please try again.",
  identity: "We could not save that identity direction. Please try again.",
  forbidden: "You need editor access to change this brand."
};

export default async function BrandPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; brandId: string }>;
  searchParams: Promise<{ error?: string; job?: string }>;
}) {
  const { workspaceId, brandId } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();

  const loaded = await loadBrand(workspaceId, brandId);
  if (!loaded) redirect("/workspace");

  const { brand, tokens, candidates, assets, jobs, directions, references, workspaceRole } = loaded;
  const { error, job: requestedJob } = await searchParams;
  const errorMessage = error ? ERRORS[error] : null;
  const canEdit = workspaceRole === "owner" || workspaceRole === "editor";
  const currentJob = requestedJob ? jobs.find((job) => job.id === requestedJob) ?? jobs[0] : jobs[0];

  const hidden = (
    <>
      <input name="workspaceId" type="hidden" value={workspaceId} />
      <input name="brandId" type="hidden" value={brandId} />
    </>
  );

  const swatches = tokens ? readColors(tokens) : [];
  const contrast = tokens ? readContrast(tokens) : [];
  const logoAssets = assets.filter((asset) => asset.kind === "logo");
  const visibleAssets = assets.filter((asset) => asset.kind !== "media");

  // Only the lightweight word catalogue ships with the page; etymology tables,
  // blend pieces, and hybrid suggestions are fetched on demand by the studio.
  const catalogue = allWordSummaries();
  const boardCandidates: StudioBoardCandidate[] = candidates.map((candidate) => ({
    id: candidate.id,
    term: candidate.term,
    provenance: candidate.provenance,
    scores: candidate.scores,
    availability: candidate.availabilityReport?.domains ?? (candidate.availability ? [candidate.availability] : []),
    isShortlisted: candidate.isShortlisted,
  }));

  return (
    <main className="app-shell">
      <header className="app-header">
        <Link className="wordmark" href="/">etymalia</Link>
        <div className="header-actions">
          <ThemeToggle />
          <AuthButton
            avatarUrl={typeof auth.user?.user_metadata.avatar_url === "string" ? auth.user.user_metadata.avatar_url : null}
            email={auth.user?.email ?? null}
          />
        </div>
      </header>

      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link href="/workspace">Workspace</Link>
        <span aria-hidden="true">/</span>
        <span>{brand.workspaceName}</span>
      </nav>

      <section className="brand-hero">
        <p className="eyebrow">{brand.status} brand</p>
        <h1>{brand.name}</h1>
        <dl className="brand-meta">
          <div><dt>Names</dt><dd>{candidates.length ? `${candidates.length} candidates` : "Not generated"}</dd></div>
          <div><dt>Palette</dt><dd>{tokens ? "Generated" : "Not generated"}</dd></div>
          <div><dt>Kit</dt><dd>{assets.length ? `${assets.length} generated assets` : tokens ? "Ready to generate" : "Awaiting palette"}</dd></div>
        </dl>
      </section>

      {errorMessage ? <p className="status status--warning">{errorMessage}</p> : null}
      {!canEdit ? <p className="status">Viewer access: you can review and download this brand, but only owners and editors can make changes.</p> : null}
      {currentJob ? (
        <p className={`status${currentJob.status === "failed" ? " status--warning" : ""}`}>
          Generation job {currentJob.status}{currentJob.errorSummary ? `: ${currentJob.errorSummary}` : ""}
        </p>
      ) : null}

      <section className="brand-block" id="directions" aria-labelledby="directions-title">
        <div className="brand-block__head">
          <p className="eyebrow">Creative workspace</p>
          <h2 id="directions-title">Directions &amp; drafts</h2>
          <p className="brand-block__lede">Capture this working state as a named direction before you take another route. Activating a direction restores its brief, selected name board, and token system.</p>
        </div>
        <form action={saveDirection} className="inline-form studio-manual-name">
          {hidden}
          <label htmlFor="direction-name">Save this direction</label>
          <input id="direction-name" name="name" maxLength={120} placeholder="Editorial / restrained / warm" />
          <button className="button button--primary" type="submit" disabled={!canEdit || !tokens}>Save draft</button>
        </form>
        {directions.length ? (
          <ul className="direction-listing">
            {directions.map((direction) => (
              <li key={direction.id} className={direction.isActive ? "direction-listing__active" : ""}>
                <div><strong>{direction.name}</strong><span>{direction.status}{direction.isActive ? " · active" : ""}</span></div>
                <form action={activateDirection}>
                  {hidden}
                  <input name="directionId" type="hidden" value={direction.id} />
                  <button className="chip-button" type="submit" disabled={!canEdit || direction.isActive || direction.status === "archived"}>{direction.isActive ? "Active" : "Open direction"}</button>
                </form>
                <form action={duplicateDirection}>{hidden}<input name="directionId" type="hidden" value={direction.id} /><button className="chip-button" type="submit" disabled={!canEdit}>Duplicate</button></form>
                <form action={renameDirection}>{hidden}<input name="directionId" type="hidden" value={direction.id} /><input className="direction-listing__rename" name="name" defaultValue={direction.name} maxLength={120} aria-label={`Rename ${direction.name}`} /><button className="chip-button" type="submit" disabled={!canEdit}>Rename</button></form>
                <form action={archiveDirection}>{hidden}<input name="directionId" type="hidden" value={direction.id} /><button className="chip-button" type="submit" disabled={!canEdit || direction.isActive || direction.status === "archived"}>Archive</button></form>
              </li>
            ))}
          </ul>
        ) : <p className="brand-block__empty">No saved directions yet. Your current workspace remains editable; save it when you want a return point.</p>}
      </section>

      <section className="brand-block" id="references" aria-labelledby="references-title">
        <div className="brand-block__head"><p className="eyebrow">Creative direction</p><h2 id="references-title">Reference images</h2><p className="brand-block__lede">Upload up to twelve JPEG, PNG, or WebP references (10 MB each). They remain private and are never applied automatically.</p></div>
        <form action={uploadReference} className="inline-form" encType="multipart/form-data">{hidden}<label htmlFor="reference">Add image reference</label><input id="reference" name="reference" type="file" accept="image/jpeg,image/png,image/webp" required /><button className="button" type="submit" disabled={!canEdit}>Store reference</button></form>
        {references.length ? <ul className="direction-listing">{references.map((reference) => <li key={reference.id}><div><strong>{reference.title || "Untitled reference"}</strong><span>{reference.mimeType}{reference.byteSize ? ` · ${Math.round(reference.byteSize / 1024)} KB` : ""}</span></div><form action={deleteReference}>{hidden}<input name="referenceId" type="hidden" value={reference.id} /><button className="chip-button" type="submit" disabled={!canEdit}>Delete</button></form></li>)}</ul> : null}
      </section>

      <section className="brand-block" id="brief" aria-labelledby="brief-title">
        <div className="brand-block__head">
          <p className="eyebrow">Step 01</p>
          <h2 id="brief-title">Brief</h2>
          <p className="brand-block__lede">Describe the business. Keywords and tone steer the etymology name engine and palette.</p>
        </div>
        <form action={saveBrief} className="stack-form">
          {hidden}
          <label htmlFor="description">Business description</label>
          <textarea id="description" name="description" rows={3} maxLength={2000} defaultValue={brand.brief.description} placeholder="A precise bookkeeping studio for independent creative businesses." />
          <div className="field-row">
            <div className="field">
              <label htmlFor="industry">Industry</label>
              <input id="industry" name="industry" maxLength={160} defaultValue={brand.brief.industry} placeholder="Professional services" />
            </div>
            <div className="field">
              <label htmlFor="audience">Audience</label>
              <input id="audience" name="audience" maxLength={500} defaultValue={brand.brief.audience} placeholder="Independent creative businesses" />
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="keywords">Keywords <span className="hint">comma-separated</span></label>
              <input id="keywords" name="keywords" defaultValue={brand.brief.keywords.join(", ")} placeholder="clarity, trust, craft" />
            </div>
            <div className="field">
              <label htmlFor="tone">Tone <span className="hint">comma-separated</span></label>
              <input id="tone" name="tone" defaultValue={brand.brief.tone.join(", ")} placeholder="editorial, calm, credible" />
            </div>
          </div>
          <div className="form-actions">
            <button className="button button--primary" type="submit" disabled={!canEdit}>Save brief</button>
          </div>
        </form>
      </section>

      <section className="brand-block" id="names" aria-labelledby="names-title">
        <div className="brand-block__head">
          <p className="eyebrow">Step 02</p>
          <h2 id="names-title">Naming studio</h2>
          <p className="brand-block__lede">
            Pick a few base words from the full etymology table, see what every era has to say about them,
            and mix their forms into names that keep their meaning. Everything you keep lives on the board below.
          </p>
        </div>
        <NameStudio
          workspaceId={workspaceId}
          brandId={brandId}
          brandName={brand.name}
          canEdit={canEdit}
          catalogue={catalogue}
          candidates={boardCandidates}
          addManualName={addManualName}
          removeName={removeName}
          toggleShortlist={toggleShortlist}
          checkNameDomains={checkNameDomains}
          useName={useName}
          fetchTables={fetchStudioTables}
          fetchPieces={fetchStudioPieces}
          fetchSuggestions={fetchStudioSuggestions}
        />
      </section>

      <section className="brand-block" id="palette" aria-labelledby="palette-title">
        <div className="brand-block__head">
          <p className="eyebrow">Step 03</p>
          <h2 id="palette-title">Palette &amp; tokens</h2>
          <p className="brand-block__lede">A real token system, not a locked suggestion. Start from a generated palette, then swap any semantic color while retaining contrast feedback and a versioned DTCG source.</p>
        </div>
        <form action={generateBrandPalette} className="form-actions">
          {hidden}
          <button className="button button--primary" type="submit" disabled={!canEdit}>
            {tokens ? "Regenerate palette" : "Generate palette"}
          </button>
        </form>

        {tokens ? (
          <>
            <div className="swatch-grid">
              {swatches.map((swatch) => (
                <div className="swatch" key={swatch.role}>
                  <span className="swatch__chip" style={{ background: swatch.hex, color: swatch.on }}>Aa</span>
                  <div className="swatch__meta">
                    <strong>{swatch.role}</strong>
                    <code>{swatch.hex}</code>
                    <code className="swatch__oklch">{swatch.oklch}</code>
                  </div>
                </div>
              ))}
            </div>
            <ul className="contrast-list">
              {contrast.map((check) => (
                <li key={check.pair} className={check.passes ? "contrast--pass" : "contrast--fail"}>
                  <span>{check.pair}</span>
                  <span>{check.ratio.toFixed(2)} · {check.passes ? "PASS" : "FAIL"} {check.level}</span>
                </li>
              ))}
            </ul>
            <form action={savePalette} className="token-editor">
              {hidden}
              <div className="token-editor__grid">
                {swatches.map((swatch) => (
                  <label key={swatch.role}>
                    <span>{swatch.role}</span>
                    <input name={swatch.role} type="color" defaultValue={swatch.hex} aria-label={`${swatch.role} color`} />
                    <code>{swatch.hex}</code>
                  </label>
                ))}
              </div>
              <div className="form-actions"><button className="button" type="submit" disabled={!canEdit}>Save color direction</button><span className="hint">Unsaved edits are local to this form; saved edits create a new token version.</span></div>
            </form>
          </>
        ) : (
          <p className="brand-block__empty">No palette yet. Generate one from the brief.</p>
        )}
      </section>

      {visibleAssets.length ? (
        <section className="brand-block" id="assets" aria-labelledby="assets-title">
          <div className="brand-block__head">
            <p className="eyebrow">Generated kit</p>
            <h2 id="assets-title">Delivered assets</h2>
            <p className="brand-block__lede">Private, platform-ready derivatives generated from this brand’s current tokens.</p>
          </div>
          <div className="asset-grid">
            {visibleAssets.map((asset) => (
              <article className="asset-card" key={asset.id}>
                {asset.signedUrl ? <img alt={`${asset.variant} ${asset.lockup}`} src={asset.signedUrl} /> : <div className="asset-card__missing">Preview unavailable</div>}
                <div className="asset-card__meta">
                  <strong>{asset.variant || asset.kind}</strong>
                  <span>{asset.lockup || asset.format}{asset.meta.width && asset.meta.height ? ` · ${asset.meta.width}×${asset.meta.height}` : ""}</span>
                  {asset.signedUrl ? <a className="text-link" href={asset.signedUrl} download>Download asset</a> : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="brand-block" id="identity" aria-labelledby="identity-title">
        <div className="brand-block__head">
          <p className="eyebrow">Step 04</p>
          <h2 id="identity-title">Identity &amp; export</h2>
          <p className="brand-block__lede">Generate original vector-mark directions with Gemini and Vertex. Each direction ships as a real icon, horizontal lockup, and stacked lockup—not a configurable monogram template.</p>
        </div>

        {tokens ? (
          <>
            {logoAssets.length ? <div className="asset-grid" aria-label="AI logo directions">
              {logoAssets.map((asset) => (
                <article className="asset-card" key={`concept-${asset.id}`}>
                  {asset.signedUrl ? <img alt={`${asset.variant} ${asset.lockup} logo`} src={asset.signedUrl} /> : <div className="asset-card__missing">Preview unavailable</div>}
                  <div className="asset-card__meta"><strong>{asset.variant} · {asset.lockup}</strong><span>Editable SVG · {asset.meta.source === "google-gemini-vector" ? "Gemini" : "Vertex"}</span>{asset.signedUrl ? <a className="text-link" href={asset.signedUrl} download>Download SVG</a> : null}</div>
                </article>
              ))}
            </div> : <p className="brand-block__empty">No logo directions yet. Generate the first two concepts from this brief and palette.</p>}
            <div className="form-actions">
              <a className="button button--primary" href={`/workspace/${workspaceId}/brand/${brandId}/export`}>
                Download brand kit (.zip)
              </a>
              <form action={generateSelection}><>{hidden}<input name="selection" type="hidden" value="logo" /><button className="button" type="submit" disabled={!canEdit}>{logoAssets.length ? "Generate two new logo directions" : "Generate AI logo directions"}</button></></form>
              <span className="hint">
                Both providers create an original vector mark, then Etymalia composes an exact-name horizontal and stacked lockup plus icon export.
              </span>
            </div>
          </>
        ) : (
          <p className="brand-block__empty">Generate a palette to unlock the logo and export.</p>
        )}
      </section>
    </main>
  );
}
