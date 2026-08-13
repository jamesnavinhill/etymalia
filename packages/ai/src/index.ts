import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createVertex } from "@ai-sdk/google-vertex";
import { GoogleAuth } from "google-auth-library";
import { z } from "zod";

export type ProviderId = "google" | "google-vertex";
export type Lane = "studio" | "prod";

export type CredentialSource =
  | { type: "apiKey"; provider: "google"; apiKey: string }
  | {
      type: "serviceAccount";
      provider: "google-vertex";
      clientEmail: string;
      privateKey: string;
      project: string;
      location: string;
    };

export type ResolvedCredential =
  | { provider: "google"; apiKey: string }
  | {
      provider: "google-vertex";
      clientEmail: string;
      privateKey: string;
      project: string;
      location: string;
    };

export interface CredentialStore {
  getSource(args: { lane: Lane; provider: ProviderId; userId?: string }): Promise<CredentialSource>;
}

export class CredentialResolver {
  constructor(private readonly store: CredentialStore) {}

  async resolve(args: { lane: Lane; provider: ProviderId; userId?: string }): Promise<ResolvedCredential> {
    if (args.lane === "prod" && !args.userId) {
      throw new Error("A user ID is required for production credentials.");
    }
    const source = await this.store.getSource(args);
    if (source.provider !== args.provider) {
      throw new Error(`Credential store returned ${source.provider} for ${args.provider}.`);
    }
    return source.type === "apiKey"
      ? { provider: "google", apiKey: source.apiKey }
      : {
          provider: "google-vertex",
          clientEmail: source.clientEmail,
          privateKey: source.privateKey,
          project: source.project,
          location: source.location,
        };
  }
}

export function buildProvider(credential: ResolvedCredential) {
  if (credential.provider === "google") {
    return createGoogleGenerativeAI({ apiKey: credential.apiKey });
  }
  return createVertex({
    project: credential.project,
    location: credential.location,
    googleAuthOptions: {
      credentials: { client_email: credential.clientEmail, private_key: credential.privateKey },
    },
  });
}

/** A provider-returned model record. No model IDs are maintained in source. */
export interface ProviderModel {
  provider: ProviderId;
  id: string;
  displayName: string;
  version?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supports: string[];
  thinking?: boolean;
  discoveredAt: string;
}

export interface ModelSelectionRequest {
  provider: ProviderId;
  requiredActions: string[];
  preferThinking?: boolean;
  minimumInputTokens?: number;
  minimumOutputTokens?: number;
}

interface GeminiModelResponse {
  models?: Array<{
    name?: string;
    baseModelId?: string;
    displayName?: string;
    version?: string;
    inputTokenLimit?: number;
    outputTokenLimit?: number;
    supportedGenerationMethods?: string[];
    thinking?: boolean;
  }>;
  nextPageToken?: string;
}

interface VertexModelResponse {
  models?: Array<{
    name?: string;
    displayName?: string;
    versionId?: string;
    supportedActions?: unknown;
  }>;
  publisherModels?: Array<{
    name?: string;
    displayName?: string;
    versionId?: string;
    supportedActions?: unknown;
  }>;
  nextPageToken?: string;
}

const cache = new Map<string, { expiresAt: number; models: ProviderModel[] }>();

export class LiveProviderModelCatalog {
  constructor(
    private readonly resolver: CredentialResolver,
    private readonly options: { cacheTtlMs?: number; fetch?: typeof fetch } = {},
  ) {}

  async list(context: AiContext, provider: ProviderId): Promise<ProviderModel[]> {
    const key = `${context.lane}:${context.userId ?? ""}:${provider}`;
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.models;

    const credential = await this.resolver.resolve({ ...context, provider });
    const models = credential.provider === "google"
      ? await this.listGemini(credential)
      : await this.listVertex(credential);

    cache.set(key, { models, expiresAt: Date.now() + (this.options.cacheTtlMs ?? 300_000) });
    return models;
  }

  async select(context: AiContext, request: ModelSelectionRequest): Promise<ProviderModel> {
    const candidates = (await this.list(context, request.provider)).filter((model) =>
      request.requiredActions.every((action) => model.supports.includes(action)) &&
      (request.minimumInputTokens === undefined || (model.inputTokenLimit ?? 0) >= request.minimumInputTokens) &&
      (request.minimumOutputTokens === undefined || (model.outputTokenLimit ?? 0) >= request.minimumOutputTokens),
    );

    if (!candidates.length) {
      throw new Error(`No current ${request.provider} model meets the requested provider capabilities.`);
    }

    return candidates.sort((left, right) => {
      const thinking = Number(Boolean(right.thinking) === Boolean(request.preferThinking)) - Number(Boolean(left.thinking) === Boolean(request.preferThinking));
      if (thinking) return thinking;
      const version = compareVersion(right.version, left.version);
      if (version) return version;
      return (right.outputTokenLimit ?? 0) - (left.outputTokenLimit ?? 0);
    })[0];
  }

  private async listGemini(credential: Extract<ResolvedCredential, { provider: "google" }>) {
    const models: ProviderModel[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
      url.searchParams.set("key", credential.apiKey);
      url.searchParams.set("pageSize", "1000");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const response = await this.request(url);
      const body = (await response.json()) as GeminiModelResponse;
      models.push(...(body.models ?? []).flatMap((model) => {
        const id = model.baseModelId ?? model.name?.replace(/^models\//, "");
        return id ? [{
          provider: "google" as const,
          id,
          displayName: model.displayName ?? id,
          version: model.version,
          inputTokenLimit: model.inputTokenLimit,
          outputTokenLimit: model.outputTokenLimit,
          supports: model.supportedGenerationMethods ?? [],
          thinking: model.thinking,
          discoveredAt: new Date().toISOString(),
        }] : [];
      }));
      pageToken = body.nextPageToken;
    } while (pageToken);
    return models;
  }

  private async listVertex(credential: Extract<ResolvedCredential, { provider: "google-vertex" }>) {
    const auth = new GoogleAuth({
      credentials: { client_email: credential.clientEmail, private_key: credential.privateKey },
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
    const token = await auth.getAccessToken();
    if (!token) throw new Error("Unable to authenticate the Vertex model catalog request.");

    const models: ProviderModel[] = [];
    let pageToken: string | undefined;
    do {
      const host = credential.location === "global" ? "aiplatform.googleapis.com" : `${credential.location}-aiplatform.googleapis.com`;
      const url = new URL(`https://${host}/v1beta1/publishers/google/models`);
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const response = await this.request(url, { headers: { authorization: `Bearer ${token}` } });
      const body = (await response.json()) as VertexModelResponse;
      for (const model of [...(body.models ?? []), ...(body.publisherModels ?? [])]) {
        const id = model.name?.split("/").at(-1);
        if (id) models.push({
          provider: "google-vertex",
          id,
          displayName: model.displayName ?? id,
          version: model.versionId,
          // Vertex's publisher catalogue currently omits this field for many
          // Google image models. Keep that absence distinct from an explicit
          // unsupported action so capability selection can handle it safely.
          supports: Array.isArray(model.supportedActions) ? model.supportedActions.filter((action): action is string => typeof action === "string") : [],
          discoveredAt: new Date().toISOString(),
        });
      }
      pageToken = body.nextPageToken;
    } while (pageToken);
    return models;
  }

  private async request(url: URL, init?: RequestInit): Promise<Response> {
    const response = await (this.options.fetch ?? fetch)(url, init);
    if (!response.ok) throw new Error(`Provider model catalog request failed: ${response.status}`);
    return response;
  }
}

function compareVersion(left?: string, right?: string): number {
  return (left ?? "").localeCompare(right ?? "", undefined, { numeric: true, sensitivity: "base" });
}

export interface AiContext { lane: Lane; userId?: string; }

export class AiPort {
  private readonly catalog: LiveProviderModelCatalog;
  constructor(private readonly resolver: CredentialResolver, catalog?: LiveProviderModelCatalog) {
    this.catalog = catalog ?? new LiveProviderModelCatalog(resolver);
  }

  async resolveModel(context: AiContext, request: ModelSelectionRequest) {
    const model = await this.catalog.select(context, request);
    const credential = await this.resolver.resolve({ ...context, provider: model.provider });
    return { model, provider: buildProvider(credential) };
  }
}

export const BrandBriefSchema = z.object({
  description: z.string().min(1).max(2_000), industry: z.string().min(1).max(160), audience: z.string().max(500).optional(),
  keywords: z.array(z.string().min(1).max(80)).min(1).max(12), tone: z.array(z.string().min(1).max(80)).max(8).default([]), avoid: z.array(z.string().min(1).max(80)).max(12).default([]),
});
export const NameCandidateSchema = z.object({
  term: z.string().min(1).max(160), pronunciation: z.string().max(160).optional(), meaning: z.string().min(1).max(500),
  provenance: z.array(z.object({ language: z.string().min(1).max(80), root: z.string().min(1).max(160), gloss: z.string().min(1).max(300) })), rationale: z.string().min(1).max(500),
});
export const BrandDirectionSchema = z.object({
  summary: z.string().min(1).max(1_000), nameCandidates: z.array(NameCandidateSchema).min(1).max(12),
  palette: z.array(z.object({ name: z.string().min(1).max(80), hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/), role: z.enum(["primary", "secondary", "accent", "background", "text"]) })).min(3).max(8),
  typography: z.object({ display: z.string().min(1).max(160), body: z.string().min(1).max(160), rationale: z.string().min(1).max(500) }),
});
export type BrandBrief = z.infer<typeof BrandBriefSchema>;
export type BrandDirection = z.infer<typeof BrandDirectionSchema>;

export async function generateBrandDirection(port: AiPort, brief: BrandBrief, context: AiContext): Promise<BrandDirection> {
  const { generateObject } = await import("ai");
  const { model, provider } = await port.resolveModel(context, { provider: "google", requiredActions: ["generateContent"], preferThinking: true });
  const result = await generateObject({
    model: provider.languageModel(model.id as never), schema: BrandDirectionSchema,
    prompt: ["Create a concise, credible first brand direction.", "Use real, explainable etymology for name candidates; do not invent provenance.", "Return only values matching the supplied schema.", `Brief: ${JSON.stringify(brief)}`].join("\n\n"),
  });
  return result.object;
}

export type MediaLane = "gemini" | "vertex";

export interface BrandMediaRequest {
  name: string;
  description: string;
  industry: string;
  keywords: string[];
  tone: string[];
  palette: { primary: string; accent: string; paper: string; ink?: string };
  aspectRatio: "1:1" | "4:5" | "16:9";
}

export interface GeneratedBrandMedia {
  lane: MediaLane;
  model: ProviderModel;
  mimeType: string;
  bytes: Uint8Array;
}

/**
 * A deliberately constrained vector vocabulary. The model designs the mark;
 * the application owns the SVG document, wordmark, and all export lockups.
 * This prevents provider output from becoming executable SVG in the product.
 */
const LogoMarkSchema = z.object({
  rationale: z.string().min(1).max(700),
  mark: z.object({
    paths: z.array(z.object({
      d: z.string().min(1).max(1_800),
      fill: z.enum(["primary", "accent", "ink", "paper", "none"]).default("primary"),
      stroke: z.enum(["primary", "accent", "ink", "paper", "none"]).default("none"),
      strokeWidth: z.number().min(0).max(12).default(0),
    })).min(1).max(24),
    circles: z.array(z.object({
      cx: z.number().min(0).max(128), cy: z.number().min(0).max(128), r: z.number().min(0.5).max(64),
      fill: z.enum(["primary", "accent", "ink", "paper", "none"]).default("primary"),
    })).max(12).default([]),
    rects: z.array(z.object({
      x: z.number().min(0).max(128), y: z.number().min(0).max(128), width: z.number().min(0.5).max(128), height: z.number().min(0.5).max(128), rx: z.number().min(0).max(64).default(0),
      fill: z.enum(["primary", "accent", "ink", "paper", "none"]).default("primary"),
    })).max(12).default([]),
  }),
});

const LogoVectorResponseSchema = z.object({
  rationale: z.string().min(1).max(700),
  // A compound path can contain multiple closed subpaths, so this still permits
  // sophisticated negative-space marks while keeping a provider response
  // small, validatable, and reliably structured across both lanes.
  svgPath: z.string().min(1).max(5_000),
});

// Gemini's JSON MIME mode alone is not sufficient for geometric path payloads:
// attach an explicit response schema so malformed prose never reaches storage.
const LogoResponseJsonSchema = {
  type: "object",
  required: ["rationale", "svgPath"],
  properties: {
    rationale: { type: "string" },
    svgPath: { type: "string" },
  },
} as const;

export type LogoMark = z.infer<typeof LogoMarkSchema>["mark"];

export interface GeneratedBrandLogo {
  lane: MediaLane;
  model: ProviderModel;
  rationale: string;
  mark: LogoMark;
}

/** Generate independent, editable vector-mark concepts from each Google lane. */
export async function generateBrandLogoConcepts(
  resolver: CredentialResolver,
  context: AiContext,
  request: Omit<BrandMediaRequest, "aspectRatio">,
  lanes: readonly MediaLane[] = ["gemini", "vertex"],
): Promise<GeneratedBrandLogo[]> {
  const prompt = logoPrompt(request);
  const concepts: GeneratedBrandLogo[] = [];
  for (const lane of lanes) {
    if (lane === "gemini") {
      const credential = await resolver.resolve({ ...context, provider: "google" });
      if (credential.provider !== "google") throw new Error("Gemini credential resolution failed.");
      const catalog = new LiveProviderModelCatalog(resolver);
      const model = selectLiveTextModel(await catalog.list(context, "google"), "gemini");
      concepts.push({ lane, model, ...await generateGeminiLogo(credential, model, prompt) });
    } else {
      const credential = await resolver.resolve({ ...context, provider: "google-vertex" });
      if (credential.provider !== "google-vertex") throw new Error("Vertex credential resolution failed.");
      const catalog = new LiveProviderModelCatalog(resolver);
      const model = selectLiveTextModel(await catalog.list(context, "google-vertex"), "vertex");
      concepts.push({ lane, model, ...await generateVertexLogo(credential, model, prompt) });
    }
  }
  return concepts;
}

function selectLiveTextModel(models: ProviderModel[], lane: MediaLane): ProviderModel {
  const model = models
    .filter((candidate) => lane === "gemini"
      ? candidate.supports.includes("generateContent")
      : /^gemini/i.test(candidate.id))
    // Publisher catalogues include experimental, live, TTS, embedding and
    // image revisions beside general text models. They can share a prefix but
    // do not all implement this request. Choose only a current Pro text model
    // discovered at runtime; no provider model ID is pinned in source.
    .filter((candidate) => /pro/i.test(`${candidate.id} ${candidate.displayName}`))
    .filter((candidate) => !/(?:image|imagen|embed|tts|live|exp|preview|flash)/i.test(`${candidate.id} ${candidate.displayName}`))
    .sort((left, right) => imageQualityRank(right) - imageQualityRank(left) || compareVersion(right.version, left.version) || right.id.localeCompare(left.id))[0];
  if (!model) throw new Error(`No live ${lane} text model is available for logo generation.`);
  return model;
}

function logoPrompt(request: Omit<BrandMediaRequest, "aspectRatio">): string {
  return [
    "You are designing an original, premium vector logo mark. Return JSON only; it must match the requested schema.",
    `Brand name: ${request.name}. Business: ${request.description || request.industry}.`,
    `Keywords: ${request.keywords.join(", ") || "clarity, craft"}. Tone: ${request.tone.join(", ") || "refined"}.`,
    `Use the semantic palette primary=${request.palette.primary}, accent=${request.palette.accent}, ink=${request.palette.ink ?? request.palette.primary}, paper=${request.palette.paper}.`,
    "Create a distinctive abstract symbol, not a monogram, initial, letter, generic sparkle, infinity loop, swoosh, shield, or stock icon. The mark must be legible at 24px and use considered negative space. Do not include text; the application composes the exact wordmark itself.",
    "Return exactly {\"rationale\": string, \"svgPath\": string}. svgPath is one compound SVG path in a 0 0 128 128 viewBox; it may contain multiple closed subpaths to create negative space. Use only ordinary SVG path commands (M,L,H,V,C,S,Q,T,A,Z) and numeric coordinates. Keep it simple, balanced, and production-ready.",
  ].join("\n");
}

function parseLogoResponse(value: string): Omit<GeneratedBrandLogo, "lane" | "model"> {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? value;
  const first = fenced.indexOf("{");
  const last = fenced.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("Logo model returned no JSON object.");
  const object = LogoVectorResponseSchema.parse(JSON.parse(fenced.slice(first, last + 1)));
  if (!/^[MmLlHhVvCcSsQqTtAaZz0-9, .+\-]+$/.test(object.svgPath)) throw new Error("Logo model returned unsafe SVG path data.");
  return { rationale: object.rationale, mark: { paths: [{ d: object.svgPath, fill: "primary", stroke: "none", strokeWidth: 0 }], circles: [], rects: [] } };
}

async function generateGeminiLogo(
  credential: Extract<ResolvedCredential, { provider: "google" }>, model: ProviderModel, prompt: string,
): Promise<Omit<GeneratedBrandLogo, "lane" | "model">> {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.id)}:generateContent?key=${encodeURIComponent(credential.apiKey)}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", responseJsonSchema: LogoResponseJsonSchema } }),
  });
  if (!response.ok) throw new Error(`Gemini logo request failed: ${response.status}`);
  const data = await response.json() as GeminiImageResponse;
  const text = data.candidates?.flatMap((candidate) => candidate.content?.parts ?? []).map((part) => (part as { text?: unknown }).text).find((part): part is string => typeof part === "string");
  if (!text) throw new Error("Gemini returned no vector-logo response.");
  return parseLogoResponse(text);
}

async function generateVertexLogo(
  credential: Extract<ResolvedCredential, { provider: "google-vertex" }>, model: ProviderModel, prompt: string,
): Promise<Omit<GeneratedBrandLogo, "lane" | "model">> {
  const auth = new GoogleAuth({ credentials: { client_email: credential.clientEmail, private_key: credential.privateKey }, scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const token = await auth.getAccessToken();
  if (!token) throw new Error("Unable to authenticate the Vertex logo request.");
  const host = credential.location === "global" ? "aiplatform.googleapis.com" : `${credential.location}-aiplatform.googleapis.com`;
  const url = `https://${host}/v1beta1/projects/${credential.project}/locations/${credential.location}/publishers/google/models/${encodeURIComponent(model.id)}:generateContent`;
  const response = await fetch(url, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    // The global Vertex publisher endpoint rejects structured-output controls
    // for several live Gemini revisions. The prompt asks for exact JSON and
    // parseLogoResponse is the strict boundary before anything is persisted.
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }] }),
  });
  if (!response.ok) throw new Error(`Vertex logo request failed: ${response.status}`);
  const data = await response.json() as GeminiImageResponse;
  const text = data.candidates?.flatMap((candidate) => candidate.content?.parts ?? []).map((part) => (part as { text?: unknown }).text).find((part): part is string => typeof part === "string");
  if (!text) throw new Error("Vertex returned no vector-logo response.");
  return parseLogoResponse(text);
}

interface GeminiImageResponse {
  candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }>;
}

interface VertexImageResponse {
  predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
}

/**
 * Generate one usable visual per configured Google lane. Model IDs are chosen
 * from the provider's live catalogue; callers never send model identifiers.
 */
export async function generateBrandMedia(
  resolver: CredentialResolver,
  context: AiContext,
  request: BrandMediaRequest,
  lanes: readonly MediaLane[] = ["gemini", "vertex"],
): Promise<GeneratedBrandMedia[]> {
  const prompt = mediaPrompt(request);
  const generated: GeneratedBrandMedia[] = [];
  for (const lane of lanes) {
    if (lane === "gemini") {
      const credential = await resolver.resolve({ ...context, provider: "google" });
      if (credential.provider !== "google") throw new Error("Gemini credential resolution failed.");
      const catalog = new LiveProviderModelCatalog(resolver);
      const model = selectLiveImageModel(await catalog.list(context, "google"), "gemini");
      generated.push({ lane, model, ...await generateGeminiImage(credential, model, prompt, request.aspectRatio) });
    } else {
      const credential = await resolver.resolve({ ...context, provider: "google-vertex" });
      if (credential.provider !== "google-vertex") throw new Error("Vertex credential resolution failed.");
      const catalog = new LiveProviderModelCatalog(resolver);
      const model = selectLiveImageModel(await catalog.list(context, "google-vertex"), "vertex");
      generated.push({ lane, model, ...await generateVertexImage(credential, model, prompt, request.aspectRatio) });
    }
  }
  return generated;
}

function selectLiveImageModel(models: ProviderModel[], lane: MediaLane): ProviderModel {
  const model = models
    .filter((candidate) => /(?:image|imagen)/i.test(`${candidate.id} ${candidate.displayName}`))
    .filter((candidate) => lane === "gemini"
      ? candidate.supports.includes("generateContent")
      // The Vertex catalogue omits supportedActions on current Gemini image
      // models. Their documented generation method is generateContent; Imagen
      // models use predict. Both are selected by capability family, never an ID.
      : /^(?:gemini)|imagen/i.test(candidate.id))
    .sort((left, right) => imageQualityRank(right) - imageQualityRank(left) || compareVersion(right.version, left.version) || right.id.localeCompare(left.id))[0];
  if (!model) throw new Error(`No live ${lane} image-generation model is available for this account.`);
  return model;
}

/** Prefer the provider's premium image family without pinning a vendor model. */
function imageQualityRank(model: ProviderModel): number {
  const descriptor = `${model.id} ${model.displayName}`.toLowerCase();
  return (descriptor.includes("pro") ? 100 : 0)
    + (descriptor.includes("lite") ? -100 : 0)
    + (descriptor.includes("flash") ? -10 : 0)
    + (descriptor.includes("preview") ? -2 : 0);
}

function mediaPrompt(request: BrandMediaRequest): string {
  return [
    `Create a premium brand visual for ${request.name}.`,
    `Business: ${request.description || request.industry}.`,
    `Keywords: ${request.keywords.join(", ") || "craft, clarity"}. Tone: ${request.tone.join(", ") || "refined"}.`,
    `Palette: primary ${request.palette.primary}, accent ${request.palette.accent}, paper ${request.palette.paper}.`,
    "Art direction: original premium brand territory, art-directed editorial composition, tactile material nuance, considered negative space, restrained hierarchy, no stock photography, no gradients, no mockup devices, no readable text, no letters, no logos, no watermarks.",
  ].join("\n");
}

async function generateGeminiImage(
  credential: Extract<ResolvedCredential, { provider: "google" }>,
  model: ProviderModel,
  prompt: string,
  aspectRatio: BrandMediaRequest["aspectRatio"],
): Promise<{ mimeType: string; bytes: Uint8Array }> {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.id)}:generateContent?key=${encodeURIComponent(credential.apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio } } }),
  });
  if (!response.ok) throw new Error(`Gemini media request failed: ${response.status}`);
  const data = await response.json() as GeminiImageResponse;
  const image = data.candidates?.flatMap((candidate) => candidate.content?.parts ?? []).map((part) => part.inlineData).find((part) => part?.data && part.mimeType?.startsWith("image/"));
  if (!image?.data || !image.mimeType) throw new Error("Gemini returned no image data.");
  return { mimeType: image.mimeType, bytes: Uint8Array.from(Buffer.from(image.data, "base64")) };
}

async function generateVertexImage(
  credential: Extract<ResolvedCredential, { provider: "google-vertex" }>,
  model: ProviderModel,
  prompt: string,
  aspectRatio: BrandMediaRequest["aspectRatio"],
): Promise<{ mimeType: string; bytes: Uint8Array }> {
  const auth = new GoogleAuth({ credentials: { client_email: credential.clientEmail, private_key: credential.privateKey }, scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const token = await auth.getAccessToken();
  if (!token) throw new Error("Unable to authenticate the Vertex media request.");
  const isGemini = /^gemini/i.test(model.id);
  const host = credential.location === "global" ? "aiplatform.googleapis.com" : `${credential.location}-aiplatform.googleapis.com`;
  const url = `https://${host}/v1beta1/projects/${credential.project}/locations/${credential.location}/publishers/google/models/${encodeURIComponent(model.id)}:${isGemini ? "generateContent" : "predict"}`;
  const response = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(isGemini
    ? { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio } } }
    : { instances: [{ prompt }], parameters: { sampleCount: 1, aspectRatio } }) });
  if (!response.ok) throw new Error(`Vertex media request failed: ${response.status}`);
  if (isGemini) {
    const data = await response.json() as GeminiImageResponse;
    const image = data.candidates?.flatMap((candidate) => candidate.content?.parts ?? []).map((part) => part.inlineData).find((part) => part?.data && part.mimeType?.startsWith("image/"));
    if (!image?.data || !image.mimeType) throw new Error("Vertex returned no image data.");
    return { mimeType: image.mimeType, bytes: Uint8Array.from(Buffer.from(image.data, "base64")) };
  }
  const data = await response.json() as VertexImageResponse;
  const image = data.predictions?.find((prediction) => prediction.bytesBase64Encoded);
  if (!image?.bytesBase64Encoded) throw new Error("Vertex returned no image data.");
  return { mimeType: image.mimeType?.startsWith("image/") ? image.mimeType : "image/png", bytes: Uint8Array.from(Buffer.from(image.bytesBase64Encoded, "base64")) };
}
