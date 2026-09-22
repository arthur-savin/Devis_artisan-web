(async function () {
  const store = window.DevisStore;
  const STATUS = {
    nouveau: "Nouveau",
    contacte: "Contacté",
    devis_envoye: "Devis envoyé",
    gagne: "Gagné",
    perdu: "Perdu",
    archive: "Archivé",
  };
  const SOURCE = {
    widget: "Via le widget du site",
  };
  const COMPLEXITY = {
    simple: { label: "Simple", chip: "chip-simple" },
    moyen: { label: "Moyen", chip: "chip-mid" },
    complexe: { label: "Complexe", chip: "chip-complex" },
  };
  const CONFIDENCE = {
    debutant: { label: "Débutant", dots: 1 },
    calibre: { label: "Calibré", dots: 2 },
    fiable: { label: "Fiable", dots: 3 },
  };
  const PLACEHOLDER_ICONS = {
    "ph-navy":
      '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="6" y="3" width="12" height="18" rx="2"/><path d="M10 8h4M10 12h4M10 16h2"/></svg>',
    "ph-clay":
      '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 20V10l8-6 8 6v10"/><path d="M9 20v-6h6v6"/></svg>',
    "ph-sage":
      '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3 11c.3.5.5 1 .5 1.5h5c0-.5.2-1 .5-1.5A6 6 0 0 0 12 3z"/></svg>',
    "ph-slate":
      '<svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="m21 15-4.5-4.5L9 18"/></svg>',
  };

  const loadingPage = document.getElementById("loadingPage");
  const missingPage = document.getElementById("missingPage");
  const headerEl = document.querySelector(".topbar");
  const mainEl = document.querySelector("main.page");
  const statusBtn = document.getElementById("statusBtn");
  const statusMenu = document.getElementById("statusMenu");
  const prixReel = document.getElementById("prixReel");
  const toastEl = document.getElementById("toast");
  const lightbox = document.getElementById("lightbox");
  const lbFrame = document.getElementById("lbFrame");
  const photoAskModal = document.getElementById("photoAskModal");
  const photoAskBanner = document.getElementById("photoAskBanner");

  let item = null;
  let photoIndex = 0;
  let toastTimer;

  function dash() {
    return String(item && item.id ? "./index.html" : "./index.html");
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("is-on"), 2800);
  }

  function text(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value == null || value === "" ? "—" : String(value);
  }

  function money(n) {
    if (n == null || Number.isNaN(Number(n))) return "—";
    return new Intl.NumberFormat("fr-FR").format(Number(n)) + "\u00a0€";
  }

  function fmtDate(ts, withTime) {
    if (!ts) return "—";
    const opts = withTime
      ? { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
      : { day: "numeric", month: "short", year: "numeric" };
    return new Intl.DateTimeFormat("fr-FR", opts).format(ts);
  }

  function elapsed(ts) {
    if (!ts) return "";
    const diff = Date.now() - ts;
    const min = Math.max(0, Math.round(diff / 60000));
    if (min < 1) return "à l’instant";
    if (min < 60) return "il y a " + min + " min";
    const h = Math.round(min / 60);
    if (h < 24) return "il y a " + h + " h";
    const d = Math.round(h / 24);
    return "il y a " + d + " j";
  }

  function telHref(tel) {
    const digits = String(tel || "").replace(/\s+/g, "");
    if (!digits) return "";
    if (digits.startsWith("+")) return "tel:" + digits;
    if (digits.startsWith("0")) return "tel:+33" + digits.slice(1);
    return "tel:" + digits;
  }

  function closeStatus() {
    statusMenu.classList.remove("is-open");
    statusBtn.setAttribute("aria-expanded", "false");
  }

  function applyStatusUi(key) {
    statusBtn.dataset.status = key;
    statusBtn.textContent = STATUS[key] || key;
    statusMenu.querySelectorAll("[data-set-status]").forEach((b) => {
      b.classList.toggle("is-on", b.dataset.setStatus === key);
    });
    prixReel.hidden = key !== "gagne";
  }

  function renderPhotos() {
    const box = document.getElementById("photos");
    const empty = document.getElementById("photosEmpty");
    const photos = (item && item.photos) || [];
    const nPhoto = photos.filter((p) => p.kind !== "video").length;
    const nVideo = photos.filter((p) => p.kind === "video").length;
    const analyzed = photos.find((p) => p.analyzedAt);
    const lead = document.getElementById("photosLead");
    if (lead) {
      const parts = [];
      if (nPhoto) parts.push(nPhoto + " photo" + (nPhoto > 1 ? "s" : ""));
      if (nVideo) parts.push(nVideo + " vidéo" + (nVideo > 1 ? "s" : ""));
      lead.textContent = parts.length
        ? parts.join(" · ") +
          (analyzed ? " · analyse le " + fmtDate(analyzed.analyzedAt, true) : "")
        : "Aucun média joint à cette demande.";
    }
    if (!photos.length) {
      box.innerHTML = "";
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    box.innerHTML = photos
      .map((p, i) => {
        const isVideo = p.kind === "video";
        const label = p.title || p.name || (isVideo ? "Vidéo " + (i + 1) : "Photo " + (i + 1));
        const src = (p.dataUrl || "").replace(/"/g, "&quot;");
        let inner;
        if (src && isVideo) {
          inner =
            '<video src="' +
            src +
            '" muted playsinline preload="metadata"></video><span class="thumb-play" aria-hidden="true"><span>▶</span></span>';
        } else if (src) {
          inner = '<img src="' + src + '" alt="' + label.replace(/"/g, "&quot;") + '" />';
        } else {
          inner =
            '<div class="ph ' +
            (p.placeholder || "ph-navy") +
            '">' +
            (PLACEHOLDER_ICONS[p.placeholder] || PLACEHOLDER_ICONS["ph-navy"]) +
            "</div>" +
            (isVideo ? '<span class="thumb-play" aria-hidden="true"><span>▶</span></span>' : "");
        }
        const meta = p.size ? Math.max(0.1, p.size / 1048576).toFixed(1) + " Mo" : isVideo ? "Vidéo" : "Photo";
        return (
          '<button type="button" class="thumb' +
          (isVideo ? " is-video" : "") +
          '" data-photo="' +
          i +
          '" aria-label="Ouvrir ' +
          label.replace(/"/g, "&quot;") +
          '">' +
          inner +
          '<span class="thumb-badge">' +
          (isVideo ? "Vidéo · " : "") +
          label.replace(/</g, "&lt;") +
          " · " +
          meta +
          "</span></button>"
        );
      })
      .join("");
  }

  function renderTimeline() {
    const ol = document.getElementById("timeline");
    ol.innerHTML = "";
    ((item && item.events) || []).forEach((ev) => {
      const li = document.createElement("li");
      const strong = document.createElement("strong");
      const time = document.createElement("time");
      strong.textContent = ev.message || ev.kind || "Événement";
      time.textContent = fmtDate(ev.createdAt, true);
      if (ev.createdAt) time.dateTime = new Date(ev.createdAt).toISOString();
      li.appendChild(strong);
      li.appendChild(time);
      ol.appendChild(li);
    });
  }

  function renderEstimate() {
    const empty = document.getElementById("aiEmpty");
    const content = document.getElementById("aiContent");
    const est = item && item.estimate;
    const events = (item && item.events) || [];
    const failed = events.some((ev) => ev.kind === "analyse_erreur");
    const pending =
      events.some((ev) => ev.kind === "recue") && !events.some((ev) => ev.kind === "analyse_ia");
    if (!est) {
      empty.hidden = false;
      content.hidden = true;
      if (failed) {
        empty.textContent = "L’analyse IA a échoué. Relance-la depuis le bouton ci-dessous.";
      } else if (pending) {
        empty.textContent = "Analyse en cours… la synthèse arrive dans quelques secondes.";
      } else {
        empty.textContent =
          "Pas encore de synthèse IA pour cette demande. Relancez-la depuis le bouton ci-dessous.";
      }
      return;
    }
    empty.hidden = true;
    content.hidden = false;
    const hasPrice = est.hasPrice === true && (est.priceMin != null || est.priceMax != null);
    const priceEl = document.getElementById("aiPrice");
    if (hasPrice) {
      priceEl.hidden = false;
      priceEl.innerHTML =
        money(est.priceMin) +
        " — " +
        money(est.priceMax) +
        "<small>estimation indicative, non contractuelle</small>";
    } else {
      priceEl.hidden = false;
      priceEl.innerHTML = "Pas de tarif communiqué<small>aucune grille artisan utilisée</small>";
    }
    const cx = COMPLEXITY[est.complexity] || COMPLEXITY.moyen;
    const chip = document.getElementById("aiComplexity");
    chip.className = "chip " + cx.chip;
    chip.textContent = "Complexité · " + cx.label;
    const conf = CONFIDENCE[est.confidence] || CONFIDENCE.calibre;
    document.getElementById("aiConfTitle").textContent = "Score de confiance · " + conf.label;
    document.getElementById("aiConfNote").textContent = est.confidenceNote || "—";
    const dots = document.getElementById("aiDots");
    dots.innerHTML = "";
    for (let i = 0; i < 3; i++) {
      const mark = document.createElement("i");
      if (i < conf.dots) mark.className = "on";
      dots.appendChild(mark);
    }
    const ul = document.getElementById("aiPrestations");
    ul.innerHTML = "";
    const lines = est.prestations || [];
    if (!lines.length) {
      const li = document.createElement("li");
      li.textContent = "Aucun détail de travaux n’a encore été listé pour ce dossier.";
      ul.appendChild(li);
    } else {
      lines.forEach((p) => {
        const li = document.createElement("li");
        const wrap = document.createElement("span");
        const title = document.createElement("strong");
        title.textContent = p.label;
        wrap.appendChild(title);
        if (p.detail) {
          wrap.appendChild(document.createElement("br"));
          const detail = document.createElement("small");
          detail.textContent = p.detail;
          wrap.appendChild(detail);
        }
        li.appendChild(wrap);
        if (est.hasPrice && Number(p.amount) > 0) {
          const amt = document.createElement("span");
          amt.className = "amt";
          amt.textContent = money(p.amount);
          li.appendChild(amt);
        }
        ul.appendChild(li);
      });
    }
    document.getElementById("aiObs").textContent = est.observations || "—";
    const flags = document.getElementById("aiFlags");
    flags.innerHTML = "";
    (est.flags || []).forEach((f) => {
      const div = document.createElement("div");
      div.className = f.kind === "alerte" ? "alert" : "reco";
      const title = f.kind === "alerte" ? "Alerte — " : "Recommandation — ";
      div.textContent = title + (f.message || "");
      flags.appendChild(div);
    });
  }

  function render(current) {
    item = current;
    const name = store.displayName(item);
    const travaux = store.formatTravaux(item.travaux);
    const lieu = [item.ville, item.cp].filter(Boolean).join(" ") || "—";
    document.title = name + " — Fiche lead";
    text("topName", name);
    text("topSub", lieu + " · " + travaux);
    text("submittedLabel", "Reçue le " + fmtDate(item.createdAt, true));
    text("clientName", name);
    const telLink = document.getElementById("clientTel");
    telLink.textContent = item.tel || "—";
    telLink.href = telHref(item.tel) || "#";
    const mailLink = document.getElementById("clientEmail");
    mailLink.textContent = item.email || "—";
    mailLink.href = item.email ? "mailto:" + item.email : "#";
    const addr = [item.adresse, [item.cp, item.ville].filter(Boolean).join(" ")].filter(Boolean);
    document.getElementById("clientAddress").innerHTML = addr.length
      ? addr.map((line) => line.replace(/</g, "&lt;")).join("<br />")
      : "—";
    text("clientSource", SOURCE[item.source] || item.source || "—");
    text("clientWhen", fmtDate(item.createdAt, true));
    text("clientElapsed", elapsed(item.createdAt));
    text("formTravaux", travaux);
    text("formSurface", item.surface ? item.surface + " m²" : "—");
    text("formAnciennete", item.anciennete);
    text("formUrgence", item.urgence);
    text("formTableau", item.tableau);
    text("formAcces", item.acces);
    text("formTerre", item.miseATerre);
    text("formCircuits", item.circuits);
    text("formPieces", item.pieces);
    text("formProjet", item.projet);
    text("formDetails", item.details);
    document.getElementById("notes").value = item.notesInternes || "";
    document.getElementById("rappel").value = item.rappelAt || "";
    document.querySelectorAll("#prio button").forEach((b) => {
      b.classList.toggle("is-on", b.dataset.prio === (item.priorite || "normale"));
    });
    if (item.prixReelHt != null) {
      document.getElementById("prixReelInput").value = String(item.prixReelHt);
    }
    applyStatusUi(item.status || "nouveau");
    renderPhotos();
    renderEstimate();
    renderTimeline();
  }

  function showMissing() {
    loadingPage.hidden = true;
    headerEl.hidden = true;
    mainEl.hidden = true;
    missingPage.hidden = false;
  }

  function showFiche() {
    loadingPage.hidden = true;
    missingPage.hidden = true;
    headerEl.hidden = false;
    mainEl.hidden = false;
  }

  function renderLightbox() {
    const photos = item.photos || [];
    const p = photos[photoIndex];
    if (!p) return;
    const prev = lbFrame.querySelector("video");
    if (prev) prev.pause();
    if (p.dataUrl && p.kind === "video") {
      lbFrame.innerHTML =
        '<video src="' +
        p.dataUrl.replace(/"/g, "&quot;") +
        '" controls playsinline autoplay></video>';
    } else if (p.dataUrl) {
      lbFrame.innerHTML = '<img src="' + p.dataUrl.replace(/"/g, "&quot;") + '" alt="" />';
    } else {
      const cls = p.placeholder || "ph-navy";
      lbFrame.innerHTML = '<div class="ph ' + cls + '">' + (PLACEHOLDER_ICONS[cls] || PLACEHOLDER_ICONS["ph-navy"]) + "</div>";
    }
    document.getElementById("lbTitle").textContent = p.title || p.name || (p.kind === "video" ? "Vidéo" : "Photo");
    document.getElementById("lbMeta").textContent =
      (p.kind === "video" ? "Vidéo · " : "") + (photoIndex + 1) + " / " + photos.length;
  }

  function openLightbox(i) {
    photoIndex = i;
    renderLightbox();
    lightbox.hidden = false;
    lightbox.classList.add("is-open");
  }

  function closeLightbox() {
    const vid = lbFrame.querySelector("video");
    if (vid) vid.pause();
    lightbox.classList.remove("is-open");
    lightbox.hidden = true;
  }

  function openPhotoAsk() {
    photoAskModal.hidden = false;
    photoAskModal.classList.add("is-open");
  }

  function closePhotoAsk() {
    photoAskModal.classList.remove("is-open");
    photoAskModal.hidden = true;
  }

  function greetingName(lead) {
    const prenom = String((lead && lead.prenom) || "").trim();
    if (prenom) return prenom;
    const full = store.displayName(lead);
    return full && full !== "Client" ? full : "";
  }

  function chantierLines(lead) {
    const travaux = store.formatTravaux(lead && lead.travaux);
    const addr = [lead && lead.adresse, [lead && lead.cp, lead && lead.ville].filter(Boolean).join(" ")]
      .filter(Boolean)
      .join(", ");
    const lines = [];
    if (travaux && travaux !== "—") lines.push("Travaux : " + travaux);
    if (addr) lines.push("Adresse : " + addr);
    if (lead && lead.surface) lines.push("Surface : " + lead.surface + " m²");
    return lines;
  }

  function buildPhotoAskMail(lead, chosen, note) {
    const artisan = store.currentArtisan() || {};
    const who = greetingName(lead);
    const chantier = chantierLines(lead);
    const body = [];
    body.push(who ? "Bonjour " + who + "," : "Bonjour,");
    body.push("");
    body.push(
      "Pour affiner votre devis, j’aurais besoin de quelques photos supplémentaires de votre installation."
    );
    if (chantier.length) {
      body.push("");
      body.push(chantier.join("\n"));
    }
    if (chosen.length) {
      body.push("");
      body.push("Photos souhaitées :");
      chosen.forEach((line) => body.push("• " + line));
    }
    if (note) {
      body.push("");
      body.push("Précision : " + note);
    }
    body.push("");
    body.push("Vous pouvez simplement répondre à cet e-mail en joignant les clichés (lumière du jour, sans flash si possible).");
    body.push("");
    body.push("Merci d’avance,");
    const atelier = artisan.displayName || "Votre artisan";
    body.push(atelier);
    if (artisan.metier) body.push(artisan.metier);
    if (artisan.telephone) body.push(artisan.telephone);
    if (artisan.email) body.push(artisan.email);
    const lieu = [lead && lead.ville, lead && lead.cp].filter(Boolean).join(" ");
    const subjectParts = ["Photos complémentaires — devis"];
    const travaux = store.formatTravaux(lead && lead.travaux);
    if (travaux && travaux !== "—") subjectParts.push(travaux);
    if (lieu) subjectParts.push(lieu);
    return {
      subject: subjectParts.join(" · "),
      body: body.join("\n"),
    };
  }

  function openMailto(email, subject, body) {
    const safeEmail = String(email || "").trim();
    const href =
      "mailto:" +
      safeEmail +
      "?subject=" +
      encodeURIComponent(subject) +
      "&body=" +
      encodeURIComponent(body);
    const link = document.createElement("a");
    link.href = href;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function persist(action) {
    try {
      const next = await action();
      if (next) render(next);
      return next;
    } catch (err) {
      toast(err.message || "Enregistrement impossible.");
      return null;
    }
  }

  statusBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = statusMenu.classList.toggle("is-open");
    statusBtn.setAttribute("aria-expanded", open ? "true" : "false");
  });

  statusMenu.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-set-status]");
    if (!btn || !item) return;
    const key = btn.dataset.setStatus;
    closeStatus();
    const next = await persist(async () => {
      await store.updateLead(item.id, { status: key });
      return store.addEvent(item.id, "Statut : " + (STATUS[key] || key), "statut");
    });
    if (next) toast("Statut mis à jour : " + (STATUS[key] || key));
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".status-wrap")) closeStatus();
  });

  document.getElementById("btnBack").addEventListener("click", (e) => {
    e.preventDefault();
    window.location.href = dash();
  });

  document.getElementById("btnCall").addEventListener("click", () => {
    const href = telHref(item && item.tel);
    if (href) window.location.href = href;
    toast("Appel de " + store.displayName(item) + (item.tel ? " — " + item.tel : ""));
  });

  document.getElementById("btnTreated").addEventListener("click", async () => {
    if (!item) return;
    const nextStatus = item.status === "nouveau" ? "contacte" : item.status;
    const next = await persist(async () => {
      if (nextStatus !== item.status) await store.updateLead(item.id, { status: nextStatus });
      return store.addEvent(item.id, "Dossier marqué comme traité", "statut");
    });
    if (next) toast("Dossier marqué comme traité");
  });

  document.getElementById("btnHide").addEventListener("click", async () => {
    if (!item) return;
    const btn = document.getElementById("btnHide");
    btn.disabled = true;
    try {
      await store.hideLead(item.id);
      window.location.href = dash();
    } catch (err) {
      btn.disabled = false;
    }
  });

  document.getElementById("aiRetry").addEventListener("click", async () => {
    if (!item) return;
    const btn = document.getElementById("aiRetry");
    btn.disabled = true;
    toast("Analyse relancée…");
    try {
      await store.requestAnalysis(item.id, true);
      const next = store.get(item.id);
      if (next) {
        await store.hydratePhotos(next);
        render(next);
      }
      toast(next && next.estimate ? "Analyse IA mise à jour" : "Analyse lancée");
    } catch (err) {
      toast(err.message || "Analyse IA impossible.");
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById("saveNotes").addEventListener("click", async () => {
    const notesInternes = document.getElementById("notes").value;
    const next = await persist(() => store.updateLead(item.id, { notesInternes }));
    if (next) toast("Notes internes enregistrées");
  });

  document.getElementById("prio").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-prio]");
    if (!btn || !item) return;
    const priorite = btn.dataset.prio;
    const next = await persist(() => store.updateLead(item.id, { priorite }));
    const labels = { faible: "Faible", normale: "Normale", haute: "Haute" };
    if (next) toast("Priorité : " + labels[priorite]);
  });

  document.getElementById("rappel").addEventListener("change", async (e) => {
    const next = await persist(() => store.updateLead(item.id, { rappelAt: e.target.value || "" }));
    if (next) {
      toast(e.target.value ? "Rappel planifié le " + e.target.value.split("-").reverse().join("/") : "Rappel retiré");
    }
  });

  document.getElementById("savePrix").addEventListener("click", async () => {
    const val = document.getElementById("prixReelInput").value;
    if (!val) {
      toast("Indiquez un montant avant d’enregistrer");
      return;
    }
    const next = await persist(() => store.updateLead(item.id, { prixReelHt: Number(val) }));
    if (next) toast("Retour enregistré : " + Number(val).toLocaleString("fr-FR") + " €");
  });

  document.getElementById("addEvent").addEventListener("click", addEvent);
  document.getElementById("eventText").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addEvent();
  });

  async function addEvent() {
    const input = document.getElementById("eventText");
    const textVal = input.value.trim();
    if (!textVal) {
      toast("Saisissez un événement");
      return;
    }
    const next = await persist(() => store.addEvent(item.id, textVal, "note"));
    if (!next) return;
    input.value = "";
    toast("Événement ajouté à l’historique");
  }

  document.getElementById("btnAskPhotos").addEventListener("click", openPhotoAsk);
  document.getElementById("photoAskClose").addEventListener("click", closePhotoAsk);
  document.getElementById("photoAskCancel").addEventListener("click", closePhotoAsk);
  photoAskModal.addEventListener("click", (e) => {
    if (e.target === photoAskModal) closePhotoAsk();
  });

  document.getElementById("photoAskSend").addEventListener("click", async () => {
    const chosen = [...document.querySelectorAll('input[name="photoAsk"]:checked')].map((el) => el.value);
    const note = document.getElementById("photoAskNote").value.trim();
    if (!chosen.length && !note) {
      toast("Choisissez au moins une photo à demander");
      return;
    }
    const email = String((item && item.email) || "").trim();
    if (!email || !email.includes("@")) {
      toast("Ce client n’a pas d’e-mail — impossible d’ouvrir la messagerie.");
      return;
    }
    const mail = buildPhotoAskMail(item, chosen, note);
    openMailto(email, mail.subject, mail.body);
    const summary = chosen.length ? chosen.join(" · ") : note;
    photoAskBanner.hidden = false;
    photoAskBanner.textContent = "E-mail préparé pour " + email + " — en attente : " + summary + ".";
    const next = await persist(() => store.addEvent(item.id, "Photos demandées au client : " + summary, "photos"));
    if (!next) return;
    closePhotoAsk();
    toast("Messagerie ouverte — e-mail prêt à envoyer à " + email);
  });

  document.getElementById("photos").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-photo]");
    if (!btn) return;
    openLightbox(Number(btn.dataset.photo));
  });

  document.getElementById("lbClose").addEventListener("click", closeLightbox);
  document.getElementById("lbPrev").addEventListener("click", (e) => {
    e.stopPropagation();
    const n = (item.photos || []).length;
    if (!n) return;
    photoIndex = (photoIndex + n - 1) % n;
    renderLightbox();
  });
  document.getElementById("lbNext").addEventListener("click", (e) => {
    e.stopPropagation();
    const n = (item.photos || []).length;
    if (!n) return;
    photoIndex = (photoIndex + 1) % n;
    renderLightbox();
  });
  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) closeLightbox();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && photoAskModal.classList.contains("is-open")) {
      closePhotoAsk();
      return;
    }
    if (!lightbox.classList.contains("is-open")) {
      if (e.key === "Escape") closeStatus();
      return;
    }
    if (e.key === "Escape") closeLightbox();
    const n = (item.photos || []).length;
    if (!n) return;
    if (e.key === "ArrowLeft") {
      photoIndex = (photoIndex + n - 1) % n;
      renderLightbox();
    }
    if (e.key === "ArrowRight") {
      photoIndex = (photoIndex + 1) % n;
      renderLightbox();
    }
  });

  await store.ready();
  store.seedIfEmpty();

  if (!(await store.hasSession())) {
    window.location.href = "./index.html";
    return;
  }

  const id = new URLSearchParams(location.search).get("id");
  item = store.get(id);
  if (!item || item.hiddenAt) {
    showMissing();
    return;
  }
  await store.hydratePhotos(item);
  render(item);
  showFiche();

  store.subscribe(async () => {
    const next = store.get(id);
    if (!next || next.hiddenAt) {
      showMissing();
      return;
    }
    await store.hydratePhotos(next);
    render(next);
  });
})();
