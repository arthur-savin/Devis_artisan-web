import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = "claude-sonnet-4-6";
const BUCKET = "devis-archives";
const MAX_BYTES = 10_000_000;

const PROMPT = `Tu lis un devis déjà rédigé par un artisan (PDF ou photo). Tu recopies uniquement les lignes chiffrées visibles. Tu n’inventes aucun prix, aucune prestation, aucune quantité.

SORTIE — UNIQUEMENT un JSON valide, sans markdown.
{
  "quote_title": string,
  "lines": [
    {
      "service_label": string,
      "detail": string,
      "quantity": number | null,
      "unit": string | null,
      "amount_ht": number
    }
  ]
}

Règles :
- service_label : nom de la prestation, 4 à 140 caractères, compréhensible (ex. « Remplacement tableau électrique »).
- amount_ht : montant HT de la ligne (quantité × prix unitaire s’ils sont indiqués). Nombre, sans symbole €.
- Si seul un TTC est lisible et que le taux de TVA est écrit sur le document, convertis en HT. Sinon ignore la ligne.
- Ignore totaux, sous-totaux, TVA, acomptes, mentions légales et coordonnées.
- detail : précision utile (zone, matériau, quantité), ou chaîne vide.
- unit : u, ml, m2, h, forfait, ou null.
- Si rien n’est lisible : lines = [].
- quote_title : titre court du devis s’il est écrit, sinon "".`;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function clip(value: unknown, max: number) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
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

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x2000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function asMoney(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const n = Math.round(value * 100) / 100;
    return n > 0 && n <= 1000000 ? n : null;
  }
  const cleaned = String(value ?? "")
    .replace(/\s/g, "")
    .replace(/€/g, "")
    .replace(",", ".");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n * 100) / 100;
  return rounded > 0 && rounded <= 1000000 ? rounded : null;
}

function mediaKind(mime: string, filename: string) {
  const type = mime.toLowerCase();
  const name = filename.toLowerCase();
  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (type === "image/png" || name.endsWith(".png")) return "image/png";
  if (type === "image/webp" || name.endsWith(".webp")) return "image/webp";
  if (type === "image/gif" || name.endsWith(".gif")) return "image/gif";
  if (
    type === "image/jpeg" ||
    type === "image/jpg" ||
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg")
  ) {
    return "image/jpeg";
  }
  return "";
}

function normalizeLines(raw: Record<string, unknown>) {
  const title = clip(raw.quote_title, 140);
  const list = Array.isArray(raw.lines) ? raw.lines : [];
  const lines: Array<{
    service_label: string;
    detail: string;
    amount_ht: number;
  }> = [];
  for (const entry of list) {
    if (lines.length >= 40) break;
    const row = entry as {
      service_label?: unknown;
      detail?: unknown;
      quantity?: unknown;
      unit?: unknown;
      amount_ht?: unknown;
    };
    const amount = asMoney(row.amount_ht);
    const label = clip(row.service_label, 160);
    if (!label || label.length < 3 || amount == null) continue;
    const qty = Number(row.quantity);
    const unit = clip(row.unit, 24);
    const bits = [clip(row.detail, 240)];
    if (Number.isFinite(qty) && qty > 0) bits.push(String(qty) + (unit ? " " + unit : ""));
    else if (unit) bits.push(unit);
    lines.push({
      service_label: label,
      detail: bits.filter(Boolean).join(" · ").slice(0, 400),
      amount_ht: amount,
    });
  }
  return { title, lines };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Méthode non supportée" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") || "";
  if (!supabaseUrl || !serviceKey) return jsonResponse({ ok: false, error: "Supabase mal configuré" }, 500);
  if (!anthropicKey) return jsonResponse({ ok: false, error: "ANTHROPIC_API_KEY manquant" }, 500);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return jsonResponse({ ok: false, error: "Connexion requise." }, 401);

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "JSON attendu" }, 400);
  }

  const importId = Number(payload.import_id || 0);
  const force = Boolean(payload.force);
  if (!importId) return jsonResponse({ ok: false, error: "import_id requis" }, 400);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const userRes = await admin.auth.getUser(token);
  const user = userRes.data && userRes.data.user;
  if (userRes.error || !user) return jsonResponse({ ok: false, error: "Connexion requise." }, 401);

  const artisanRes = await admin
    .from("dv_artisans")
    .select("id, metier")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  const artisan = artisanRes.data as { id?: number; metier?: string } | null;
  if (!artisan || !artisan.id) return jsonResponse({ ok: false, error: "Aucun atelier lié à ce compte." }, 403);

  const importRes = await admin
    .from("dv_quote_imports")
    .select("id, artisan_id, filename, mime_type, storage_path, status")
    .eq("id", importId)
    .eq("artisan_id", artisan.id)
    .maybeSingle();
  const quote = importRes.data as {
    id: number;
    filename?: string;
    mime_type?: string;
    storage_path?: string;
    status?: string;
  } | null;
  if (importRes.error) return jsonResponse({ ok: false, error: importRes.error.message }, 500);
  if (!quote || !quote.storage_path) return jsonResponse({ ok: false, error: "Devis introuvable." }, 404);

  if (quote.status === "en_cours") {
    return jsonResponse({ ok: false, error: "Lecture déjà en cours." }, 409);
  }
  if (quote.status === "extrait" && !force) {
    return jsonResponse({ ok: true, already: true });
  }

  try {
    await admin
      .from("dv_quote_imports")
      .update({ status: "en_cours", error_message: null })
      .eq("id", importId);

    if (force) {
      await admin.from("dv_service_prices").delete().eq("import_id", importId);
    }

    const downloaded = await admin.storage.from(BUCKET).download(quote.storage_path);
    if (downloaded.error || !downloaded.data) {
      throw new Error(downloaded.error?.message || "Fichier introuvable dans le stockage.");
    }
    if (downloaded.data.size > MAX_BYTES) throw new Error("Fichier trop lourd pour la lecture (10 Mo maximum).");

    const kind = mediaKind(String(quote.mime_type || ""), String(quote.filename || ""));
    if (!kind) throw new Error("Format non lisible. Déposez un PDF ou une image.");

    const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
    const data = bytesToBase64(bytes);
    const block =
      kind === "pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
        : { type: "image", source: { type: "base64", media_type: kind, data } };

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "pdfs-2024-09-25",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        temperature: 0,
        system: PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  "Métier de l’artisan : " +
                  clip(artisan.metier, 80) +
                  ".\nFichier : " +
                  clip(quote.filename, 180) +
                  ".\nExtrais les lignes chiffrées de ce devis.",
              },
              block,
            ],
          },
        ],
      }),
    });
    const body = await response.json();
    if (!response.ok) {
      const message = body?.error?.message || "Lecture IA refusée.";
      throw new Error(String(message).slice(0, 300));
    }
    const text = Array.isArray(body.content)
      ? body.content.map((part: { text?: string }) => part.text || "").join("")
      : "";
    const parsed = normalizeLines(extractJson(text) as Record<string, unknown>);

    if (parsed.lines.length) {
      const rows = parsed.lines.map((line) => ({
        artisan_id: artisan.id,
        service_label: line.service_label,
        amount_ht: line.amount_ht,
        detail: line.detail || null,
        reason: null,
        source: "import",
        import_id: importId,
        lead_id: null,
      }));
      let inserted = await admin.from("dv_service_prices").insert(rows);
      if (inserted.error && /detail|source|import_id/i.test(inserted.error.message || "")) {
        inserted = await admin.from("dv_service_prices").insert(
          rows.map((row) => ({
            artisan_id: row.artisan_id,
            service_label: row.service_label,
            amount_ht: row.amount_ht,
            reason: null,
            lead_id: null,
          }))
        );
      }
      if (inserted.error) throw new Error(inserted.error.message);
    }

    await admin
      .from("dv_quote_imports")
      .update({
        status: "extrait",
        title: parsed.title || null,
        extracted_at: new Date().toISOString(),
        error_message: parsed.lines.length ? null : "Aucune ligne chiffrée lisible sur ce document.",
      })
      .eq("id", importId);

    return jsonResponse({ ok: true, count: parsed.lines.length, title: parsed.title });
  } catch (err) {
    const message = clip(err instanceof Error ? err.message : err, 400) || "Lecture impossible.";
    await admin
      .from("dv_quote_imports")
      .update({ status: "erreur", error_message: message })
      .eq("id", importId);
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
