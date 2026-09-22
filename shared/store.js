/**
 * Pont widget ↔ dashboard.
 * Si Supabase est configuré (shared/supabase-config.js), les demandes
 * vont dans le cloud. Sinon, repli sur le stockage local du navigateur.
 */
(function (global) {
  const KEY = "artisan-devis.requests.v1";
  const ARTISANS_KEY = "artisan-devis.artisans.v1";
  const SESSION = "artisan-devis.session";
  const SESSION_ARTISAN = "artisan-devis.session.artisan";
  const DEFAULT_ARTISAN_ID = "art_demo_01";
  const BUCKET = "chantier-photos";
  const MAX_PHOTOS = 5;
  const MAX_VIDEOS = 5;
  const METIERS = [
    "Électricité",
    "Plomberie",
    "Couverture",
    "Zinguerie",
    "Chauffage / Climatisation",
    "Peinture",
    "Maçonnerie",
    "Menuiserie",
    "Carrelage",
    "Serrurerie",
  ];

  const STATUSES = {
    nouveau: { label: "Nouveau", tone: "gold" },
    contacte: { label: "Contacté", tone: "navy" },
    devis_envoye: { label: "Devis envoyé", tone: "ok" },
    gagne: { label: "Gagné", tone: "ok" },
    perdu: { label: "Perdu", tone: "muted" },
    archive: { label: "Archivé", tone: "muted" },
  };

  function uid() {
    return "dv_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function artisanUid() {
    return "art_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function hashPass(password) {
    let h = 2166136261;
    const s = String(password || "");
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return "fnv_" + (h >>> 0).toString(16);
  }

  function slugify(value) {
    const base = String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    return base || "atelier";
  }

  function uniqueSlug(base, existing) {
    const used = new Set((existing || []).map((a) => String(a.slug || "").toLowerCase()));
    let slug = base;
    let n = 2;
    while (used.has(slug)) {
      slug = base.slice(0, 36) + "-" + n;
      n += 1;
    }
    return slug;
  }

  function normalizeArtisan(row) {
    if (!row) return null;
    if (row.displayName && row.id) {
      return {
        id: row.id,
        dbId: row.dbId || null,
        slug: row.slug || row.id,
        displayName: row.displayName,
        metier: row.metier || "Artisan",
        ville: row.ville || "",
        telephone: row.telephone || "",
        bio: row.bio || "",
        tarifGrid: row.tarifGrid || "",
        hasTarif: Boolean(row.hasTarif) || Boolean(String(row.tarifGrid || "").trim()),
        email: String(row.email || "").toLowerCase(),
        passHash: row.passHash || "",
        createdAt: row.createdAt || Date.now(),
      };
    }
    return {
      id: row.public_id,
      dbId: row.id,
      slug: row.slug || row.public_id,
      displayName: row.display_name || "",
      metier: row.metier || "Artisan",
      ville: row.ville || "",
      telephone: row.telephone || "",
      bio: row.bio || "",
      tarifGrid: row.tarif_grid || "",
      hasTarif: Boolean(row.has_tarif) || Boolean(String(row.tarif_grid || "").trim()),
      email: String(row.email || "").toLowerCase(),
      createdAt: row.created_at ? Date.parse(row.created_at) : Date.now(),
    };
  }

  function cfg() {
    return global.DEVIS_SUPABASE || {};
  }

  function isSupabaseConfigured() {
    const c = cfg();
    const url = String(c.url || "");
    const key = String(c.anonKey || "");
    return Boolean(
      url.startsWith("https://") &&
        !url.includes("YOUR_PROJECT") &&
        key.length > 20 &&
        !key.includes("YOUR_ANON_KEY")
    );
  }

  function createClient() {
    const lib = global.supabase;
    if (!lib || typeof lib.createClient !== "function") {
      throw new Error("Bibliothèque Supabase absente (CDN).");
    }
    const c = cfg();
    return lib.createClient(c.url, c.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }

  function readLocal() {
    try {
      const data = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  function writeLocal(list) {
    localStorage.setItem(KEY, JSON.stringify(list));
    global.dispatchEvent(new CustomEvent("devis:change"));
  }

  function readArtisans() {
    try {
      const data = JSON.parse(localStorage.getItem(ARTISANS_KEY) || "[]");
      return Array.isArray(data) ? data.map(normalizeArtisan).filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  function writeArtisans(list) {
    localStorage.setItem(ARTISANS_KEY, JSON.stringify(list));
  }

  function readSessionArtisanId() {
    const raw = sessionStorage.getItem(SESSION_ARTISAN) || "";
    if (raw) return raw;
    if (sessionStorage.getItem(SESSION) === "1") return DEFAULT_ARTISAN_ID;
    try {
      const parsed = JSON.parse(sessionStorage.getItem(SESSION) || "null");
      return (parsed && parsed.artisanId) || "";
    } catch {
      return "";
    }
  }

  function daysAgo(n) {
    return Date.now() - n * 24 * 60 * 60 * 1000;
  }

  const SEED_ARTISAN = {
    id: DEFAULT_ARTISAN_ID,
    slug: "atelier-lyon",
    displayName: "Atelier Lyon",
    metier: "Électricité",
    ville: "Lyon",
    telephone: "",
    bio: "Électricité pour particuliers — devis sous 24 h, sans engagement.",
    tarifGrid: "",
    hasTarif: false,
    email: "vous@atelier.fr",
    passHash: "",
    createdAt: Date.parse("2026-03-01T09:00:00Z"),
  };

  const SEED = [
    {
      id: "dv_seed_01",
      artisanId: DEFAULT_ARTISAN_ID,
      createdAt: daysAgo(0.2),
      status: "nouveau",
      source: "widget",
      travaux: ["Mise aux normes"],
      surface: "72",
      anciennete: "Plus de 30 ans",
      urgence: "Urgent",
      details:
        "Disjonctions à répétition depuis hier soir. Tableau dans l’entrée, à gauche en arrivant. Cuisine à refaire dans les semaines qui viennent — prévoir des départs supplémentaires.",
      prenom: "Léa",
      nom: "Martin",
      tel: "06 18 44 21 09",
      email: "lea.martin@email.fr",
      cp: "69003",
      adresse: "14 rue de la Part-Dieu",
      ville: "Lyon",
      priorite: "haute",
      notesInternes:
        "Rappeler ce soir après 19h (disjonctions). Demander s’il y a un diagnostic DPE / élec déjà fait. Accès 3e sans ascenseur → prévoir 2 passages matériel.",
      rappelAt: "2026-09-10",
      tableau: "Oui — 8 modules, sans différentiel 30 mA",
      acces: "Interphone + code, 3e étage sans ascenseur",
      miseATerre: "Incertaine — à vérifier sur place",
      circuits: "≈ 9 circuits",
      pieces: "Ensemble du logement",
      projet: "Disjonctions + rénovation cuisine",
      photos: [
        { name: "tableau.jpg", title: "Tableau électrique — entrée", placeholder: "ph-navy", size: 2516582, kind: "photo" },
        { name: "cuisine.jpg", title: "Cuisine — arrivées existantes", placeholder: "ph-clay", size: 1887436, kind: "photo" },
        { name: "sejour.jpg", title: "Séjour — plafonnier", placeholder: "ph-sage", size: 2202009, kind: "photo" },
        { name: "degagement.jpg", title: "Dégagement — gaine apparente", placeholder: "ph-slate", size: 1677721, kind: "photo" },
      ],
      estimate: {
        createdAt: daysAgo(0.18),
        hasPrice: false,
        priceMin: null,
        priceMax: null,
        complexity: "complexe",
        confidence: "calibre",
        confidenceNote:
          "Dossier bien documenté. Les sections de câbles restent à contrôler sur place.",
        observations:
          "Installation d’origine (~ années 80). Absence probable de différentiel 30 mA. Les disjonctions répétées collent avec un tableau saturé et des départs cuisine sous-dimensionnés. Visite ou échange pour confirmer avant devis ferme.",
        clientSummary:
          "Nous avons bien compris votre demande de mise aux normes, avec les photos du tableau et des pièces. L’artisan vous recontacte pour le devis. Aucun tarif n’est avancé ici.",
        titrePredevis: "Mise aux normes du tableau électrique",
        disclaimer:
          "Ce prédevis décrit les travaux envisagés. Il n’est pas un devis : l’artisan reste seul décisionnaire.",
        prestations: [
          {
            label: "Constat de l’installation",
            detail: "Lecture du tableau et des départs concernés, d’après vos photos, avant toute intervention.",
            amount: 0,
          },
          {
            label: "Mise aux normes du tableau",
            detail: "Remplacement des protections manquantes, notamment le différentiel 30 mA, et réorganisation des départs.",
            amount: 0,
          },
          {
            label: "Essais et contrôles",
            detail: "Vérification du bon fonctionnement après travaux, y compris la terre si elle est accessible.",
            amount: 0,
          },
          {
            label: "Remise en état",
            detail: "Refermeture du tableau et nettoyage de la zone d’intervention.",
            amount: 0,
          },
        ],
        flags: [
          {
            kind: "alerte",
            message:
              "Installation ancienne détectée : prévoir un diagnostic avant toute intervention, et vérifier la présence d’amiante sur les colliers / gaines.",
          },
          {
            kind: "recommandation",
            message:
              "Prévoir 1 jour supplémentaire si le tableau dépasse 9 circuits. Emporter un testeur de terre et un stock de disjoncteurs 16/20 A.",
          },
        ],
      },
      events: [
        { createdAt: daysAgo(0.2), kind: "recue", message: "Demande reçue" },
        { createdAt: daysAgo(0.18), kind: "analyse_ia", message: "Analyse IA terminée" },
      ],
    },
    {
      id: "dv_seed_02",
      artisanId: DEFAULT_ARTISAN_ID,
      createdAt: daysAgo(1.4),
      status: "contacte",
      source: "widget",
      travaux: ["Mise aux normes"],
      surface: "110",
      anciennete: "10 à 30 ans",
      urgence: "Dans le mois",
      details: "Achat d’un appartement, diagnostic électrique à prévoir avant emménagement.",
      prenom: "Karim",
      nom: "",
      tel: "07 52 10 88 34",
      email: "karim.b@email.fr",
      cp: "69100",
      ville: "Villeurbanne",
      priorite: "normale",
      notesInternes: "Appel prévu : diagnostic avant emménagement.",
      rappelAt: "2026-09-11",
      photos: [],
      events: [
        { createdAt: daysAgo(1.4), kind: "recue", message: "Demande reçue" },
        { createdAt: daysAgo(1.1), kind: "statut", message: "Statut : Contacté" },
      ],
    },
    {
      id: "dv_seed_03",
      artisanId: DEFAULT_ARTISAN_ID,
      createdAt: daysAgo(4),
      status: "devis_envoye",
      source: "widget",
      travaux: ["Borne de recharge"],
      surface: "95",
      anciennete: "Moins de 10 ans",
      urgence: "Pas urgent",
      details: "Maison individuelle, place de parking privative, véhicule commandé pour novembre.",
      prenom: "Sophie",
      nom: "Durand",
      tel: "06 03 77 15 62",
      email: "sophie.durand@email.fr",
      cp: "69008",
      ville: "Lyon",
      priorite: "faible",
      notesInternes: "Devis borne envoyé par e-mail. Relance si pas de réponse sous 10 jours.",
      projet: "Borne VE à domicile",
      photos: [],
      events: [
        { createdAt: daysAgo(4), kind: "recue", message: "Demande reçue" },
        { createdAt: daysAgo(2), kind: "statut", message: "Statut : Devis envoyé" },
      ],
    },
  ];

  function mediaKind(item) {
    if (!item) return "photo";
    if (item.kind === "video" || item.kind === "photo") return item.kind;
    const mime = String(item.mime || item.mime_type || item.type || "");
    if (mime.startsWith("video/")) return "video";
    return "photo";
  }

  function mapPhoto(p) {
    const path = p.storage_path || "";
    const placeholder = path.startsWith("placeholder:") ? path.slice("placeholder:".length) : "";
    const kind = mediaKind(p);
    return {
      name: p.filename || p.titre || (kind === "video" ? "video" : "photo"),
      title: p.titre || p.filename || (kind === "video" ? "Vidéo" : "Photo"),
      path,
      placeholder,
      dataUrl: p.publicUrl || "",
      size: p.size_bytes || 0,
      analyzedAt: p.analyzed_at ? Date.parse(p.analyzed_at) : null,
      kind,
      mime: p.mime_type || "",
    };
  }

  function mapEstimate(row) {
    const list = (row.dv_ai_estimates || [])
      .slice()
      .sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0));
    const est = list[0];
    if (!est) return null;
    const prestations = (est.dv_ai_prestations || [])
      .slice()
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
      .map((p) => ({
        label: p.label,
        detail: p.detail || "",
        amount: Number(p.amount_ht),
      }));
    const flags = (est.dv_ai_flags || []).map((f) => ({ kind: f.kind, message: f.message }));
    const hasPrice =
      est.has_price === true ||
      (est.has_price !== false && (Number(est.price_min_ht) > 0 || Number(est.price_max_ht) > 0));
    return {
      createdAt: est.created_at ? Date.parse(est.created_at) : Date.now(),
      hasPrice,
      priceMin: hasPrice ? Number(est.price_min_ht) : null,
      priceMax: hasPrice ? Number(est.price_max_ht) : null,
      complexity: est.complexity,
      confidence: est.confidence,
      confidenceNote: est.confidence_note || "",
      observations: est.observations || "",
      clientSummary: est.client_summary || est.observations || "",
      sufficient: est.dossier_suffisant !== false,
      disclaimer:
        est.disclaimer ||
        "Ce prédevis est indicatif et non contractuel. L’artisan reste seul décisionnaire du devis.",
      titrePredevis: est.titre_predevis || "",
      prestations,
      flags,
    };
  }

  function mapLead(row) {
    if (!row) return null;
    const travaux = (row.dv_lead_travaux || []).map((t) => t.travaux).filter(Boolean);
    const photos = (row.dv_photos || [])
      .slice()
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
      .map(mapPhoto);
    const events = (row.dv_lead_events || [])
      .slice()
      .sort((a, b) => Date.parse(a.created_at || 0) - Date.parse(b.created_at || 0))
      .map((e) => ({
        createdAt: e.created_at ? Date.parse(e.created_at) : Date.now(),
        kind: e.kind,
        message: e.message,
      }));
    return {
      id: row.public_id,
      dbId: row.id,
      artisanId: row.artisan_id,
      createdAt: row.created_at ? Date.parse(row.created_at) : Date.now(),
      updatedAt: row.updated_at ? Date.parse(row.updated_at) : Date.now(),
      status: row.status || "nouveau",
      source: row.source || "widget",
      travaux,
      surface: row.surface_m2 != null ? String(row.surface_m2) : "",
      anciennete: row.anciennete || "",
      urgence: row.urgence || "",
      details: row.details || "",
      prenom: row.prenom || "",
      nom: row.nom || "",
      tel: row.telephone || "",
      email: row.email || "",
      cp: row.code_postal || "",
      adresse: row.adresse || "",
      ville: row.ville || "",
      photos,
      priorite: row.priorite || "normale",
      notesInternes: row.notes_internes || "",
      rappelAt: row.rappel_at || "",
      prixReelHt: row.prix_reel_ht != null ? Number(row.prix_reel_ht) : null,
      tableau: row.tableau_existant || "",
      acces: row.acces_logement || "",
      miseATerre: row.mise_a_terre || "",
      circuits: row.circuits_estimes || "",
      pieces: row.pieces_concernees || "",
      projet: row.projet_associe || "",
      estimate: mapEstimate(row),
      events,
      hiddenAt: row.hidden_at ? Date.parse(row.hidden_at) : null,
    };
  }

  function displayName(item) {
    if (!item) return "Client";
    return [item.prenom, item.nom].filter(Boolean).join(" ") || "Client";
  }

  function normalize(item) {
    if (!item) return null;
    const events =
      item.events && item.events.length
        ? item.events
        : [{ createdAt: item.createdAt || Date.now(), kind: "recue", message: "Demande reçue" }];
    return {
      artisanId: item.artisanId || DEFAULT_ARTISAN_ID,
      nom: "",
      adresse: "",
      ville: "",
      priorite: "normale",
      notesInternes: "",
      rappelAt: "",
      prixReelHt: null,
      tableau: "",
      acces: "",
      miseATerre: "",
      circuits: "",
      pieces: "",
      projet: "",
      photos: [],
      estimate: null,
      hiddenAt: null,
      ...item,
      events,
      photos: (item.photos || []).map((p) => ({
        kind: "photo",
        mime: "",
        ...p,
        kind: mediaKind(p),
      })),
    };
  }

  function dataUrlToBlob(dataUrl) {
    const parts = String(dataUrl || "").split(",");
    if (parts.length < 2) return null;
    const mime = (parts[0].match(/:(.*?);/) || [])[1] || "image/jpeg";
    const binary = atob(parts[1]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  let client = null;
  let cache = [];
  let signedIn = false;
  let currentArtisan = null;
  let readyPromise = null;
  let lastError = null;

  function emit() {
    global.dispatchEvent(new CustomEvent("devis:change"));
  }

  function throwIf(error, fallback) {
    if (!error) return;
    lastError = error.message || String(error);
    throw new Error(lastError || fallback);
  }

  async function fetchLeads() {
    const full =
      "*, dv_lead_travaux(travaux), dv_photos(*), dv_ai_estimates(*, dv_ai_prestations(*), dv_ai_flags(*)), dv_lead_events(*)";
    const basic = "*, dv_lead_travaux(travaux), dv_photos(*)";

    async function query(select, hideHidden) {
      let q = client.from("dv_leads").select(select).order("created_at", { ascending: false });
      if (currentArtisan && currentArtisan.dbId != null) {
        q = q.eq("artisan_id", currentArtisan.dbId);
      }
      if (hideHidden) q = q.is("hidden_at", null);
      return q;
    }

    let { data, error } = await query(full, true);
    if (error && /hidden_at/i.test(error.message || "")) {
      const retryHide = await query(full, false);
      data = retryHide.data;
      error = retryHide.error;
    }
    if (error) {
      const retry = await query(basic, false);
      data = retry.data;
      error = retry.error;
    }
    throwIf(error, "Impossible de lire les demandes.");
    cache = (data || []).map(mapLead);
    return cache;
  }

  async function uploadPhotos(lead, photos, opts) {
    if (!photos || !photos.length) return;
    const prefix = (opts && opts.prefix) || "";
    const orderBase = Number(opts && opts.orderBase) || 1;
    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i];
      const kind = mediaKind(photo);
      const blob =
        photo.file instanceof Blob
          ? photo.file
          : photo.dataUrl
            ? dataUrlToBlob(photo.dataUrl)
            : null;
      if (!blob) continue;
      const fallbackName = kind === "video" ? "video.mp4" : "photo.jpg";
      const safeName = (photo.name || fallbackName).replace(/[^\w.\-]+/g, "_");
      const path = lead.public_id + "/" + prefix + (orderBase + i) + "-" + safeName;
      const { error: upErr } = await client.storage.from(BUCKET).upload(path, blob, {
        contentType: blob.type || (kind === "video" ? "video/mp4" : "image/jpeg"),
        upsert: true,
      });
      if (upErr) {
        console.warn((kind === "video" ? "Vidéo" : "Photo") + " non envoyée :", upErr.message);
        continue;
      }
      const row = {
        lead_id: lead.id,
        sort_order: orderBase + i,
        kind,
        titre: photo.title || photo.name || (kind === "video" ? "Vidéo " + (i + 1) : "Photo " + (i + 1)),
        filename: safeName,
        mime_type: blob.type || null,
        size_bytes: blob.size,
        storage_path: path,
      };
      const inserted = await client.from("dv_photos").insert(row);
      if (inserted.error && /kind/i.test(inserted.error.message || "")) {
        delete row.kind;
        await client.from("dv_photos").insert(row);
      }
    }
  }

  async function loadArtisanFromAuth() {
    if (!client) return null;
    const { data: sessionData } = await client.auth.getSession();
    const user = sessionData && sessionData.session && sessionData.session.user;
    if (!user) {
      currentArtisan = null;
      return null;
    }
    const { data, error } = await client
      .from("dv_artisans")
      .select("*")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (error) {
      lastError = error.message;
      currentArtisan = null;
      return null;
    }
    currentArtisan = normalizeArtisan(data);
    if (currentArtisan) sessionStorage.setItem(SESSION_ARTISAN, currentArtisan.id);
    return currentArtisan;
  }

  async function fetchPublicArtisan(ref) {
    const key = String(ref || "").trim();
    if (!key) return null;
    const local = readArtisans().find((a) => a.slug === key || a.id === key);
    if (local) return local;
    if (key === DEFAULT_ARTISAN_ID || key === "atelier-lyon") {
      return normalizeArtisan(SEED_ARTISAN);
    }
    if (!isSupabaseConfigured() || !client) return null;
    const { data, error } = await client.rpc("dv_public_artisan", { p_ref: key });
    if (error) {
      lastError = error.message;
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    return normalizeArtisan(row);
  }

  async function initSupabase() {
    client = createClient();
    const { data } = await client.auth.getSession();
    signedIn = Boolean(data && data.session);
    if (signedIn) {
      try {
        await loadArtisanFromAuth();
        await fetchLeads();
      } catch (err) {
        cache = [];
        lastError = err.message;
      }
    }
    client
      .channel("dv-leads")
      .on("postgres_changes", { event: "*", schema: "public", table: "dv_leads" }, () => {
        fetchLeads().then(emit).catch(() => {});
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "dv_ai_estimates" }, () => {
        fetchLeads().then(emit).catch(() => {});
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "dv_lead_events" }, () => {
        fetchLeads().then(emit).catch(() => {});
      })
      .subscribe();
  }

  async function requestAnalysis(publicId, force, extra) {
    if (!client || !publicId) return { ok: false, error: "Client Supabase absent." };
    return invokeQualify("finalize", {
      public_id: publicId,
      force: Boolean(force),
      description: extra && extra.clientNotes,
    });
  }

  function qualifyError(data, error, fallback) {
    return (
      (data && data.error) ||
      (error && error.message) ||
      (error && typeof error.context === "string" ? error.context : "") ||
      fallback
    );
  }

  async function invokeFunction(name, body) {
    const { data, error } = await client.functions.invoke(name, { body });
    if (error) {
      const err = new Error(qualifyError(data, error, "Qualification IA impossible."));
      err.fn = name;
      throw err;
    }
    if (data && data.ok === false) {
      const err = new Error(data.error || "Qualification IA refusée.");
      err.fn = name;
      throw err;
    }
    return data || { ok: true };
  }

  async function invokeQualify(action, payload) {
    const body = { action, ...(payload || {}) };
    const mediaActions = action === "plan" || action === "validate_photo" || action === "review";
    let data = null;
    if (mediaActions) {
      try {
        data = await invokeFunction("analyze-lead", body);
        if (action === "plan" && !(data && Array.isArray(data.photos) && data.photos.length)) {
          data = null;
        }
      } catch (err) {
        console.warn("analyze-lead indisponible pour " + action + " :", err && err.message);
      }
    }
    if (!data) {
      data = await invokeFunction("qualify-dossier", body);
    }
    if (action === "finalize") {
      try {
        await fetchLeads();
        emit();
      } catch {
        /* ignore */
      }
      return enrichEstimate(mapApiEstimate(data || { ok: true }), (payload && (payload.public_id || payload.publicId)) || "", payload);
    }
    return data || { ok: true };
  }

  function mapApiEstimate(data) {
    const raw = (data && data.estimate) || data || {};
    const prestations = Array.isArray(raw.prestations) ? raw.prestations : [];
    const flags = Array.isArray(raw.flags)
      ? raw.flags
      : Array.isArray(raw.vigilance)
        ? raw.vigilance.map((message) => ({ kind: "recommandation", message }))
        : [];
    const hasPrice = Boolean(raw.has_price === true || (data && data.has_price === true));
    const priceMin = Number(raw.price_min_ht != null ? raw.price_min_ht : raw.priceMin);
    const priceMax = Number(raw.price_max_ht != null ? raw.price_max_ht : raw.priceMax);
    const observations = raw.observations || "";
    return {
      ok: data && data.ok === false ? false : true,
      skipped: Boolean(data && data.skipped),
      public_id: data && data.public_id,
      sufficient: data && data.sufficient,
      client_message: (data && data.client_message) || raw.client_summary || "",
      besoin: (data && data.besoin) || raw.besoin || "",
      observations: (data && data.observations) || raw.observations || "",
      vigilance: Array.isArray(data && data.vigilance) ? data.vigilance : raw.vigilance || [],
      reserves: (data && data.reserves) || raw.reserves || "",
      extra_photos: Array.isArray(data && data.extra_photos) ? data.extra_photos : [],
      has_price: hasPrice,
      titre_predevis: (data && data.titre_predevis) || raw.titre_predevis || raw.titrePredevis || "",
      disclaimer:
        (data && data.disclaimer) ||
        raw.disclaimer ||
        "Ce prédevis est indicatif et non contractuel. L’artisan reste seul décisionnaire du devis.",
      estimate: {
        createdAt: Date.now(),
        hasPrice,
        priceMin: hasPrice && Number.isFinite(priceMin) ? priceMin : null,
        priceMax: hasPrice && Number.isFinite(priceMax) ? priceMax : null,
        complexity: raw.complexity || "moyen",
        confidence: raw.confidence || "calibre",
        confidenceNote: raw.confidence_note || raw.confidenceNote || "",
        observations,
        clientSummary:
          raw.client_summary || raw.clientSummary || (data && data.client_message) || observations,
        sufficient: raw.sufficient !== false && (data && data.sufficient) !== false,
        titrePredevis: raw.titre_predevis || raw.titrePredevis || (data && data.titre_predevis) || "",
        disclaimer:
          raw.disclaimer ||
          (data && data.disclaimer) ||
          "Ce prédevis est indicatif et non contractuel. L’artisan reste seul décisionnaire du devis.",
        prestations: prestations.map((p) => ({
          label: p.label,
          detail: p.detail || "",
          amount: Number(p.amount_ht != null ? p.amount_ht : p.amount) || 0,
        })),
        flags: flags.map((f) => ({ kind: f.kind || "recommandation", message: f.message || f })),
      },
    };
  }

  function padLocalPlan(photos) {
    const extras = [
      { id: "vue_ensemble", kind: "photo", label: "Vue d’ensemble de la zone concernée", hint: "Reculez un peu, de jour, pour situer le chantier." },
      { id: "detail", kind: "photo", label: "Gros plan sur le détail à traiter", hint: "Approchez-vous du point précis, photo nette, sans flash." },
      { id: "contexte", kind: "photo", label: "Contexte autour de la zone", hint: "Ce qui se raccorde ou se trouve juste à côté." },
      { id: "acces", kind: "photo", label: "Accès au chantier", hint: "Le passage, l’escalier ou l’allée qui mènera l’artisan sur place." },
      { id: "parcours", kind: "video", label: "Parcours lent de la zone", hint: "Filmez environ 30 secondes, lentement, de l’ensemble vers le détail." },
    ];
    const out = (photos || []).map((p, i) => ({
      id: p.id || "media_" + (i + 1),
      kind: p.kind === "video" ? "video" : "photo",
      label: p.label,
      hint: p.hint,
    }));
    let i = 0;
    while (out.length < 5 && i < extras.length) {
      const extra = extras[i++];
      if (out.some((x) => x.id === extra.id)) continue;
      out.push(extra);
    }
    if (out.length === 5 && !out.some((x) => x.kind === "video")) {
      out[4] = extras[4];
    }
    let videos = 0;
    for (const item of out) {
      if (item.kind === "video") {
        videos += 1;
        if (videos > MAX_VIDEOS) item.kind = "photo";
      }
    }
    return out.slice(0, 5);
  }

  function localPlan(description, metier) {
    const text = String(description || "").toLowerCase();
    const job = String(metier || "").toLowerCase();
    const pick = (metierLabel, intervention, photos) => ({
      metier: metierLabel,
      intervention,
      photos: padLocalPlan(photos),
    });
    if (/toit|tuile|ardoise|goutti|zinguer|chenal|faitage|fuite.*(toit|plafond)|velux|lucarne/.test(text) || /couvert|zinguer/.test(job)) {
      return pick("Couverture", "Travaux de toiture / zinguerie", [
        { id: "vue_toiture", kind: "photo", label: "Vue d’ensemble de la toiture", hint: "Depuis le jardin ou la rue, de jour, pour voir la pente et l’étendue." },
        { id: "zone_concernee", kind: "photo", label: "Zone concernée de plus près", hint: "Le détail à traiter (tuiles, fuite, rive), net, sans contre-jour." },
        { id: "gouttiere", kind: "photo", label: "Gouttière ou rive de toit", hint: "Un cliché le long de la gouttière, pour voir les crochets et l’écoulement." },
        { id: "acces", kind: "photo", label: "Accès au chantier", hint: "L’allée, l’escalier ou le passage qui mène au toit." },
        { id: "parcours_fuite", kind: "video", label: "Parcours lent de la zone de fuite", hint: "Filmez environ 30 secondes, du large vers le détail, sans à-coups." },
      ]);
    }
    if (/plomberie|fuite|robinet|wc|chauffe|chaudiere|canalisation|evier|douche/.test(text) || /plomb/.test(job)) {
      return pick("Plomberie", "Intervention de plomberie", [
        { id: "vue_piece", kind: "photo", label: "Vue de la pièce concernée", hint: "Reculez un peu pour situer l’évier, la douche ou le WC dans la pièce." },
        { id: "detail_fuite", kind: "photo", label: "Gros plan sur le point à traiter", hint: "Le robinet, le raccord ou la fuite, bien net, lumière du jour." },
        { id: "arrivee_eau", kind: "photo", label: "Arrivée ou compteur d’eau", hint: "Le compteur ou le robinet d’arrêt, de face si vous y avez accès." },
        { id: "environnement", kind: "photo", label: "Dessous ou arrière de l’appareil", hint: "Si c’est accessible, un cliché des raccords sous l’évier ou derrière." },
        { id: "goutte", kind: "video", label: "Vidéo courte de la fuite", hint: "Filmez environ 30 secondes le goutte-à-goutte ou l’écoulement, sans bouger trop vite." },
      ]);
    }
    if (/borne|vehicule electrique|irve|wallbox/.test(text)) {
      return pick("Électricité", "Pose de borne de recharge", [
        { id: "parking", kind: "photo", label: "Place de stationnement prévue", hint: "La place, de jour, avec le mur ou le poteau où irait la borne." },
        { id: "tableau", kind: "photo", label: "Tableau électrique, porte ouverte", hint: "Ouvrez la porte du tableau et photographiez l’intérieur, de face." },
        { id: "chemin", kind: "photo", label: "Chemin jusqu’au tableau", hint: "Le passage entre la place de parking et le tableau (couloir, garage, jardin)." },
        { id: "compteur", kind: "photo", label: "Compteur ou arrivée électrique", hint: "Le compteur, de face, s’il est accessible." },
        { id: "parcours_ligne", kind: "video", label: "Parcours parking → tableau", hint: "Filmez environ 30 secondes le chemin que suivrait le câble, lentement." },
      ]);
    }
    if (/tableau|disjonct|prise|eclairage|norme|electri|led|spot/.test(text) || /electr/.test(job)) {
      return pick("Électricité", "Travaux électriques", [
        { id: "zone", kind: "photo", label: "Zone concernée par les travaux", hint: "La pièce ou le mur concerné, de jour, pour situer le chantier." },
        { id: "tableau", kind: "photo", label: "Tableau électrique, porte ouverte", hint: "Ouvrez la porte et photographiez l’intérieur, bien de face, sans flash." },
        { id: "detail", kind: "photo", label: "Détail à traiter (prise, luminaire, saignée)", hint: "Un gros plan net de l’élément ou de l’emplacement prévu." },
        { id: "acces_tableau", kind: "photo", label: "Accès au tableau", hint: "Le dégagement devant le tableau (placard, couloir, hauteur)." },
        { id: "tour_piece", kind: "video", label: "Tour lent de la pièce", hint: "Filmez environ 30 secondes la pièce, des murs vers le tableau." },
      ]);
    }
    if (/peinture|enduit|fissure|plafond|mur/.test(text) || /peint/.test(job)) {
      return pick("Peinture", "Travaux de peinture / finitions", [
        { id: "vue_piece", kind: "photo", label: "Vue d’ensemble de la pièce", hint: "Reculez pour voir les murs et le plafond dans leur ensemble, de jour." },
        { id: "detail", kind: "photo", label: "Détail à traiter", hint: "Un gros plan de la fissure, tache ou zone à reprendre." },
        { id: "lumiere", kind: "photo", label: "La pièce avec sa lumière naturelle", hint: "Près d’une fenêtre, pour juger de l’état des surfaces." },
        { id: "angle", kind: "photo", label: "Un angle ou raccord de surface", hint: "Un coin, un plafond, ou la jonction mur / plafond." },
        { id: "parcours_murs", kind: "video", label: "Parcours lent des murs", hint: "Filmez environ 30 secondes en balayant lentement les surfaces à traiter." },
      ]);
    }
    if (/fenetre|porte|volet|menuiser/.test(text) || /menuis/.test(job)) {
      return pick("Menuiserie", "Menuiserie / ouvertures", [
        { id: "ensemble", kind: "photo", label: "Vue d’ensemble de l’ouverture", hint: "La porte ou la fenêtre entière, de face, de jour." },
        { id: "detail", kind: "photo", label: "Détail (paumelle, seuil, vitrage)", hint: "Le point à traiter, de près et net." },
        { id: "interieur", kind: "photo", label: "Côté intérieur", hint: "Le même ouvrant vu de l’intérieur, pour l’encombrement." },
        { id: "exterieur", kind: "photo", label: "Côté extérieur", hint: "L’ouvrant vu de l’extérieur, pour l’état du dormant." },
        { id: "manoeuvre", kind: "video", label: "Ouverture et fermeture", hint: "Filmez jusqu’à 30 secondes en ouvrant puis fermant lentement l’ouvrant." },
      ]);
    }
    return pick(metier || "Artisanat", "Demande de devis", [
      { id: "vue_ensemble", kind: "photo", label: "Vue d’ensemble de la zone concernée", hint: "Reculez un peu, de jour, pour situer le chantier dans son ensemble." },
      { id: "detail", kind: "photo", label: "Gros plan sur le détail à traiter", hint: "Approchez-vous du point précis, photo nette, sans flash." },
      { id: "contexte", kind: "photo", label: "Contexte autour de la zone", hint: "Ce qui se raccorde ou se trouve juste à côté." },
      { id: "acces", kind: "photo", label: "Accès et environnement", hint: "Le passage, l’escalier ou l’accès qui mènera l’artisan sur place." },
      { id: "parcours", kind: "video", label: "Parcours lent de la zone", hint: "Filmez environ 30 secondes, lentement, de l’ensemble vers le détail." },
    ]);
  }

  function localPrestations(item) {
    const details = String((item && item.details) || "").trim();
    const travaux = ((item && item.travaux) || []).filter(Boolean);
    const titre = travaux[0] || "Votre intervention";
    const text = (titre + " " + details).toLowerCase();
    const pack = (label, detail) => ({ label, detail, amount: 0 });
    if (/toit|tuile|ardoise|goutti|zinguer|fuite/.test(text)) {
      return [
        pack("Mise en sécurité et accès toiture", "Installation de l’accès et protection de la zone pour travailler en sécurité."),
        pack("Traitement de la zone endommagée", "Dépose des éléments abîmés et remplacement à l’identique, d’après ce qui se voit sur vos photos."),
        pack("Contrôle de l’étanchéité", "Vérification des raccords, gouttières et points sensibles autour de la réparation."),
        pack("Nettoyage de chantier", "Évacuation des déchets liés à l’intervention et remise en état de la zone de travail."),
      ];
    }
    if (/plomb|fuite|robinet|wc|chauffe|canalisation|evier|douche/.test(text)) {
      return [
        pack("Recherche du point à traiter", "Localisation précise de la fuite ou de l’appareil concerné, à partir de votre description et des photos."),
        pack("Intervention sur le réseau ou l’appareil", "Réparation ou remplacement de l’élément défaillant, selon le constat de l’artisan."),
        pack("Essai et contrôle", "Remise en eau, vérification qu’il n’y a plus de fuite, contrôle des raccords."),
        pack("Nettoyage de la zone", "Remise en état de l’espace de travail après intervention."),
      ];
    }
    if (/tableau|prise|eclairage|electri|borne|disjonct/.test(text)) {
      return [
        pack("Constat de l’installation", "Lecture du tableau et de la zone concernée, d’après vos photos, avant toute intervention."),
        pack("Réalisation des travaux électriques", "Pose, remplacement ou mise en conformité des éléments décrits dans votre demande."),
        pack("Essais et contrôles", "Vérification du bon fonctionnement après travaux."),
        pack("Remise en état", "Refermeture des ouvrages et nettoyage de la zone d’intervention."),
      ];
    }
    if (/peinture|enduit|fissure|plafond|mur/.test(text)) {
      return [
        pack("Préparation des supports", "Protection des abords, lessivage ou ponçage, reprise des fissures visibles."),
        pack("Application des finitions", "Sous-couche si besoin, puis peinture ou enduit sur les surfaces concernées."),
        pack("Reprises et détails", "Angles, plinthes et raccords pour un rendu homogène."),
        pack("Nettoyage de chantier", "Dépose des protections et évacuation des déchets."),
      ];
    }
    return [
      pack("Constat et préparation", "Vérification sur place des points vus sur vos photos, protection de la zone si besoin."),
      pack(titre.length > 4 ? titre : "Réalisation des travaux", details ? details.slice(0, 180) : "Exécution des travaux correspondant à votre demande, à confirmer par l’artisan."),
      pack("Contrôles après intervention", "Vérification du résultat et des points visibles avant de quitter le chantier."),
      pack("Finition et nettoyage", "Remise en état de la zone d’intervention et évacuation des déchets liés au chantier."),
    ];
  }

  function localFinalize(item) {
    const details = String((item && item.details) || "").trim();
    const nPhoto = ((item && item.photos) || []).filter((p) => p.kind !== "video").length;
    const travaux = ((item && item.travaux) || []).join(" · ") || "Intervention";
    const clientSummary =
      "Nous avons bien reçu votre demande" +
      (travaux ? " (« " + travaux + " »)" : "") +
      ". Voici le détail des travaux envisagés. L’artisan relit votre dossier et confirme le devis.";
    return {
      createdAt: Date.now(),
      hasPrice: false,
      priceMin: null,
      priceMax: null,
      complexity: "moyen",
      confidence: nPhoto >= 2 ? "calibre" : "debutant",
      confidenceNote: nPhoto
        ? "Dossier documenté par des photos. La visite ou un échange reste décisif."
        : "Peu de visuel : l’artisan pourra demander un complément.",
      observations:
        "Besoin : " +
        (details || travaux) +
        "\n\nPhotos : " +
        nPhoto +
        " cliché(s). Pas de chiffrage : aucune grille tarifaire n’a été utilisée.",
      clientSummary,
      sufficient: true,
      titrePredevis: ((item && item.travaux) || []).filter(Boolean)[0] || "Votre intervention",
      disclaimer:
        "Ce prédevis décrit les travaux envisagés. Il n’est pas un devis : l’artisan reste seul décisionnaire.",
      prestations: localPrestations(item),
      flags: [],
    };
  }

  function localReview(payload) {
    const photos = Array.isArray(payload && payload.images) ? payload.images : [];
    const extraTaken = Math.max(0, Number(payload && payload.extra_taken) || 0);
    const description = String((payload && payload.description) || "").trim();
    const sufficient = photos.length >= 1;
    return {
      ok: true,
      sufficient: sufficient || extraTaken >= 3,
      client_message: sufficient
        ? "Merci, votre dossier est suffisamment complet pour être transmis à l’artisan."
        : "Une photo supplémentaire aiderait l’artisan à bien comprendre le chantier.",
      besoin: description.slice(0, 700) || "Besoin décrit par le client.",
      observations:
        "Dossier constitué à partir de la description et de " +
        photos.length +
        " photo(s). À confirmer par l’artisan avant tout devis ferme.",
      vigilance: [],
      reserves: sufficient ? "" : "Quelques points pourront être confirmés au téléphone ou sur place.",
      extra_photos:
        sufficient || extraTaken >= 3
          ? []
          : [
              {
                id: "extra_complement",
                label: "Complément de la zone concernée",
                hint: "Un autre angle, de jour, un peu plus large pour situer le détail déjà photographié.",
              },
            ].slice(0, Math.max(0, 3 - extraTaken)).map((p) => ({ ...p, kind: p.kind || "photo" })),
    };
  }

  function applyLocalQualify(action, payload) {
    if (action === "plan") {
      return { ok: true, ...localPlan(payload.description, payload.metier) };
    }
    if (action === "validate_photo") {
      return { ok: true, accepted: true, message: "Merci, c’est bien reçu. On continue." };
    }
    if (action === "review") return localReview(payload);
    if (action === "finalize") {
      const publicId = payload.public_id || payload.publicId;
      const item = Object.assign({}, Store.get(publicId) || {}, payload.snapshot || {});
      const estimate = localFinalize(item);
      if (publicId && Store.backend !== "supabase") {
        writeLocal(
          readLocal().map((x) =>
            x.id === publicId ? { ...x, estimate, updatedAt: Date.now() } : x
          )
        );
      }
      return {
        ok: true,
        sufficient: true,
        client_message: estimate.clientSummary,
        besoin: item.details || "",
        observations: estimate.observations,
        vigilance: [],
        reserves: "",
        extra_photos: [],
        has_price: false,
        titre_predevis: estimate.titrePredevis,
        disclaimer: estimate.disclaimer,
        estimate,
      };
    }
    throw new Error("Action inconnue.");
  }

  function buildLocalEstimate(item) {
    return localFinalize(item);
  }

  function saveLocalArtisan(fields) {
    const list = readArtisans().length ? readArtisans() : [normalizeArtisan(SEED_ARTISAN)];
    if (list.some((a) => a.email === fields.email)) {
      throw new Error("Un atelier existe déjà avec cet e-mail. Connectez-vous au dashboard.");
    }
    const artisan = {
      id: artisanUid(),
      slug: uniqueSlug(slugify(fields.displayName), list),
      displayName: fields.displayName,
      metier: fields.metier,
      ville: fields.ville,
      telephone: fields.telephone,
      bio: fields.bio,
      tarifGrid: "",
      hasTarif: false,
      email: fields.email,
      passHash: fields.password ? hashPass(fields.password) : "",
      createdAt: Date.now(),
    };
    writeArtisans(list.concat([artisan]));
    return artisan;
  }

  function belongsToArtisan(item, artisan) {
    if (!artisan) return true;
    const aid = String(item.artisanId || DEFAULT_ARTISAN_ID);
    return aid === String(artisan.id) || (artisan.dbId != null && aid === String(artisan.dbId));
  }

  function enrichEstimate(mapped, publicId, extra) {
    if (!mapped || !mapped.estimate) return mapped;
    const est = mapped.estimate;
    const item = (extra && extra.snapshot) || Store.get(publicId) || {};
    const local = localFinalize(item);
    if (!String(est.clientSummary || "").trim()) est.clientSummary = local.clientSummary;
    if (!est.observations) est.observations = local.observations;
    if (!est.disclaimer) est.disclaimer = local.disclaimer;
    if (!est.titrePredevis) est.titrePredevis = local.titrePredevis;
    if (!Array.isArray(est.prestations) || !est.prestations.length) {
      est.prestations = local.prestations;
    }
    if (est.hasPrice !== true) {
      est.hasPrice = false;
      est.priceMin = null;
      est.priceMax = null;
      est.prestations = (est.prestations || []).map((p) => ({ ...p, amount: 0 }));
    }
    return mapped;
  }

  const Store = {
    statuses: STATUSES,
    metiers: METIERS,
    maxPhotos: MAX_PHOTOS,
    maxVideos: MAX_VIDEOS,
    defaultArtisanId: DEFAULT_ARTISAN_ID,

    get backend() {
      return isSupabaseConfigured() ? "supabase" : "local";
    },

    get lastError() {
      return lastError;
    },

    ready() {
      if (readyPromise) return readyPromise;
      readyPromise = (async () => {
        if (!isSupabaseConfigured()) return Store;
        await initSupabase();
        return Store;
      })();
      return readyPromise;
    },

    seedIfEmpty() {
      if (Store.backend === "supabase") return;
      if (!readArtisans().length) writeArtisans([SEED_ARTISAN]);
      if (readLocal().length) return;
      writeLocal(SEED);
    },

    currentArtisan() {
      if (currentArtisan) return currentArtisan;
      const id = readSessionArtisanId();
      if (id) {
        const local = readArtisans().find((a) => a.id === id);
        if (local) return local;
      }
      if (Store.backend === "supabase") return null;
      if (!signedIn && sessionStorage.getItem(SESSION) !== "1" && !id) return null;
      return readArtisans().find((a) => a.id === id) || normalizeArtisan(SEED_ARTISAN);
    },

    artisanQuery(artisan) {
      const ref = artisan && (artisan.slug || artisan.id);
      return ref ? "?a=" + encodeURIComponent(ref) : "";
    },

    listArtisans() {
      if (Store.backend === "supabase") return currentArtisan ? [currentArtisan] : [];
      const list = readArtisans();
      return list.length ? list : [normalizeArtisan(SEED_ARTISAN)];
    },

    async resolvePublicArtisan(ref) {
      await Store.ready();
      const key = String(ref || "").trim() || cfg().artisanPublicId || DEFAULT_ARTISAN_ID;
      const found = await fetchPublicArtisan(key);
      if (found) return found;
      if (key === DEFAULT_ARTISAN_ID || key === "atelier-lyon" || !ref) {
        return normalizeArtisan(SEED_ARTISAN);
      }
      return null;
    },

    list() {
      const artisan = Store.currentArtisan();
      const localOnly = artisan && artisan.dbId == null;
      const raw =
        Store.backend === "supabase" && !localOnly
          ? cache.slice()
          : readLocal().slice().sort((a, b) => b.createdAt - a.createdAt);
      return raw.map(normalize).filter((item) => !item.hiddenAt && belongsToArtisan(item, artisan));
    },

    hideConfirmMessage:
      "Supprimer cette demande de la liste ?\n\nElle disparaîtra du tableau, mais les données (photos, analyse IA, historique) resteront enregistrées pour améliorer l’IA plus tard.",

    displayName,

    localPrestations,

    formatTravaux(travaux) {
      if (Array.isArray(travaux)) return travaux.filter(Boolean).join(" · ") || "—";
      return travaux || "—";
    },

    get(id) {
      if (id == null || id === "") return null;
      const key = String(id);
      const raw =
        Store.backend === "supabase"
          ? cache.find((x) => x.id === key || String(x.dbId) === key)
          : readLocal().find((x) => x.id === key);
      return normalize(raw || null);
    },

    async hydratePhotos(item) {
      if (!item || Store.backend !== "supabase" || !client) return item;
      for (const photo of item.photos || []) {
        if (photo.dataUrl || photo.placeholder || !photo.path) continue;
        const { data } = await client.storage.from(BUCKET).createSignedUrl(photo.path, 3600);
        photo.dataUrl = (data && data.signedUrl) || "";
      }
      return item;
    },

    async create(payload) {
      lastError = null;
      await Store.ready();
      if (Store.backend !== "supabase") {
        const photos = (payload.photos || []).map((p, i) => {
          const kind = mediaKind(p);
          return {
            name: p.name || (kind === "video" ? "video" : "photo"),
            title: p.title || p.name || (kind === "video" ? "Vidéo " + (i + 1) : "Photo " + (i + 1)),
            kind,
            size: p.size || (p.file && p.file.size) || 0,
            mime: p.mime || (p.file && p.file.type) || "",
            dataUrl: kind === "video" ? "" : p.dataUrl || "",
            placeholder: kind === "video" ? "ph-slate" : "",
          };
        });
        const resolved = payload.artisanId
          ? { id: payload.artisanId }
          : await Store.resolvePublicArtisan(payload.artisanRef || "");
        const artisanRef = (resolved && resolved.id) || DEFAULT_ARTISAN_ID;
        const item = {
          id: uid(),
          artisanId: artisanRef,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          status: "nouveau",
          source: "widget",
          ...payload,
          artisanId: artisanRef,
          photos,
        };
        const list = readLocal();
        list.push(item);
        try {
          writeLocal(list);
        } catch {
          item.photos = [];
          writeLocal(readLocal().filter((x) => x.id !== item.id).concat([item]));
        }
        return item;
      }

      const photos = payload.photos || [];
      const travaux = Array.isArray(payload.travaux)
        ? payload.travaux.filter(Boolean)
        : payload.travaux
          ? [payload.travaux]
          : [];

      const artisan =
        (payload.artisanId || payload.artisanRef
          ? await Store.resolvePublicArtisan(payload.artisanId || payload.artisanRef)
          : null) || currentArtisan;
      const rpcBody = {
        p_prenom: payload.prenom,
        p_telephone: payload.tel,
        p_email: payload.email,
        p_code_postal: payload.cp,
        p_adresse: String(payload.adresse || "").trim() || null,
        p_surface: payload.surface ? Number(payload.surface) : null,
        p_anciennete: payload.anciennete || null,
        p_urgence: payload.urgence || null,
        p_details: payload.details || null,
        p_travaux: travaux,
        p_user_agent: navigator.userAgent || null,
        p_artisan_public_id: (artisan && artisan.id) || cfg().artisanPublicId || DEFAULT_ARTISAN_ID,
      };
      let { data: submitted, error } = await client.rpc("dv_submit_lead", rpcBody);
      if (error && /p_adresse|could not find/i.test(error.message || "")) {
        delete rpcBody.p_adresse;
        const retry = await client.rpc("dv_submit_lead", rpcBody);
        submitted = retry.data;
        error = retry.error;
      }
      if (error && /p_artisan_public_id|could not find/i.test(error.message || "")) {
        delete rpcBody.p_artisan_public_id;
        const retry = await client.rpc("dv_submit_lead", rpcBody);
        submitted = retry.data;
        error = retry.error;
      }
      throwIf(error, "L’envoi vers Supabase a échoué.");
      const lead = Array.isArray(submitted) ? submitted[0] : submitted;
      if (!lead || !lead.id) throw new Error("Supabase n’a pas renvoyé la demande créée.");

      await uploadPhotos(lead, photos);

      const mapped = mapLead({
        ...lead,
        dv_lead_travaux: travaux.map((t) => ({ travaux: t })),
        dv_photos: [],
      });
      cache = [mapped, ...cache.filter((x) => x.id !== mapped.id)];
      emit();
      return mapped;
    },

    async setStatus(id, status) {
      return Store.updateLead(id, { status });
    },

    async setStatusMany(ids, status) {
      return Store.updateLeads(ids, { status });
    },

    /**
     * Retire une ou plusieurs demandes du tableau artisan sans les
     * effacer en base : les données restent pour l’apprentissage IA.
     */
    async hideLead(id) {
      return Store.hideLeads([id]);
    },

    async hideLeads(ids) {
      lastError = null;
      try {
        await Store.updateLeads(ids, { hiddenAt: Date.now() });
      } catch (err) {
        const msg = err && err.message ? String(err.message) : "";
        if (/hidden_at/i.test(msg)) {
          throw new Error(
            "La colonne de masquage n’est pas encore en base. Exécutez la migration hidden_at dans le SQL Editor Supabase."
          );
        }
        throw err;
      }
    },

    async updateLeads(ids, patch) {
      lastError = null;
      await Store.ready();
      const list = [...new Set((ids || []).map((id) => String(id || "")).filter(Boolean))];
      if (!list.length) return;
      const dbPatch = {};
      if (patch.status != null) dbPatch.status = patch.status;
      if (patch.priorite != null) dbPatch.priorite = patch.priorite;
      if (patch.notesInternes != null) dbPatch.notes_internes = patch.notesInternes;
      if (Object.prototype.hasOwnProperty.call(patch, "rappelAt")) {
        dbPatch.rappel_at = patch.rappelAt || null;
      }
      if (Object.prototype.hasOwnProperty.call(patch, "prixReelHt")) {
        dbPatch.prix_reel_ht = patch.prixReelHt;
        dbPatch.prix_reel_at = patch.prixReelHt != null ? new Date().toISOString() : null;
      }
      if (Object.prototype.hasOwnProperty.call(patch, "hiddenAt")) {
        dbPatch.hidden_at = patch.hiddenAt ? new Date(patch.hiddenAt).toISOString() : null;
      }

      if (Store.backend !== "supabase") {
        const now = Date.now();
        writeLocal(
          readLocal().map((x) => (list.includes(x.id) ? { ...x, ...patch, updatedAt: now } : x))
        );
        return;
      }

      if (!Object.keys(dbPatch).length) return;
      const { error } = await client.from("dv_leads").update(dbPatch).in("public_id", list);
      throwIf(error, "Mise à jour impossible.");
      await fetchLeads();
      emit();
    },

    async updateLead(id, patch) {
      await Store.updateLeads([id], patch);
      return Store.get(id);
    },

    async requestAnalysis(id, force, extra) {
      lastError = null;
      await Store.ready();
      const item = Store.get(id);
      const publicId = item ? item.id : id;
      if (Store.backend !== "supabase") {
        const current = Store.get(publicId);
        if (!current) throw new Error("Demande introuvable.");
        return applyLocalQualify("finalize", { public_id: publicId, snapshot: current });
      }
      const mapped = await requestAnalysis(publicId, force, extra);
      return enrichEstimate(mapped, publicId, extra);
    },

    async qualify(action, payload) {
      lastError = null;
      await Store.ready();
      const body = payload || {};
      if (Store.backend !== "supabase" || !client) {
        return applyLocalQualify(action, body);
      }
      try {
        return await invokeQualify(action, body);
      } catch (err) {
        console.warn("Qualification IA indisponible, repli local :", err && err.message);
        return applyLocalQualify(action, body);
      }
    },

    async saveTarifGrid(text) {
      lastError = null;
      await Store.ready();
      const tarif = String(text || "").trim();
      if (Store.backend !== "supabase" || !client) {
        const artisan = Store.currentArtisan();
        if (!artisan) throw new Error("Connectez-vous pour enregistrer la grille.");
        const list = readArtisans();
        const next = list.map((a) =>
          a.id === artisan.id ? { ...a, tarifGrid: tarif, hasTarif: Boolean(tarif) } : a
        );
        if (!list.length) {
          writeArtisans([{ ...artisan, tarifGrid: tarif, hasTarif: Boolean(tarif) }]);
        } else {
          writeArtisans(next);
        }
        currentArtisan = { ...artisan, tarifGrid: tarif, hasTarif: Boolean(tarif) };
        return currentArtisan;
      }
      const rpc = await client.rpc("dv_save_tarif_grid", { p_tarif: tarif || null });
      if (rpc.error) throwIf(rpc.error, "Impossible d’enregistrer la grille tarifaire.");
      if (currentArtisan) {
        currentArtisan = {
          ...currentArtisan,
          tarifGrid: tarif,
          hasTarif: Boolean(tarif),
        };
      }
      return currentArtisan;
    },

    async appendPhotos(leadRef, photos) {
      lastError = null;
      await Store.ready();
      const list = Array.isArray(photos) ? photos.filter(Boolean) : [];
      if (!list.length) return;
      const publicId = leadRef && (leadRef.id || leadRef.public_id || leadRef);
      const dbId = leadRef && (leadRef.dbId || leadRef.leadId);
      if (Store.backend !== "supabase") {
        const id = String(publicId || "");
        const mapped = list.map((p, i) => {
          const kind = mediaKind(p);
          return {
            name: p.name || (kind === "video" ? "video" : "photo"),
            title: p.title || p.name || (kind === "video" ? "Vidéo" : "Photo") + " " + (i + 1),
            kind,
            size: p.size || (p.file && p.file.size) || 0,
            mime: p.mime || (p.file && p.file.type) || "",
            dataUrl: kind === "video" ? "" : p.dataUrl || "",
            placeholder: kind === "video" ? "ph-slate" : "",
          };
        });
        writeLocal(
          readLocal().map((x) =>
            x.id === id ? { ...x, photos: (x.photos || []).concat(mapped), updatedAt: Date.now() } : x
          )
        );
        return;
      }
      if (!dbId) throw new Error("Impossible d’ajouter des photos à cette demande.");
      await uploadPhotos({ id: dbId, public_id: publicId }, list, {
        prefix: "r" + Date.now() + "-",
        orderBase: 20,
      });
    },

    async refineLead(leadRef, payload) {
      lastError = null;
      await Store.ready();
      const details = String((payload && payload.details) || "").trim();
      const photos = (payload && payload.photos) || [];
      const publicId = leadRef && (leadRef.id || leadRef.public_id);
      if (details && Store.backend === "supabase" && client && publicId) {
        const rpc = await client.rpc("dv_public_refine_lead", {
          p_public_id: publicId,
          p_details: details,
        });
        if (rpc.error) {
          console.warn("Précision client non enregistrée :", rpc.error.message);
        }
      } else if (details && Store.backend !== "supabase" && publicId) {
        writeLocal(
          readLocal().map((x) => {
            if (x.id !== publicId) return x;
            const prev = String(x.details || "").trim();
            return {
              ...x,
              details: prev
                ? prev + "\n\n--- Précision client ---\n" + details
                : details,
              updatedAt: Date.now(),
            };
          })
        );
      }
      if (photos.length) await Store.appendPhotos(leadRef, photos);
      return Store.requestAnalysis(publicId, true, {
        clientNotes: details,
        snapshot: leadRef,
      });
    },

    async addEvent(id, message, kind) {
      lastError = null;
      await Store.ready();
      const item = Store.get(id);
      if (!item) throw new Error("Demande introuvable.");
      const event = {
        createdAt: Date.now(),
        kind: kind || "note",
        message,
      };
      if (Store.backend !== "supabase") {
        const list = readLocal().map((x) => {
          if (x.id !== id) return x;
          return { ...x, events: (x.events || []).concat([event]), updatedAt: Date.now() };
        });
        writeLocal(list);
        return Store.get(id);
      }
      const { error } = await client.from("dv_lead_events").insert({
        lead_id: item.dbId,
        kind: event.kind,
        message: event.message,
      });
      throwIf(error, "Impossible d’ajouter l’événement.");
      await fetchLeads();
      emit();
      return Store.get(id);
    },

    async resetDemo() {
      if (Store.backend === "supabase") {
        lastError = "Les exemples cloud se rechargent depuis le SQL Editor, pas depuis ce bouton.";
        return;
      }
      writeArtisans([SEED_ARTISAN]);
      writeLocal(SEED);
    },

    async createArtisan(payload) {
      lastError = null;
      await Store.ready();
      const displayName = String(payload.displayName || "").trim();
      const metier = String(payload.metier || "").trim() || "Artisan";
      const ville = String(payload.ville || "").trim();
      const telephone = String(payload.telephone || "").trim();
      const bio = String(payload.bio || "").trim();
      const email = String(payload.email || "").trim().toLowerCase();
      const password = String(payload.password || "");
      if (!displayName) throw new Error("Indiquez le nom de l’atelier.");
      if (!email || !email.includes("@")) throw new Error("Indiquez un e-mail valide.");
      if (password.length < 6) throw new Error("Le mot de passe doit faire au moins 6 caractères.");

      if (Store.backend !== "supabase") {
        const artisan = saveLocalArtisan({
          displayName,
          metier,
          ville,
          telephone,
          bio,
          email,
          password,
        });
        sessionStorage.setItem(SESSION, "1");
        sessionStorage.setItem(SESSION_ARTISAN, artisan.id);
        currentArtisan = artisan;
        signedIn = true;
        emit();
        return { artisan, needsConfirm: false };
      }

      const { data: signed, error: signErr } = await client.auth.signUp({
        email,
        password,
      });
      if (signErr) {
        const already = /already|registered|exists/i.test(signErr.message || "");
        if (already) {
          try {
            const artisan = saveLocalArtisan({
              displayName,
              metier,
              ville,
              telephone,
              bio,
              email,
              password,
            });
            sessionStorage.setItem(SESSION, "1");
            sessionStorage.setItem(SESSION_ARTISAN, artisan.id);
            currentArtisan = artisan;
            signedIn = true;
            emit();
            return { artisan, needsConfirm: false };
          } catch {
            throwIf(signErr, "Impossible de créer le compte artisan.");
          }
        }
        throwIf(signErr, "Impossible de créer le compte artisan.");
      }
      if (!signed || !signed.session) {
        const artisan = saveLocalArtisan({
          displayName,
          metier,
          ville,
          telephone,
          bio,
          email,
          password,
        });
        sessionStorage.setItem(SESSION, "1");
        sessionStorage.setItem(SESSION_ARTISAN, artisan.id);
        currentArtisan = artisan;
        signedIn = true;
        emit();
        return { artisan, needsConfirm: true, email };
      }
      signedIn = true;
      const rpc = await client.rpc("dv_register_artisan", {
        p_display_name: displayName,
        p_metier: metier,
        p_ville: ville || null,
        p_telephone: telephone || null,
        p_bio: bio || null,
        p_slug: slugify(displayName),
      });
      if (rpc.error) {
        const msg = rpc.error.message || "";
        if (/could not find|schema cache|does not exist|dv_register_artisan/i.test(msg)) {
          const artisan = saveLocalArtisan({
            displayName,
            metier,
            ville,
            telephone,
            bio,
            email,
            password,
          });
          currentArtisan = artisan;
          sessionStorage.setItem(SESSION_ARTISAN, artisan.id);
          emit();
          return { artisan, needsConfirm: false };
        }
        throwIf(rpc.error, "Le compte est créé, mais le profil artisan n’a pas pu être enregistré. Exécutez la migration multi-artisans dans Supabase.");
      }
      const row = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
      currentArtisan = normalizeArtisan(
        row && row.public_id
          ? {
              public_id: row.public_id,
              id: row.id,
              slug: row.slug,
              display_name: displayName,
              metier,
              ville,
              telephone,
              bio,
              email,
            }
          : null
      );
      if (!currentArtisan) await loadArtisanFromAuth();
      if (currentArtisan) sessionStorage.setItem(SESSION_ARTISAN, currentArtisan.id);
      emit();
      return { artisan: currentArtisan, needsConfirm: false };
    },

    subscribe(fn) {
      const on = () => fn(Store.list());
      global.addEventListener("devis:change", on);
      global.addEventListener("storage", (e) => {
        if (e.key === KEY) on();
      });
      return () => global.removeEventListener("devis:change", on);
    },

    isLoggedIn() {
      if (Store.backend === "supabase") {
        if (signedIn) return true;
        return sessionStorage.getItem(SESSION) === "1" && Boolean(readSessionArtisanId());
      }
      return sessionStorage.getItem(SESSION) === "1";
    },

    async hasSession() {
      await Store.ready();
      if (Store.backend !== "supabase") return Store.isLoggedIn();
      const { data } = await client.auth.getSession();
      signedIn = Boolean(data && data.session);
      if (signedIn && !currentArtisan) await loadArtisanFromAuth();
      if (signedIn) return true;
      if (sessionStorage.getItem(SESSION) === "1") {
        const id = readSessionArtisanId();
        const local = id && readArtisans().find((a) => a.id === id);
        if (local) {
          currentArtisan = local;
          return true;
        }
      }
      return false;
    },

    async login(email, password) {
      lastError = null;
      await Store.ready();
      const mail = String(email || "").trim().toLowerCase();
      if (Store.backend !== "supabase") {
        const artisans = readArtisans().length ? readArtisans() : [normalizeArtisan(SEED_ARTISAN)];
        const artisan = artisans.find((a) => a.email === mail);
        if (!artisan) {
          throw new Error("Aucun atelier avec cet e-mail. Créez d’abord une page artisan.");
        }
        if (artisan.passHash) {
          if (hashPass(password) !== artisan.passHash) {
            throw new Error("Mot de passe incorrect.");
          }
        } else if (String(password || "").length < 4) {
          throw new Error("Indiquez un mot de passe d’au moins 4 caractères (démo).");
        }
        sessionStorage.setItem(SESSION, "1");
        sessionStorage.setItem(SESSION_ARTISAN, artisan.id);
        currentArtisan = artisan;
        signedIn = true;
        return artisan;
      }
      const { error } = await client.auth.signInWithPassword({
        email: mail,
        password: password,
      });
      if (error) {
        const local = readArtisans().find((a) => a.email === mail);
        if (local && local.passHash && hashPass(password) === local.passHash) {
          sessionStorage.setItem(SESSION, "1");
          sessionStorage.setItem(SESSION_ARTISAN, local.id);
          currentArtisan = local;
          signedIn = true;
          return local;
        }
        throwIf(error, "Connexion Supabase refusée.");
      }
      signedIn = true;
      await loadArtisanFromAuth();
      if (!currentArtisan) {
        const local = readArtisans().find((a) => a.email === mail);
        if (local) {
          currentArtisan = local;
          sessionStorage.setItem(SESSION_ARTISAN, local.id);
        }
      }
      await fetchLeads();
      emit();
      return currentArtisan;
    },

    async logout() {
      if (Store.backend === "supabase" && client) {
        await client.auth.signOut();
        cache = [];
      }
      signedIn = false;
      currentArtisan = null;
      sessionStorage.removeItem(SESSION);
      sessionStorage.removeItem(SESSION_ARTISAN);
    },
  };

  global.DevisStore = Store;
})(window);
