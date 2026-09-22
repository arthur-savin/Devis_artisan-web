const MODEL = "claude-sonnet-4-6";
export const PLAN_COUNT = 5;
const MAX_PHOTOS = 8;
const MAX_EXTRA = 3;
const MAX_VIDEOS = 5;

const TONE = `Ton toujours bienveillant. Vouvoiement client. Jamais de prix.`;

export const PLAN_PROMPT = `Tu prépares une capture guidée pour un devis artisan à distance, comme si tu étais sur place pour un constat.
${TONE}

MISSION
À partir de la description libre (et du métier de l’artisan s’il est connu), produis EXACTEMENT ${PLAN_COUNT} captures — pas une de plus, pas une de moins.
Mélange photos et vidéos selon ce qui sert le constat réel :
- photo : élément figé (détail, ensemble, raccord, accès)
- vidéo : si un mouvement, un parcours ou un écoulement apporte plus qu’une photo (cheminement d’une fuite, tour de toiture, tirage de ligne, jeu d’un ouvrant). Environ 30 secondes, lentement, filmée dans le formulaire web en 720p (pas d’import 4K). Maximum ${MAX_VIDEOS} vidéos : les 5 questions peuvent être des vidéos si le constat l’exige. Souvent 3–4 photos + 1–2 vidéos, ou 5 photos si tout est statique.

Choisis les 5 vues qu’un artisan prendrait pour chiffrer sans se déplacer :
1. situation d’ensemble
2. gros plan du désordre / de la zone à traiter
3. contexte technique (tableau, raccord, sous-face, naissance, etc. selon le métier)
4. accès / environnement du chantier
5. angle complémentaire utile à CETTE demande (pas une vue générique)

Adapte-toi strictement aux mots du client (pièce, matériau, symptôme). Interdit : liste fixe copiée d’un métier.

SORTIE — UNIQUEMENT un JSON valide, sans markdown.
{
  "metier": string,
  "intervention": string,
  "photos": [ { "id": string, "kind": "photo" | "video", "label": string, "hint": string } ]
}

- photos : tableau de longueur EXACTEMENT ${PLAN_COUNT}
- kind : "photo" ou "video"
- id : snake_case unique
- label : 4 à 60 caractères, ce qu’il faut filmer ou photographier
- hint : une phrase concrète (cadrage, lumière, durée d’environ 30 secondes si vidéo)`;

const VALIDATE_PROMPT = `Tu vérifies UNE capture (photo, ou images extraites d’une courte vidéo) pour un devis à distance.
${TONE}
Convient si on reconnaît l’élément demandé, net, assez proche, lumière suffisante.
Sinon : une phrase bienveillante pour corriger (jamais « refusé »).

SORTIE JSON uniquement :
{ "ok": boolean, "message": string }`;

const REVIEW_PROMPT = `Tu relis description + captures. Le dossier suffit-il à chiffrer sans visite ?
${TONE}
Si non : 1 à ${MAX_EXTRA} extra_photos (kind photo ou video). Aucun prix.

SORTIE JSON uniquement :
{
  "sufficient": boolean,
  "client_message": string,
  "besoin": string,
  "observations": string,
  "vigilance": [string],
  "reserves": string,
  "extra_photos": [ { "id": string, "kind": "photo" | "video", "label": string, "hint": string } ]
}`;

export type MediaItem = { id: string; kind: "photo" | "video"; label: string; hint: string };
type ImagePart = { media_type: string; data: string };

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

function parseItems(raw: unknown, max: number): MediaItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const items: MediaItem[] = [];
  for (const row of raw) {
    if (items.length >= max) break;
    const item = row as { id?: unknown; kind?: unknown; label?: unknown; hint?: unknown };
    const label = clip(item.label, 80);
    const hint = clip(item.hint, 220);
    if (label.length < 4 || hint.length < 12) continue;
    let id = clip(item.id, 40).toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
    if (!id) id = "media_" + (items.length + 1);
    if (seen.has(id)) id = id + "_" + (items.length + 1);
    seen.add(id);
    const kind = String(item.kind || "photo").toLowerCase() === "video" ? "video" : "photo";
    items.push({ id, kind, label, hint });
  }
  return items;
}

function padPlan(items: MediaItem[], intervention: string): MediaItem[] {
  const extras: MediaItem[] = [
    { id: "vue_ensemble", kind: "photo", label: "Vue d’ensemble de la zone concernée", hint: "Reculez un peu, de jour, pour situer le chantier." },
    { id: "detail", kind: "photo", label: "Gros plan sur le détail à traiter", hint: "Approchez-vous du point précis, photo nette, sans flash." },
    { id: "contexte", kind: "photo", label: "Contexte technique autour de la zone", hint: "Ce qui se raccorde ou se trouve juste à côté (rive, tableau, raccord, sous-face)." },
    { id: "acces", kind: "photo", label: "Accès au chantier", hint: "Le passage, l’escalier ou l’allée qui mènera l’artisan sur place." },
    { id: "parcours", kind: "video", label: "Parcours lent de la zone", hint: "Filmez environ 30 secondes, lentement, de l’ensemble vers le détail." },
  ];
  const out = items.slice(0, PLAN_COUNT);
  let i = 0;
  while (out.length < PLAN_COUNT && i < extras.length) {
    const extra = extras[i++];
    if (out.some((x) => x.id === extra.id)) continue;
    extra.label = extra.kind === "video" ? extra.label : extra.label + (intervention ? " — " + intervention : "");
    out.push(extra);
  }
  let videos = 0;
  for (const item of out) {
    if (item.kind === "video") {
      videos += 1;
      if (videos > MAX_VIDEOS) item.kind = "photo";
    }
  }
  return out.slice(0, PLAN_COUNT);
}

function parseDataUrl(value: string): ImagePart | null {
  const match = String(value || "").match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) return null;
  let media = match[1].toLowerCase();
  if (media === "image/jpg") media = "image/jpeg";
  if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(media)) return null;
  return { media_type: media, data: match[2].replace(/\s+/g, "") };
}

function collectImages(payload: Record<string, unknown>): ImagePart[] {
  const list: unknown[] = [];
  if (Array.isArray(payload.images)) list.push(...payload.images);
  if (payload.image) list.push(payload.image);
  const out: ImagePart[] = [];
  for (const entry of list) {
    if (out.length >= MAX_PHOTOS) break;
    if (typeof entry === "string") {
      const parsed = parseDataUrl(entry);
      if (parsed) out.push(parsed);
    }
  }
  return out;
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
      { role: "user", content: "Réponse invalide. Renvoie UNIQUEMENT l’objet JSON du schéma, sans markdown." },
    ]);
    return normalize(extractJson(retryText) as Record<string, unknown>);
  }
}

function jsonOf(cors: Record<string, string>, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

export async function tryHandleMediaQualify(
  payload: Record<string, unknown>,
  ctx: { apiKey: string; cors: Record<string, string> }
): Promise<Response | null> {
  const action = clip(payload.action, 40);
  if (action !== "plan" && action !== "validate_photo" && action !== "review") return null;

  const description = clip(payload.description || payload.details, 4000);
  const metier = clip(payload.metier, 80);

  if (action === "plan") {
    if (description.length < 8) {
      return jsonOf(ctx.cors, { ok: false, error: "Décrivez d’abord votre besoin." }, 400);
    }
    const dossier = [
      "Description du client :",
      description,
      "",
      "Métier de l’artisan (indicatif) : " + (metier || "non précisé"),
      "Tu dois renvoyer EXACTEMENT " + PLAN_COUNT + " captures.",
    ].join("\n");
    const raw = (await callClaude(ctx.apiKey, PLAN_PROMPT, dossier, [], (row) => row)) as Record<string, unknown>;
    const items = padPlan(parseItems(raw.photos, PLAN_COUNT), clip(raw.intervention, 80));
    if (items.length < PLAN_COUNT) throw new Error("liste média incomplète");
    return jsonOf(ctx.cors, {
      ok: true,
      metier: clip(raw.metier, 60) || metier || "Artisanat",
      intervention: clip(raw.intervention, 80) || items[0].label,
      photos: items,
    });
  }

  if (action === "validate_photo") {
    const label = clip(payload.label, 80);
    const hint = clip(payload.hint, 220);
    const kind = clip(payload.kind, 12) === "video" ? "video" : "photo";
    const images = collectImages(payload);
    if (!images.length) return jsonOf(ctx.cors, { ok: false, error: "Média manquant." }, 400);
    if (!label) return jsonOf(ctx.cors, { ok: false, error: "Élément manquant." }, 400);
    const dossier = [
      "Élément attendu : " + label + " (" + kind + ")",
      hint ? "Conseil donné au client : " + hint : "",
      description ? "Contexte : " + description : "",
      kind === "video"
        ? "Les images jointes sont des extraits d’une courte vidéo (environ 30 secondes, 720p). Juge si le parcours montre bien l’élément."
        : "Analyse la photo jointe.",
    ]
      .filter(Boolean)
      .join("\n");
    const result = (await callClaude(ctx.apiKey, VALIDATE_PROMPT, dossier, images.slice(0, 2), (row) => ({
      ok: Boolean(row.ok),
      message: clip(row.message, 220) || (row.ok
        ? "Merci, c’est bien lisible. On continue."
        : "Pouvez-vous reprendre un peu plus près, à la lumière du jour ?"),
    }))) as { ok: boolean; message: string };
    return jsonOf(ctx.cors, { ok: true, accepted: result.ok, message: result.message });
  }

  if (action === "review") {
    if (description.length < 8) {
      return jsonOf(ctx.cors, { ok: false, error: "Description manquante." }, 400);
    }
    const images = collectImages(payload);
    const labels = Array.isArray(payload.photo_labels)
      ? (payload.photo_labels as unknown[]).map((x) => clip(x, 80)).filter(Boolean)
      : [];
    const extraAlready = Math.max(0, Number(payload.extra_taken) || 0);
    const dossier = [
      "Description du client :",
      description,
      "",
      "Captures, dans l’ordre : " + (labels.join(" · ") || "sans libellé"),
      "Compléments déjà demandés : " + String(extraAlready),
    ].join("\n");
    const raw = (await callClaude(ctx.apiKey, REVIEW_PROMPT, dossier, images, (row) => row)) as Record<string, unknown>;
    const sufficient = Boolean(raw.sufficient);
    let extra = sufficient ? [] : parseItems(raw.extra_photos, Math.min(MAX_EXTRA, Math.max(0, MAX_EXTRA - extraAlready)));
    if (extraAlready >= MAX_EXTRA) extra = [];
    return jsonOf(ctx.cors, {
      ok: true,
      sufficient,
      client_message: clip(raw.client_message, 500),
      besoin: clip(raw.besoin, 900),
      observations: clip(raw.observations, 1200),
      vigilance: Array.isArray(raw.vigilance)
        ? raw.vigilance.map((line) => clip(line, 220)).filter((line) => line.length >= 12).slice(0, 5)
        : [],
      reserves: clip(raw.reserves, 500),
      extra_photos: extra,
    });
  }

  return null;
}
