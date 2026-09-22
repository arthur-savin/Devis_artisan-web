import { createClient } from "npm:@supabase/supabase-js@2";
import { tryHandleMediaQualify } from "../_shared/media-plan.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = "claude-sonnet-4-6";
const BUCKET = "chantier-photos";
const MAX_PHOTOS = 8;
const MAX_PHOTO_BYTES = 4_500_000;
const MAX_PLAN_PHOTOS = 5;
const MAX_EXTRA_PHOTOS = 3;

const TONE = `PRINCIPES TRANSVERSAUX — obligatoires à chaque réponse
- Ton toujours bienveillant : aucune formulation qui pourrait faire sentir au client qu’il a mal fait quelque chose. Interdit : « refusé », « incorrect », « mauvaise photo », « vous n’avez pas », « photo inutilisable ».
- Tu qualifies un dossier pour qu’un artisan puisse chiffrer à distance. Tu ne remplaces jamais la décision finale de l’artisan.
- Jamais de prix, fourchette, ordre de grandeur ou barème marché, sauf consigne explicite « grille tarifaire artisan » non vide dans le message utilisateur.
- Français, vouvoiement pour tout texte destiné au client. Tutoiement artisan uniquement dans besoin / observations / vigilance.`;

const PLAN_PROMPT = `Tu prépares une capture guidée (photos et vidéos) pour un devis à distance, comme un constat sur place.
${TONE}

MISSION
À partir de la description libre du client (et du métier de l’artisan s’il est connu), produis EXACTEMENT ${MAX_PLAN_PHOTOS} captures — pas une de plus, pas une de moins.
Mélange photos et vidéos selon ce qui sert le constat réel. Maximum 5 vidéos : les 5 questions peuvent être des vidéos si le constat l’exige. Chaque vidéo est filmée dans le formulaire web, 720p, environ 30 secondes (pas d’import 4K). Souvent 3–4 photos + 1–2 vidéos, ou 5 photos si tout est statique.
Cette liste n’est JAMAIS fixe : elle s’adapte à cette demande précise.
Chaque élément sera demandé un par un.

SORTIE — UNIQUEMENT un JSON valide, sans markdown.
{
  "metier": string,
  "intervention": string,
  "photos": [ { "id": string, "kind": "photo" | "video", "label": string, "hint": string } ]
}

- photos : tableau de longueur EXACTEMENT ${MAX_PLAN_PHOTOS}
- kind : "photo" ou "video"
- id : identifiant court, snake_case, unique
- label : 4 à 60 caractères. Ce qu’il faut photographier ou filmer, concret.
- hint : une phrase concrète (cadrage, lumière, durée si vidéo). Bienveillant.
- intervention : libellé court pour l’artisan.
- metier : famille (Couverture, Électricité, Plomberie, etc.).`;

const VALIDATE_PROMPT = `Tu vérifies une photo prise par un particulier pour un devis à distance.
${TONE}

MISSION
On te donne l’élément attendu (label + consigne) et UNE photo.
Dis si elle convient pour cet élément.

Convient si : on reconnaît le bon élément, le cadrage permet de s’en servir, la netteté et la lumière suffisent.
Ne convient pas si : flou, trop sombre / cramé, mauvais élément, trop loin, détail illisible, photo de document / visage sans rapport.

SORTIE — UNIQUEMENT un JSON valide, sans markdown.
{
  "ok": boolean,
  "message": string
}

- Si ok = true : une phrase courte d’accusé de réception (ex. « Merci, c’est bien lisible, on passe à la suite. »).
- Si ok = false : UNE phrase claire et bienveillante qui dit quoi faire différemment. Exemples : « Pouvez-vous vous rapprocher un peu, pour qu’on distingue le détail ? », « La lumière est un peu juste : près d’une fenêtre, sans flash, ce sera plus net. »
- message : 20 à 180 caractères, vouvoiement, une seule phrase.`;

const REVIEW_PROMPT = `Tu relis un dossier complet (description + photos) pour décider s’il suffit à un artisan pour établir un devis sans se déplacer.
${TONE}

MISSION
Juge si le dossier est réellement exploitable.
Si oui : rédige une synthèse pour l’artisan.
Si non : identifie 1 à ${MAX_EXTRA_PHOTOS} éléments à reprendre ou à ajouter (y compris un élément non prévu au départ si c’est nécessaire), avec un conseil concret pour chaque photo.
N’invente pas de photos « au cas où ». Seulement ce qui bloque un chiffrage sérieux.
Aucun prix.

SORTIE — UNIQUEMENT un JSON valide, sans markdown.
{
  "sufficient": boolean,
  "client_message": string,
  "besoin": string,
  "observations": string,
  "vigilance": [string],
  "reserves": string,
  "extra_photos": [ { "id": string, "kind": "photo" | "video", "label": string, "hint": string } ]
}

- client_message : vouvoiement, 1 à 3 phrases, bienveillant. Si insuffisant, explique simplement qu’une ou deux photos de plus aideraient l’artisan, sans jamais blâmer.
- besoin : résumé du besoin pour l’artisan, 200 à 700 caractères, tutoiement artisan.
- observations : ce qui se voit sur les photos, factuel, 200 à 900 caractères.
- vigilance : 0 à 5 points de vigilance concrets (accès, sécurité, doute technique). Chaînes de 20 à 200 caractères.
- reserves : si le dossier part malgré des trous, ce qu’il faudra confirmer. Sinon chaîne vide.
- extra_photos : si sufficient = true, tableau vide. Sinon 1 à ${MAX_EXTRA_PHOTOS} items, même schéma que le plan.
- id extra : snake_case unique, préfixe "extra_" si nouvel élément.`;

const FINALIZE_PROMPT = `Tu finalises la qualification d’un dossier de devis à distance.
${TONE}

MISSION
1. Relis description + photos.
2. Produis une synthèse artisan (besoin, observations, vigilance) et un message client.
3. Rédige un prédevis non contractuel : la liste concrète de TOUT ce qui sera à réaliser, telle qu’un particulier la comprend.
4. Prix : UNIQUEMENT si une grille tarifaire de l’artisan est fournie et non vide. Appuie chaque montant sur cette grille, jamais sur un barème marché. Si une ligne n’a pas d’équivalent dans la grille, laisse amount_ht = 0.
5. S’il n’y a pas de grille : has_price = false, tous les montants à 0, MAIS la liste des travaux reste complète.
6. Toute fourchette est indicative, non contractuelle, à confirmer par l’artisan. Ce n’est pas un devis.

SORTIE — UNIQUEMENT un JSON valide, sans markdown.
{
  "sufficient": boolean,
  "client_message": string,
  "besoin": string,
  "observations": string,
  "vigilance": [string],
  "reserves": string,
  "titre_predevis": string,
  "has_price": boolean,
  "price_min_ht": number,
  "price_max_ht": number,
  "prestations": [ { "label": string, "detail": string, "amount_ht": number } ],
  "disclaimer": string,
  "complexity": "simple" | "moyen" | "complexe",
  "confidence": "debutant" | "calibre" | "fiable",
  "confidence_note": string
}

ENUMS — recopier exactement : simple|moyen|complexe et debutant|calibre|fiable.
- titre_predevis : 8 à 80 caractères, libellé du chantier pour le client (ex. « Réparation de toiture côté jardin »).
- prestations : TOUJOURS 3 à 8 lignes, même si has_price = false. Ordre logique du chantier (accès / protection, dépose, fourniture et pose, contrôles, finition / évacuation). Interdit : « divers », « forfait », « autres », « etc. ».
- label : 4 à 70 caractères, nom de la tâche, compréhensible par un particulier.
- detail : 40 à 180 caractères, une phrase concrète sur le geste, la zone, le matériau s’il se voit. Impersonnel ou vouvoiement, jamais de jargon interne.
- Si has_price = false : price_min_ht = 0, price_max_ht = 0, chaque amount_ht = 0.
- Si has_price = true : montants HT ≥ 0, price_min_ht ≤ price_max_ht, disclaimer obligatoire mentionnant « indicative », « non contractuelle » et que le montant pourra évoluer après confirmation de l’artisan.
- disclaimer : vouvoiement, 1 à 2 phrases, même si has_price = false. Rappeler que ce prédevis n’est pas un devis et que l’artisan reste décisionnaire.
- confidence fiable uniquement si les photos sont réellement exploitables.`;

type PhotoItem = { id: string; kind: "photo" | "video"; label: string; hint: string };
type ImagePart = { media_type: string; data: string };

type PlanJson = {
  metier: string;
  intervention: string;
  photos: PhotoItem[];
};

type ValidateJson = {
  ok: boolean;
  message: string;
};

type ReviewJson = {
  sufficient: boolean;
  client_message: string;
  besoin: string;
  observations: string;
  vigilance: string[];
  reserves: string;
  extra_photos: PhotoItem[];
};

type PrestationJson = { label: string; detail: string; amount_ht: number };

type FinalizeJson = ReviewJson & {
  titre_predevis: string;
  has_price: boolean;
  price_min_ht: number;
  price_max_ht: number;
  prestations: PrestationJson[];
  disclaimer: string;
  complexity: "simple" | "moyen" | "complexe";
  confidence: "debutant" | "calibre" | "fiable";
  confidence_note: string;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function stripAccents(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "");
}

function clip(value: unknown, max: number) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function extractJson(text: string) {
  const trimmed = String(text || "").trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Réponse IA sans objet JSON");
  return JSON.parse(raw.slice(start, end + 1));
}

function parsePhotoItems(raw: unknown, max: number): PhotoItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const items: PhotoItem[] = [];
  for (const row of raw) {
    if (items.length >= max) break;
    const item = row as { id?: unknown; kind?: unknown; label?: unknown; hint?: unknown };
    const label = clip(item.label, 80);
    const hint = clip(item.hint, 220);
    if (label.length < 4 || hint.length < 12) continue;
    let id = clip(item.id, 40)
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!id) id = "media_" + (items.length + 1);
    if (seen.has(id)) id = id + "_" + (items.length + 1);
    seen.add(id);
    const kind = String(item.kind || "photo").toLowerCase() === "video" ? "video" : "photo";
    items.push({ id, kind, label, hint });
  }
  return items;
}

function padPlan(items: PhotoItem[], intervention: string): PhotoItem[] {
  const extras: PhotoItem[] = [
    { id: "vue_ensemble", kind: "photo", label: "Vue d’ensemble de la zone concernée", hint: "Reculez un peu, de jour, pour situer le chantier." },
    { id: "detail", kind: "photo", label: "Gros plan sur le détail à traiter", hint: "Approchez-vous du point précis, photo nette, sans flash." },
    { id: "contexte", kind: "photo", label: "Contexte technique autour de la zone", hint: "Ce qui se raccorde ou se trouve juste à côté." },
    { id: "acces", kind: "photo", label: "Accès au chantier", hint: "Le passage, l’escalier ou l’allée qui mènera l’artisan sur place." },
    { id: "parcours", kind: "video", label: "Parcours lent de la zone", hint: "Filmez environ 30 secondes, lentement, de l’ensemble vers le détail." },
  ];
  const out = items.slice(0, MAX_PLAN_PHOTOS);
  let i = 0;
  while (out.length < MAX_PLAN_PHOTOS && i < extras.length) {
    const extra = extras[i++];
    if (out.some((x) => x.id === extra.id)) continue;
    out.push({
      ...extra,
      label: extra.kind === "video" ? extra.label : extra.label + (intervention ? " — " + intervention : ""),
    });
  }
  let videos = 0;
  for (const item of out) {
    if (item.kind === "video") {
      videos += 1;
      if (videos > 5) item.kind = "photo";
    }
  }
  return out.slice(0, MAX_PLAN_PHOTOS);
}

function normalizePlan(raw: Record<string, unknown>): PlanJson {
  const photos = padPlan(parsePhotoItems(raw.photos, MAX_PLAN_PHOTOS), clip(raw.intervention, 80));
  if (photos.length < MAX_PLAN_PHOTOS) throw new Error("liste média incomplète");
  return {
    metier: clip(raw.metier, 60) || "Artisanat",
    intervention: clip(raw.intervention, 80) || photos[0].label,
    photos,
  };
}

function normalizeValidate(raw: Record<string, unknown>): ValidateJson {
  const ok = Boolean(raw.ok);
  let message = clip(raw.message, 220);
  if (message.length < 12) {
    message = ok
      ? "Merci, c’est bien lisible. On continue."
      : "Pouvez-vous reprendre la photo un peu plus près, à la lumière du jour ?";
  }
  return { ok, message };
}

function normalizeReview(raw: Record<string, unknown>): ReviewJson {
  const sufficient = Boolean(raw.sufficient);
  const extra = sufficient ? [] : parsePhotoItems(raw.extra_photos, MAX_EXTRA_PHOTOS);
  const vigilance = Array.isArray(raw.vigilance)
    ? raw.vigilance.map((line) => clip(line, 220)).filter((line) => line.length >= 12).slice(0, 5)
    : [];
  return {
    sufficient,
    client_message: clip(raw.client_message, 500) ||
      (sufficient
        ? "Merci, votre dossier est suffisamment complet pour être transmis à l’artisan."
        : "Quelques photos supplémentaires aideraient l’artisan à chiffrer plus sereinement."),
    besoin: clip(raw.besoin, 900),
    observations: clip(raw.observations, 1200),
    vigilance,
    reserves: clip(raw.reserves, 500),
    extra_photos: extra,
  };
}

function asMoney(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

function normalizeFinalize(raw: Record<string, unknown>, allowPrice: boolean): FinalizeJson {
  const review = normalizeReview(raw);
  const complexityRaw = stripAccents(String(raw.complexity || "")).toLowerCase().trim();
  const complexity =
    complexityRaw === "simple" || complexityRaw === "moyen" || complexityRaw === "complexe"
      ? complexityRaw
      : "moyen";
  const confidenceRaw = stripAccents(String(raw.confidence || "")).toLowerCase().trim();
  const confidence =
    confidenceRaw === "debutant" || confidenceRaw === "calibre" || confidenceRaw === "fiable"
      ? confidenceRaw
      : "calibre";

  const requestedPrice = Boolean(raw.has_price) && allowPrice;
  let prestations = Array.isArray(raw.prestations)
    ? raw.prestations
        .map((row) => {
          const item = row as { label?: unknown; detail?: unknown; amount_ht?: unknown };
          const label = clip(item.label, 80);
          const detail = clip(item.detail, 220);
          const amount_ht = allowPrice ? asMoney(item.amount_ht) : 0;
          if (label.length < 4) return null;
          return { label, detail, amount_ht };
        })
        .filter((row): row is PrestationJson => Boolean(row))
        .slice(0, 8)
    : [];

  let price_min_ht = allowPrice ? asMoney(raw.price_min_ht) : 0;
  let price_max_ht = allowPrice ? asMoney(raw.price_max_ht) : 0;
  let has_price = requestedPrice && prestations.length > 0 && (price_min_ht > 0 || price_max_ht > 0);

  if (!has_price) {
    price_min_ht = 0;
    price_max_ht = 0;
    prestations = prestations.map((row) => ({ ...row, amount_ht: 0 }));
  } else if (price_min_ht > price_max_ht) {
    const t = price_min_ht;
    price_min_ht = price_max_ht;
    price_max_ht = t;
  }

  const titre_predevis =
    clip(raw.titre_predevis, 80) || clip(raw.intervention, 80) || "Votre intervention";

  const disclaimer = clip(raw.disclaimer, 400) ||
    (has_price
      ? "Ce prédevis est indicatif et non contractuel. Les montants pourront évoluer après confirmation de l’artisan."
      : "Ce prédevis décrit les travaux envisagés. Il n’est pas un devis : l’artisan reste seul décisionnaire.");

  return {
    ...review,
    titre_predevis,
    has_price,
    price_min_ht,
    price_max_ht,
    prestations,
    disclaimer,
    complexity,
    confidence,
    confidence_note: clip(raw.confidence_note, 400),
  };
}

function parseDataUrl(value: string): ImagePart | null {
  const match = String(value || "").match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) return null;
  let media = match[1].toLowerCase();
  if (media === "image/jpg") media = "image/jpeg";
  if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(media)) return null;
  return { media_type: media, data: match[2].replace(/\s+/g, "") };
}

function imageMediaType(mime: string, filename: string) {
  const lower = (mime || "").toLowerCase();
  if (lower === "image/jpg" || lower === "image/jpeg") return "image/jpeg";
  if (lower === "image/png" || lower === "image/gif" || lower === "image/webp") return lower;
  const name = (filename || "").toLowerCase();
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".gif")) return "image/gif";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  return "";
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x2000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function callClaude(
  apiKey: string,
  system: string,
  dossier: string,
  images: ImagePart[],
  normalize: (raw: Record<string, unknown>) => unknown
) {
  const content: Array<Record<string, unknown>> = [{ type: "text", text: dossier }];
  for (const image of images.slice(0, MAX_PHOTOS)) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: image.media_type, data: image.data },
    });
  }
  const userMessage = { role: "user" as const, content };
  const run = async (messages: unknown[]) => {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2048,
        temperature: 0,
        system,
        messages,
      }),
    });
    const body = await response.json();
    if (!response.ok) {
      const message = body?.error?.message || JSON.stringify(body).slice(0, 300);
      throw new Error("Claude HTTP " + response.status + " : " + message);
    }
    return Array.isArray(body.content)
      ? body.content.map((part: { text?: string }) => part.text || "").join("")
      : "";
  };

  const firstText = await run([userMessage]);
  try {
    return normalize(extractJson(firstText) as Record<string, unknown>);
  } catch {
    const retryText = await run([
      userMessage,
      { role: "assistant", content: firstText || "{}" },
      {
        role: "user",
        content: "Réponse invalide. Renvoie UNIQUEMENT l’objet JSON du schéma, sans markdown.",
      },
    ]);
    return normalize(extractJson(retryText) as Record<string, unknown>);
  }
}

function collectClientImages(payload: { images?: unknown; image?: unknown }): ImagePart[] {
  const list: unknown[] = [];
  if (Array.isArray(payload.images)) list.push(...payload.images);
  if (payload.image) list.push(payload.image);
  const out: ImagePart[] = [];
  for (const entry of list) {
    if (out.length >= MAX_PHOTOS) break;
    if (typeof entry === "string") {
      const parsed = parseDataUrl(entry);
      if (parsed) out.push(parsed);
      continue;
    }
    const row = entry as { data_url?: string; dataUrl?: string; media_type?: string; data?: string };
    const fromUrl = parseDataUrl(row.data_url || row.dataUrl || "");
    if (fromUrl) {
      out.push(fromUrl);
      continue;
    }
    if (row.media_type && row.data) {
      out.push({ media_type: String(row.media_type), data: String(row.data) });
    }
  }
  return out;
}

async function loadLeadImages(
  supabase: ReturnType<typeof createClient>,
  photos: Array<Record<string, unknown>>
) {
  const images: ImagePart[] = [];
  const notes: string[] = [];
  const sorted = photos.slice().sort(
    (a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)
  );
  for (const photo of sorted) {
    if (images.length >= MAX_PHOTOS) break;
    if (photo.kind === "video" || String(photo.mime_type || "").startsWith("video/")) continue;
    const mediaType = imageMediaType(String(photo.mime_type || ""), String(photo.filename || ""));
    if (!mediaType || !photo.storage_path) continue;
    const { data: file, error } = await supabase.storage
      .from(BUCKET)
      .download(String(photo.storage_path));
    if (error || !file || file.size > MAX_PHOTO_BYTES) continue;
    const bytes = new Uint8Array(await file.arrayBuffer());
    images.push({ media_type: mediaType, data: bytesToBase64(bytes) });
    notes.push(String(photo.titre || photo.filename || "photo " + images.length));
  }
  return { images, notes };
}

function publicReview(review: ReviewJson) {
  return {
    ok: true,
    sufficient: review.sufficient,
    client_message: review.client_message,
    besoin: review.besoin,
    observations: review.observations,
    vigilance: review.vigilance,
    reserves: review.reserves,
    extra_photos: review.extra_photos,
  };
}

function publicFinalize(estimate: FinalizeJson, meta?: { estimate_id?: number; public_id?: string }) {
  return {
    ...publicReview(estimate),
    public_id: (meta && meta.public_id) || "",
    estimate_id: (meta && meta.estimate_id) || null,
    has_price: estimate.has_price,
    disclaimer: estimate.disclaimer,
    titre_predevis: estimate.titre_predevis,
    estimate: {
      has_price: estimate.has_price,
      titre_predevis: estimate.titre_predevis,
      price_min_ht: estimate.has_price ? estimate.price_min_ht : null,
      price_max_ht: estimate.has_price ? estimate.price_max_ht : null,
      complexity: estimate.complexity,
      confidence: estimate.confidence,
      confidence_note: estimate.confidence_note,
      observations: [estimate.besoin, estimate.observations].filter(Boolean).join("\n\n"),
      client_summary: estimate.client_message,
      besoin: estimate.besoin,
      vigilance: estimate.vigilance,
      reserves: estimate.reserves,
      disclaimer: estimate.disclaimer,
      sufficient: estimate.sufficient,
      prestations: estimate.prestations,
      flags: estimate.vigilance.map((message) => ({ kind: "recommandation" as const, message })),
    },
  };
}

async function saveEstimate(
  supabase: ReturnType<typeof createClient>,
  leadId: number,
  estimate: FinalizeJson
) {
  await supabase.from("dv_ai_estimates").delete().eq("lead_id", leadId);

  const base = {
    lead_id: leadId,
    complexity: estimate.complexity,
    confidence: estimate.confidence,
    confidence_note: estimate.confidence_note,
    observations: [estimate.besoin, estimate.observations, estimate.reserves]
      .filter(Boolean)
      .join("\n\n"),
    price_min_ht: estimate.has_price ? estimate.price_min_ht : 0,
    price_max_ht: estimate.has_price ? estimate.price_max_ht : 0,
  };

  const withExtras = {
    ...base,
    client_summary: estimate.client_message,
    dossier_suffisant: estimate.sufficient,
    has_price: estimate.has_price,
    titre_predevis: estimate.titre_predevis,
  };

  let inserted: { id: number } | null = null;
  let insErr: { message?: string } | null = null;
  const first = await supabase.from("dv_ai_estimates").insert(withExtras).select("id").single();
  inserted = first.data as { id: number } | null;
  insErr = first.error;
  if (insErr) {
    const retry = await supabase.from("dv_ai_estimates").insert(base).select("id").single();
    inserted = retry.data as { id: number } | null;
    insErr = retry.error;
  }
  if (insErr || !inserted) throw insErr || new Error("insert estimate vide");

  if (estimate.prestations.length) {
    const rows = estimate.prestations.map((row, index) => ({
      estimate_id: inserted!.id,
      sort_order: index + 1,
      label: row.label,
      detail: row.detail || "",
      amount_ht: estimate.has_price ? row.amount_ht : 0,
    }));
    const withDetail = await supabase.from("dv_ai_prestations").insert(rows);
    if (withDetail.error) {
      await supabase.from("dv_ai_prestations").insert(
        rows.map((row) => ({
          estimate_id: row.estimate_id,
          sort_order: row.sort_order,
          label: row.label,
          amount_ht: row.amount_ht,
        }))
      );
    }
  }

  const flags = estimate.vigilance.map((message) => ({
    estimate_id: inserted.id,
    kind: "recommandation",
    message,
  }));
  if (estimate.reserves) {
    flags.push({
      estimate_id: inserted.id,
      kind: "alerte",
      message: estimate.reserves,
    });
  }
  if (flags.length) {
    await supabase.from("dv_ai_flags").insert(flags.slice(0, 6));
  }

  return inserted.id;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Méthode non supportée" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") || "";
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ ok: false, error: "Supabase mal configuré" }, 500);
  }
  if (!anthropicKey) {
    return jsonResponse({ ok: false, error: "ANTHROPIC_API_KEY manquant" }, 500);
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "JSON attendu" }, 400);
  }

  const action = clip(payload.action, 40) || "plan";
  const description = clip(payload.description || payload.details, 4000);
  const artisanMetier = clip(payload.metier, 80);
  const artisanRef = clip(payload.artisan_ref || payload.artisanRef, 80);
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    if (!payload.metier && artisanRef) {
      const { data } = await supabase
        .from("dv_artisans")
        .select("metier")
        .or("public_id.eq." + artisanRef + ",slug.eq." + artisanRef)
        .maybeSingle();
      payload.metier = clip(data && (data as { metier?: string }).metier, 80) || artisanMetier;
    }

    const media = await tryHandleMediaQualify(payload, { apiKey: anthropicKey, cors: CORS });
    if (media) return media;

    if (action === "plan") {
      if (description.length < 8) {
        return jsonResponse({ ok: false, error: "Décrivez d’abord votre besoin." }, 400);
      }
      let metier = artisanMetier;
      if (!metier && artisanRef) {
        const { data } = await supabase
          .from("dv_artisans")
          .select("metier")
          .or("public_id.eq." + artisanRef + ",slug.eq." + artisanRef)
          .maybeSingle();
        metier = clip(data && (data as { metier?: string }).metier, 80);
      }
      const dossier = [
        "Description du client :",
        description,
        "",
        "Métier de l’artisan (indicatif, à confirmer selon le besoin) : " + (metier || "non précisé"),
      ].join("\n");
      const plan = (await callClaude(anthropicKey, PLAN_PROMPT, dossier, [], (raw) =>
        normalizePlan(raw)
      )) as PlanJson;
      return jsonResponse({ ok: true, ...plan });
    }

    if (action === "validate_photo") {
      const label = clip(payload.label, 80);
      const hint = clip(payload.hint, 220);
      const images = collectClientImages(payload);
      if (!images.length) return jsonResponse({ ok: false, error: "Photo manquante." }, 400);
      if (!label) return jsonResponse({ ok: false, error: "Élément photo manquant." }, 400);
      const dossier = [
        "Élément attendu : " + label,
        hint ? "Conseil donné au client : " + hint : "",
        description ? "Contexte du besoin : " + description : "",
        "Analyse uniquement la photo jointe pour cet élément.",
      ]
        .filter(Boolean)
        .join("\n");
      const result = (await callClaude(
        anthropicKey,
        VALIDATE_PROMPT,
        dossier,
        images.slice(0, 1),
        (raw) => normalizeValidate(raw)
      )) as ValidateJson;
      return jsonResponse({ ok: true, accepted: result.ok, message: result.message });
    }

    if (action === "review") {
      if (description.length < 8) {
        return jsonResponse({ ok: false, error: "Description manquante." }, 400);
      }
      const images = collectClientImages(payload);
      const labels = Array.isArray(payload.photo_labels)
        ? (payload.photo_labels as unknown[]).map((x) => clip(x, 80)).filter(Boolean)
        : [];
      const extraAlready = Math.max(0, Number(payload.extra_taken) || 0);
      const dossier = [
        "Description du client :",
        description,
        "",
        "Photos jointes, dans l’ordre : " + (labels.join(" · ") || "sans libellé"),
        "Éléments supplémentaires déjà demandés dans ce parcours : " + String(extraAlready),
        extraAlready >= MAX_EXTRA_PHOTOS
          ? "Le plafond de photos supplémentaires est atteint : ne demande plus d’extra_photos, pose des réserves si besoin."
          : "Tu peux demander au plus " + String(Math.min(MAX_EXTRA_PHOTOS, MAX_EXTRA_PHOTOS - extraAlready)) + " extra_photos.",
      ].join("\n");
      const review = (await callClaude(anthropicKey, REVIEW_PROMPT, dossier, images, (raw) =>
        normalizeReview(raw)
      )) as ReviewJson;
      if (extraAlready >= MAX_EXTRA_PHOTOS) {
        review.extra_photos = [];
        if (!review.sufficient && !review.reserves) {
          review.reserves =
            "Dossier transmis malgré quelques zones d’ombre : confirmer sur place les points non visibles.";
        }
      } else if (review.extra_photos.length > MAX_EXTRA_PHOTOS - extraAlready) {
        review.extra_photos = review.extra_photos.slice(0, MAX_EXTRA_PHOTOS - extraAlready);
      }
      return jsonResponse(publicReview(review));
    }

    if (action === "finalize") {
      const publicId = clip(payload.public_id || payload.publicId, 80);
      const leadId = Number(payload.lead_id || 0);
      if (!publicId && !leadId) {
        return jsonResponse({ ok: false, error: "public_id requis" }, 400);
      }
      let leadQuery = supabase.from("dv_leads").select(
        "id, public_id, details, artisan_id, dv_lead_travaux(travaux), dv_photos(id, kind, titre, filename, mime_type, storage_path, sort_order)"
      );
      leadQuery = publicId ? leadQuery.eq("public_id", publicId) : leadQuery.eq("id", leadId);
      const { data: lead, error: leadErr } = await leadQuery.maybeSingle();
      if (leadErr) return jsonResponse({ ok: false, error: leadErr.message }, 500);
      if (!lead) return jsonResponse({ ok: false, error: "Demande introuvable" }, 404);

      let artisan: { metier?: string; tarif_grid?: string; display_name?: string } | null = null;
      if ((lead as { artisan_id?: number }).artisan_id) {
        const art = await supabase
          .from("dv_artisans")
          .select("metier, tarif_grid, display_name")
          .eq("id", (lead as { artisan_id: number }).artisan_id)
          .maybeSingle();
        artisan = (art.data as typeof artisan) || null;
      }
      const tarif = clip(artisan && artisan.tarif_grid, 8000);
      const allowPrice = tarif.length > 8;
      const travaux = ((lead as { dv_lead_travaux?: { travaux?: string }[] }).dv_lead_travaux || [])
        .map((row) => row.travaux)
        .filter(Boolean);
      const { images, notes } = await loadLeadImages(
        supabase,
        ((lead as { dv_photos?: Record<string, unknown>[] }).dv_photos || []) as Record<string, unknown>[]
      );
      const need = clip(payload.description, 4000) || clip((lead as { details?: string }).details, 4000);
      const dossier = [
        "Description du client :",
        need || "non précisée",
        "",
        "Intervention / travaux : " + (travaux.join(" · ") || "non précisé"),
        "Métier artisan : " + clip(artisan && artisan.metier, 80),
        "Photos : " + (notes.join(" · ") || "aucune"),
        "",
        allowPrice
          ? "Grille tarifaire de l’artisan (seule base autorisée pour chiffrer) :\n" + tarif
          : "Grille tarifaire artisan : aucune. Interdiction absolue de donner un prix, une fourchette ou un barème. has_price = false.",
      ].join("\n");

      const estimate = (await callClaude(
        anthropicKey,
        FINALIZE_PROMPT,
        dossier,
        images,
        (raw) => normalizeFinalize(raw, allowPrice)
      )) as FinalizeJson;

      if (!allowPrice) {
        estimate.has_price = false;
        estimate.price_min_ht = 0;
        estimate.price_max_ht = 0;
        estimate.prestations = estimate.prestations.map((row) => ({ ...row, amount_ht: 0 }));
      }

      const estimateId = await saveEstimate(supabase, Number((lead as { id: number }).id), estimate);
      await supabase.from("dv_lead_events").insert({
        lead_id: (lead as { id: number }).id,
        kind: "analyse_ia",
        message: "Dossier qualifié — synthèse transmise à l’artisan",
      });

      return jsonResponse(
        publicFinalize(estimate, {
          estimate_id: estimateId,
          public_id: String((lead as { public_id?: string }).public_id || publicId),
        })
      );
    }

    return jsonResponse({ ok: false, error: "Action inconnue" }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
