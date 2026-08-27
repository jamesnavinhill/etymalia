"use server";

import {
  piecesForPicked,
  suggestionsForPicked,
  tablesForPicked,
} from "@/lib/brand/studio-server";
import type { MixLayer, StudioHybridView, StudioPieceView, StudioTableView } from "@/lib/brand/studio";

/** Data-returning actions — the naming studio fetches these on demand as the
 * user picks words, keeping the initial page payload light and the results
 * always consistent with the checked-in corpus. */

export async function fetchStudioTables(slugs: string[]): Promise<StudioTableView[]> {
  return tablesForPicked(slugs);
}

export async function fetchStudioPieces(
  words: string[],
  layers: MixLayer[],
): Promise<{ heads: StudioPieceView[]; tails: StudioPieceView[] }> {
  return piecesForPicked(words, layers);
}

export async function fetchStudioSuggestions(
  words: string[],
  layers: MixLayer[],
): Promise<StudioHybridView[]> {
  return suggestionsForPicked(words, { layers, count: 40, maxSyllables: 6 });
}
