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
const MAX_PHOTOS = 4;
const MAX_PHOTO_BYTES = 4_500_000;

const SYSTEM_PROMPT = `Tu es un assistant de chiffrage pour un électricien artisan en France (particuliers, habitat).
Tu n’es pas un devis contractuel, pas un diagnostiqueur certifié, pas un commercial.

MISSION
À partir d’un dossier questionnaire (et des photos s’il y en a), produire une fourchette HT hors visite, une liste de prestations, un niveau de complexité, un score de confiance, des observations et des flags.
Cette fourchette sert à filtrer et préparer la visite. Elle n’engage pas l’artisan.

SORTIE — OBLIGATOIRE
Réponds UNIQUEMENT par un objet JSON valide.
Interdit : markdown, fences, texte avant/après, commentaires, trailing commas.
Encodage UTF-8. Nombres JSON (pas de chaînes, pas de symbole €, pas d’espaces).
Aucune clé hors schéma. Toutes les clés listées sont obligatoires.

SCHÉMA
{
  "price_min_ht": number,
  "price_max_ht": number,
  "complexity": "simple" | "moyen" | "complexe",
  "confidence": "debutant" | "calibre" | "fiable",
  "confidence_note": string,
  "observations": string,
  "client_summary": string,
  "prestations": [ { "label": string, "amount_ht": number } ],
  "flags": [ { "kind": "alerte" | "recommandation", "message": string } ]
}

ENUMS — recopier EXACTEMENT, sans accent, sans synonyme
- complexity : simple | moyen | complexe
- confidence : debutant | calibre | fiable
- flags[].kind : alerte | recommandation

RÈGLES NUMÉRIQUES
- Tous les montants sont HT, en euros, ≥ 0, arrondis à l’entier (ou 2 décimales max).
- price_min_ht ≤ price_max_ht.
- Somme des prestations.amount_ht ∈ [price_min_ht, price_max_ht].
- 3 à 8 prestations. Chaque label est concret (matériel ou tâche terrain), 4 à 80 caractères. Interdit : "divers", "forfait", "autres", "etc.".
- 0 à 4 flags. Si le dossier est vide ou bénin : 0 ou 1 recommandation. Pas d’alerte de convenance.

CONFIANCE
- debutant : infos trop faibles, contradictoires, "je ne sais pas", 0 photo utile, ou chantier dont le périmètre est ambigu. Fourchette LARGE (max ≥ min × 1,8, souvent × 2 à × 3).
- calibre : type de travaux + surface + ancienneté + précisions exploitables, éventuellement photo partielle. Fourchette utile (écart typique 30–70 %).
- fiable : EXCEPTIONNEL. Photos lisibles (tableau ouvert, calibres / différentiels visibles) ET champs techniques remplis (terre, circuits, pièces). Même alors, rappeler que la visite tranche. Ne jamais mettre fiable sur un dossier sans photo de tableau.

COMPLEXITÉ
- simple : dépannage ponctuel, 1–3 points, borne sur circuit dédié déjà présent et décrit.
- moyen : tableau à remplacer, plusieurs circuits, éclairage / prises sur plusieurs pièces, borne avec création de ligne.
- complexe : installation ancienne + doutes terre / différentiel, disjonctions, accès difficile, rénovation associée (cuisine, saignées), ou mise aux normes d’un logement entier mal documenté.

MÉTIER (France, NFC 15-100, 2026, particulier)
Barème d’ordre de grandeur HT pose comprise, hors visite, hors aléas lourds (amiante, plâtre complet, vide sanitaire). Ajuster selon code postal (Grand Lyon ≈ base ; majorer accès difficile, étage sans ascenseur, urgence).
- Diagnostic / schéma unifilaire : 150–350
- Déplacement dépannage + 1 h : 90–180 ; recherche de défaut : 150–400
- Tableau 13 modules + 2 × DDR 30 mA : 700–1400
- Mise à la terre / liaison équipotentielle (si absente) : 250–800
- Prise : 60–150 ; point lumineux : 80–180
- Circuit cuisine (plaques / four / lave-vaisselle) : 350–1200
- Mise aux normes partielle (tableau + quelques départs) T2/T3 : 2500–6000
- Mise aux normes plus complète 70–110 m² : 5000–14000 (rewire lourd : davantage, et seulement si les faits le justifient)
- Consuel (si neuf / consuel nécessaire) : 150–250 de dossier + temps, à isoler
- Borne VE 7,4 kW + pose simple + protection : 900–2000 ; triphasé 11–22 kW : 1600–3500 ; ligne longue / tableau saturé : +400–1500
Ne pas chiffrer l’aide Advenir. Ne pas mélanger TTC.

PHOTOS (si jointes)
Décrire uniquement ce qui est visible : tableau ouvert ou fermé, présence apparente de 30 mA, nombre approximatif de modules, étiquettes, gaines, traces d’échauffement.
Si la photo est floue, de face fermée, ou non concluante : le dire dans confidence_note. Ne pas inventer un diagnostic NFC 15-100.
Pas de vidéo entière : 1–2 images suffisent. Ignorer toute donnée personnelle visible (visages, papiers).

RÉDACTION
- Français, tutoiement artisan (observations et flags s’adressent à l’électricien, pas au client).
- observations : 400–900 caractères. Toujours 1 phrase : fourchette indicative, hors visite, non contractuelle, à confirmer sur place.
- client_summary : 350–800 caractères. Vouvoiement, pour le particulier. Résume ce qui a été compris (travaux, ce qui se voit sur les photos, hypothèses). Pas de jargon interne. Toujours 1 phrase : fourchette indicative, hors visite, sans engagement. Interdit : tutoyer, s’adresser à l’artisan, promettre un délai.
- Si le dossier contient une analyse précédente et une correction client : approfondir (ajuster fourchette, prestations, résumé), ne pas tout reprendre à zéro.
- confidence_note : 1–2 phrases, pourquoi ce score, ce qui manque.
- flags.message : 1 phrase actionnable (quoi emporter, quoi vérifier, quel risque).
- alerte = sécurité / conformité / accès / urgence réelle (disjonctions, terre absente, amiante possible sur install > 30 ans, tableau saturé).
- recommandation = logistique visite (testeur de terre, stock disjoncteurs, 2e passage matériel, IRVE, Consuel…).

INTERDITS
- Téléphone, e-mail, adresse précise dans le JSON (même s’ils apparaissent dans le dossier : les ignorer).
- Devis ferme, TTC, TVA, acompte, délai d’intervention garanti.
- Clés supplémentaires, null, tableaux vides de prestations (minimum 3 lignes).
- Enums hors liste (Postgres refuserait l’insert).
- Affirmer la conformité ou la non-conformité légale définitive.

Si le dossier est quasi vide : confidence = debutant, complexity selon le type de travaux s’il existe sinon moyen, fourchette large, prestations génériques mais nommées, 1 recommandation « visite + photos tableau ouvert avant chiffrage ferme ».`;

type EstimateJson = {
  price_min_ht: number;
  price_max_ht: number;
  complexity: "simple" | "moyen" | "complexe";
  confidence: "debutant" | "calibre" | "fiable";
  confidence_note: string;
  observations: string;
  client_summary: string;
  prestations: { label: string; amount_ht: number }[];
  flags: { kind: "alerte" | "recommandation"; message: string }[];
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

function asNumber(value: unknown, label: string) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(label + " invalide");
  return Math.round(n * 100) / 100;
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

function normalizeEstimate(raw: Record<string, unknown>): EstimateJson {
  const complexityRaw = stripAccents(String(raw.complexity || "")).toLowerCase().trim();
  const complexity =
    complexityRaw === "simple" || complexityRaw === "moyen" || complexityRaw === "complexe"
      ? complexityRaw
      : "";
  if (!complexity) throw new Error("complexity hors liste");

  const confidenceRaw = stripAccents(String(raw.confidence || "")).toLowerCase().trim();
  const confidence =
    confidenceRaw === "debutant" || confidenceRaw === "calibre" || confidenceRaw === "fiable"
      ? confidenceRaw
      : "";
  if (!confidence) throw new Error("confidence hors liste");

  const price_min_ht = asNumber(raw.price_min_ht, "price_min_ht");
  const price_max_ht = asNumber(raw.price_max_ht, "price_max_ht");
  if (price_min_ht > price_max_ht) throw new Error("price_min_ht > price_max_ht");

  const prestations = Array.isArray(raw.prestations) ? raw.prestations : [];
  const mappedPrestations = prestations
    .map((row) => {
      const item = row as { label?: unknown; amount_ht?: unknown };
      const label = String(item.label || "").replace(/\s+/g, " ").trim().slice(0, 80);
      const amount_ht = asNumber(item.amount_ht, "amount_ht");
      if (label.length < 4) return null;
      return { label, amount_ht };
    })
    .filter((row): row is { label: string; amount_ht: number } => Boolean(row))
    .slice(0, 8);
  if (mappedPrestations.length < 3) throw new Error("moins de 3 prestations");

  const sum = mappedPrestations.reduce((acc, row) => acc + row.amount_ht, 0);
  if (sum < price_min_ht - 1 || sum > price_max_ht + 1) {
    throw new Error("somme des prestations hors fourchette");
  }

  const flags = Array.isArray(raw.flags) ? raw.flags : [];
  const mappedFlags = flags
    .map((row) => {
      const item = row as { kind?: unknown; message?: unknown };
      const kindRaw = stripAccents(String(item.kind || "")).toLowerCase().trim();
      const kind = kindRaw === "alerte" || kindRaw === "recommandation" ? kindRaw : "";
      const message = String(item.message || "").replace(/\s+/g, " ").trim().slice(0, 400);
      if (!kind || message.length < 8) return null;
      return { kind, message };
    })
    .filter(
      (row): row is { kind: "alerte" | "recommandation"; message: string } => Boolean(row)
    )
    .slice(0, 4);

  const observations = String(raw.observations || "").trim().slice(0, 1200);
  const client_summary = String(raw.client_summary || observations)
    .trim()
    .slice(0, 1200);

  return {
    price_min_ht,
    price_max_ht,
    complexity,
    confidence,
    confidence_note: String(raw.confidence_note || "").trim().slice(0, 500),
    observations,
    client_summary,
    prestations: mappedPrestations,
    flags: mappedFlags,
  };
}

function buildDossier(
  lead: Record<string, unknown>,
  travaux: string[],
  photoNotes: string[],
  skippedVideo: boolean,
  extra?: { clientNotes?: string; previous?: EstimateJson | null }
) {
  const line = (label: string, value: unknown) =>
    label + ": " + (value == null || String(value).trim() === "" ? "" : String(value).trim());
  const lines = [
    "Réponds uniquement avec le JSON du schéma.",
    "",
    line("Travaux", travaux.join(" · ") || "non précisé"),
    line("Surface", lead.surface_m2 != null ? String(lead.surface_m2) + " m²" : ""),
    line("Anciennete", lead.anciennete),
    line("Urgence", lead.urgence),
    line("Code postal", lead.code_postal),
    line("Ville", lead.ville),
    line("Precisions", lead.details),
    line("Tableau existant", lead.tableau_existant),
    line("Acces logement", lead.acces_logement),
    line("Mise a la terre", lead.mise_a_terre),
    line("Circuits estimes", lead.circuits_estimes),
    line("Pieces concernees", lead.pieces_concernees),
    line("Projet associe", lead.projet_associe),
    line("Photos", photoNotes.length ? photoNotes.join(" · ") : "aucune"),
  ];
  if (skippedVideo) {
    lines.push("Video: une vidéo a été jointe, non analysée (captures uniquement).");
  }
  const previous = extra && extra.previous;
  if (previous) {
    lines.push("");
    lines.push("Analyse precedente a approfondir (ne pas tout reprendre a zero) :");
    lines.push(
      line(
        "Fourchette precedente HT",
        String(previous.price_min_ht) + " - " + String(previous.price_max_ht)
      )
    );
    lines.push(line("Resume client precedent", previous.client_summary || previous.observations));
    lines.push(
      line(
        "Prestations precedentes",
        (previous.prestations || [])
          .map((row) => row.label + " " + String(row.amount_ht) + " EUR")
          .join(" · ")
      )
    );
  }
  if (extra && extra.clientNotes) {
    lines.push("");
    lines.push(
      "Le client corrige ou complete le resume IA. Tiens-en compte pour approfondir le devis :"
    );
    lines.push(extra.clientNotes);
  }
  return lines.join("\n");
}

function dbRowToEstimate(row: Record<string, unknown> | null): EstimateJson | null {
  if (!row) return null;
  try {
    const prestations = Array.isArray(row.dv_ai_prestations) ? row.dv_ai_prestations : [];
    const flags = Array.isArray(row.dv_ai_flags) ? row.dv_ai_flags : [];
    const observations = String(row.observations || "");
    return {
      price_min_ht: asNumber(row.price_min_ht, "price_min_ht"),
      price_max_ht: asNumber(row.price_max_ht, "price_max_ht"),
      complexity: (row.complexity as EstimateJson["complexity"]) || "moyen",
      confidence: (row.confidence as EstimateJson["confidence"]) || "debutant",
      confidence_note: String(row.confidence_note || ""),
      observations,
      client_summary: String(row.client_summary || observations),
      prestations: prestations
        .slice()
        .sort(
          (a: { sort_order?: number }, b: { sort_order?: number }) =>
            (a.sort_order || 0) - (b.sort_order || 0)
        )
        .map((p: { label?: string; amount_ht?: number }) => ({
          label: String(p.label || ""),
          amount_ht: Number(p.amount_ht) || 0,
        }))
        .filter((p: { label: string }) => p.label.length >= 4),
      flags: flags
        .map((f: { kind?: string; message?: string }) => ({
          kind: (f.kind === "alerte" ? "alerte" : "recommandation") as "alerte" | "recommandation",
          message: String(f.message || ""),
        }))
        .filter((f: { message: string }) => f.message.length >= 8),
    };
  } catch {
    return null;
  }
}

function publicEstimate(estimate: EstimateJson, meta?: { estimate_id?: number; skipped?: boolean; public_id?: string }) {
  return {
    ok: true,
    skipped: Boolean(meta && meta.skipped),
    public_id: (meta && meta.public_id) || "",
    estimate_id: (meta && meta.estimate_id) || null,
    estimate,
  };
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x2000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
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

async function callClaude(
  apiKey: string,
  dossier: string,
  images: { media_type: string; data: string }[]
) {
  const content: Array<Record<string, unknown>> = [{ type: "text", text: dossier }];
  for (const image of images) {
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
        system: SYSTEM_PROMPT,
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
    return normalizeEstimate(extractJson(firstText));
  } catch {
    const retryText = await run([
      userMessage,
      { role: "assistant", content: firstText || "{}" },
      {
        role: "user",
        content: "Réponse invalide. Renvoie UNIQUEMENT l’objet JSON du schéma, sans markdown.",
      },
    ]);
    return normalizeEstimate(extractJson(retryText));
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Méthode non supportée" }, 405);
  }

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

  try {
    const media = await tryHandleMediaQualify(payload, { apiKey: anthropicKey, cors: CORS });
    if (media) return media;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ ok: false, error: message }, 500);
  }

  const publicId = String(payload.public_id || "").trim();
  const leadId = Number(payload.lead_id || 0);
  const force = Boolean(payload.force);
  const clientNotes = String(payload.client_notes || "").trim().slice(0, 2000);
  if (!publicId && !leadId) {
    return jsonResponse({ ok: false, error: "public_id requis" }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let leadQuery = supabase.from("dv_leads").select(
    "id, public_id, surface_m2, anciennete, urgence, details, code_postal, ville, tableau_existant, acces_logement, mise_a_terre, circuits_estimes, pieces_concernees, projet_associe, dv_lead_travaux(travaux), dv_photos(id, kind, titre, filename, mime_type, storage_path, sort_order), dv_ai_estimates(id, price_min_ht, price_max_ht, complexity, confidence, confidence_note, observations, created_at, dv_ai_prestations(label, amount_ht, sort_order), dv_ai_flags(kind, message))"
  );
  leadQuery = publicId ? leadQuery.eq("public_id", publicId) : leadQuery.eq("id", leadId);
  const { data: lead, error: leadErr } = await leadQuery.maybeSingle();
  if (leadErr) return jsonResponse({ ok: false, error: leadErr.message }, 500);
  if (!lead) return jsonResponse({ ok: false, error: "Demande introuvable" }, 404);

  const existingRows = (Array.isArray(lead.dv_ai_estimates) ? lead.dv_ai_estimates : [])
    .slice()
    .sort(
      (a: { created_at?: string }, b: { created_at?: string }) =>
        Date.parse(b.created_at || "0") - Date.parse(a.created_at || "0")
    );
  const previous = dbRowToEstimate(existingRows[0] || null);
  if (previous && !force) {
    return jsonResponse(
      publicEstimate(previous, {
        skipped: true,
        public_id: lead.public_id,
        estimate_id: existingRows[0] && existingRows[0].id,
      })
    );
  }

  const logEvent = async (kind: string, message: string) => {
    await supabase.from("dv_lead_events").insert({
      lead_id: lead.id,
      kind,
      message,
    });
  };

  try {
    if (existingRows.length && force) {
      const { error: delErr } = await supabase
        .from("dv_ai_estimates")
        .delete()
        .eq("lead_id", lead.id);
      if (delErr) throw delErr;
    }

    const travaux = (lead.dv_lead_travaux || [])
      .map((row: { travaux?: string }) => row.travaux)
      .filter(Boolean);
    const photos = (lead.dv_photos || [])
      .slice()
      .sort(
        (a: { sort_order?: number }, b: { sort_order?: number }) =>
          (a.sort_order || 0) - (b.sort_order || 0)
      );

    const images: { media_type: string; data: string }[] = [];
    const photoNotes: string[] = [];
    const analyzedIds: number[] = [];
    let skippedVideo = false;

    for (const photo of photos) {
      if (photo.kind === "video" || String(photo.mime_type || "").startsWith("video/")) {
        skippedVideo = true;
        continue;
      }
      if (images.length >= MAX_PHOTOS) break;
      const mediaType = imageMediaType(photo.mime_type || "", photo.filename || "");
      if (!mediaType || !photo.storage_path) continue;
      const { data: file, error: downErr } = await supabase.storage
        .from(BUCKET)
        .download(photo.storage_path);
      if (downErr || !file) continue;
      if (file.size > MAX_PHOTO_BYTES) continue;
      const bytes = new Uint8Array(await file.arrayBuffer());
      images.push({ media_type: mediaType, data: bytesToBase64(bytes) });
      photoNotes.push(photo.titre || photo.filename || "photo " + (images.length));
      if (photo.id) analyzedIds.push(photo.id);
    }

    const dossier = buildDossier(lead, travaux, photoNotes, skippedVideo, {
      clientNotes,
      previous,
    });
    const estimate = await callClaude(anthropicKey, dossier, images);

    const { data: inserted, error: insErr } = await supabase
      .from("dv_ai_estimates")
      .insert({
        lead_id: lead.id,
        price_min_ht: estimate.price_min_ht,
        price_max_ht: estimate.price_max_ht,
        complexity: estimate.complexity,
        confidence: estimate.confidence,
        confidence_note: estimate.confidence_note,
        observations: estimate.observations,
      })
      .select("id")
      .single();
    if (insErr || !inserted) throw insErr || new Error("insert estimate vide");

    if (estimate.prestations.length) {
      const { error: pErr } = await supabase.from("dv_ai_prestations").insert(
        estimate.prestations.map((row, index) => ({
          estimate_id: inserted.id,
          sort_order: index + 1,
          label: row.label,
          amount_ht: row.amount_ht,
        }))
      );
      if (pErr) throw pErr;
    }

    if (estimate.flags.length) {
      const { error: fErr } = await supabase.from("dv_ai_flags").insert(
        estimate.flags.map((row) => ({
          estimate_id: inserted.id,
          kind: row.kind,
          message: row.message,
        }))
      );
      if (fErr) throw fErr;
    }

    if (analyzedIds.length) {
      await supabase
        .from("dv_photos")
        .update({ analyzed_at: new Date().toISOString() })
        .in("id", analyzedIds);
    }

    await logEvent(
      "analyse_ia",
      clientNotes ? "Analyse IA approfondie avec précisions client" : "Analyse IA terminée"
    );
    return jsonResponse(
      publicEstimate(estimate, {
        public_id: lead.public_id,
        estimate_id: inserted.id,
      })
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logEvent("analyse_erreur", ("Analyse IA échouée : " + message).slice(0, 240));
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
