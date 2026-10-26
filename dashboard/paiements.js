/**
 * Paiements : suivi des factures issues des devis gagnés
 * et relances graduées jusqu’au paiement.
 */
(async function () {
  const store = window.DevisStore;
  await store.ready();
  store.seedIfEmpty();

  if (!(await store.hasSession())) {
    window.location.href = "./index.html";
    return;
  }
  const logoutBtn = document.getElementById("logout");
  if (logoutBtn && !store.authRequired()) logoutBtn.hidden = true;
  logoutBtn.addEventListener("click", async () => {
    await store.logout();
    window.location.href = "./index.html";
  });

  const artisan = store.currentArtisan() || {};
  if (artisan.displayName) {
    document.getElementById("brandName").textContent = artisan.displayName;
    document.getElementById("brandMetier").textContent = artisan.ville
      ? artisan.metier + " · " + artisan.ville
      : artisan.metier;
    const q = store.artisanQuery(artisan);
    const widgetLink = document.getElementById("linkWidget");
    if (widgetLink) widgetLink.href = "../widget/index.html" + q;
    document.title = artisan.displayName + " — Paiements";
  }

  const KEY = "artisan-devis.paiements.v1:" + (artisan.id || "local");
  const DEFAULT_STEPS = [
    { offset: -3, label: "Rappel cordial", tone: 1 },
    { offset: 3, label: "Relance", tone: 2 },
    { offset: 10, label: "Relance ferme", tone: 3 },
    { offset: 20, label: "Mise en demeure", tone: 4 },
  ];

  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(KEY) || "{}");
      return {
        invoices: Array.isArray(data.invoices) ? data.invoices : [],
        steps: Array.isArray(data.steps) && data.steps.length ? data.steps : DEFAULT_STEPS,
        settings: Object.assign({ iban: "", link: "", delay: 30 }, data.settings),
      };
    } catch (e) {
      return { invoices: [], steps: DEFAULT_STEPS, settings: { iban: "", link: "", delay: 30 } };
    }
  }
  const state = load();
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      alert("Enregistrement impossible dans ce navigateur.");
    }
  }

  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const eur = (n) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(n) || 0);
  const today = () => new Date().toISOString().slice(0, 10);
  const addDays = (iso, d) => {
    const t = new Date(iso + "T12:00:00");
    t.setDate(t.getDate() + d);
    return t.toISOString().slice(0, 10);
  };
  const daysBetween = (a, b) => Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 86400000);
  const dfr = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

  function lateDays(inv) {
    return daysBetween(inv.due, today());
  }
  function status(inv) {
    if (inv.paidAt) return { key: "paid", label: "Payée", tone: "ok" };
    const late = lateDays(inv);
    if (late > 0) return { key: "late", label: (inv.reminders || []).length ? `Relancée · J+${late}` : `En retard · J+${late}`, tone: "danger" };
    return { key: "upcoming", label: late === 0 ? "Échéance aujourd’hui" : `Échéance dans ${-late} j`, tone: "gold" };
  }
  // Étape du scénario due aujourd’hui et pas encore envoyée
  function dueStep(inv) {
    if (inv.paidAt) return -1;
    const late = lateDays(inv);
    const done = inv.lastStep || 0;
    let idx = -1;
    state.steps.forEach((s, i) => {
      if (Number(s.offset) <= late) idx = i;
    });
    return idx >= done ? idx : -1;
  }

  function leadAmount(lead) {
    const est = lead.estimate || {};
    const lines = Array.isArray(est.prestations) ? est.prestations : [];
    const sum = lines.reduce((t, l) => t + (Number(l.amount) || 0), 0);
    if (sum) return sum;
    if (est.priceMin && est.priceMax) return Math.round((Number(est.priceMin) + Number(est.priceMax)) / 2);
    return 0;
  }
  function nextNumber() {
    const year = new Date().getFullYear();
    const n = state.invoices.filter((i) => String(i.number).startsWith("F" + year)).length + 1;
    return `F${year}-${String(n).padStart(3, "0")}`;
  }

  // ---------- Message de relance ----------
  function buildMessage(inv, step) {
    const s = state.settings;
    const who = artisan.displayName || "Votre artisan";
    const late = lateDays(inv);
    const amount = eur(inv.amount);
    const pay = [s.iban && `Virement : ${s.iban}`, s.link && `Paiement en ligne : ${s.link}`].filter(Boolean).join("\n");
    const payBlock = pay ? `\n\n${pay}` : "";
    const hello = `Bonjour ${inv.client},`;
    const ref = `la facture ${inv.number}${inv.label ? " (" + inv.label + ")" : ""} d’un montant de ${amount}`;
    const tone = Number(step.tone) || 1;
    let subject, body;
    if (tone <= 1) {
      subject = `Rappel : facture ${inv.number} à régler le ${dfr(inv.due)}`;
      body = `${hello}\n\nPetit rappel amical : ${ref} arrive à échéance le ${dfr(inv.due)}.${payBlock}\n\nSi le règlement est déjà parti, merci et ne tenez pas compte de ce message.`;
    } else if (tone === 2) {
      subject = `Facture ${inv.number} en attente de règlement`;
      body = `${hello}\n\nSauf erreur de notre part, ${ref}, échue le ${dfr(inv.due)}, n’a pas encore été réglée.\n\nPourriez-vous procéder au paiement dans les prochains jours ?${payBlock}\n\nUn souci sur la facture ? Répondez simplement à ce message.`;
    } else if (tone === 3) {
      subject = `Relance : facture ${inv.number} impayée depuis ${late} jours`;
      body = `${hello}\n\nMalgré notre précédent rappel, ${ref} reste impayée ${late} jours après son échéance du ${dfr(inv.due)}.\n\nNous vous remercions de régulariser sous 8 jours.${payBlock}`;
    } else {
      subject = `Mise en demeure de payer — facture ${inv.number}`;
      body = `${hello}\n\nNos relances concernant ${ref}, échue le ${dfr(inv.due)}, sont restées sans effet.\n\nPar la présente, nous vous mettons en demeure de régler cette somme sous 8 jours. À défaut, nous engagerons une procédure de recouvrement ; des pénalités de retard et l’indemnité forfaitaire de 40 € (art. L441-10 du Code de commerce) pourront s’appliquer.${payBlock}`;
    }
    return { subject, body: `${body}\n\nCordialement,\n${who}` };
  }

  // ---------- Rendu ----------
  let filter = "open";
  const invList = document.getElementById("invList");

  function invRow(inv, withAction) {
    const st = status(inv);
    const idx = dueStep(inv);
    const action = inv.paidAt
      ? `<button type="button" class="btn btn-ghost pf-sm" data-unpay="${inv.id}">Annuler le paiement</button>`
      : `<button type="button" class="btn ${idx >= 0 ? "btn-gold" : "btn-ghost"} pf-sm" data-remind="${inv.id}">${idx >= 0 ? esc(state.steps[idx].label) : "Relancer"}</button>
         <button type="button" class="btn btn-ghost pf-sm" data-paid="${inv.id}">Payée ✓</button>`;
    const sent = (inv.reminders || []).length;
    return `<div class="pf-inv">
      <div class="pf-inv-main">
        <strong>${esc(inv.client)} · ${eur(inv.amount)}</strong>
        <small>${esc(inv.number)}${inv.label ? " · " + esc(inv.label) : ""} · échéance ${dfr(inv.due)}${sent ? ` · ${sent} relance${sent > 1 ? "s" : ""}` : ""}</small>
      </div>
      <span class="badge ${st.tone}">${st.label}</span>
      <div class="pf-inv-actions">${withAction !== false ? action : ""}
        <button type="button" class="pf-icon" data-edit="${inv.id}" title="Modifier" aria-label="Modifier">✎</button>
      </div>
    </div>`;
  }

  function render() {
    const open = state.invoices.filter((i) => !i.paidAt);
    const late = open.filter((i) => lateDays(i) > 0);
    const month = today().slice(0, 7);
    const paidMonth = state.invoices.filter((i) => i.paidAt && i.paidAt.slice(0, 7) === month);
    const sum = (arr) => arr.reduce((t, i) => t + (Number(i.amount) || 0), 0);
    document.getElementById("sDue").textContent = eur(sum(open));
    document.getElementById("sLate").textContent = eur(sum(late));
    document.getElementById("sPaid").textContent = eur(sum(paidMonth));

    const todo = open.filter((i) => dueStep(i) >= 0);
    document.getElementById("todoPanel").hidden = !todo.length;
    document.getElementById("todoList").innerHTML = todo.map((i) => invRow(i)).join("");

    const billed = new Set(state.invoices.map((i) => i.leadId).filter(Boolean));
    const won = store.list().filter((l) => l.status === "gagne" && !billed.has(l.id));
    document.getElementById("wonPanel").hidden = !won.length;
    document.getElementById("wonList").innerHTML = won
      .map(
        (l) => `<div class="pf-inv">
        <div class="pf-inv-main"><strong>${esc(store.displayName(l))} · ${eur(leadAmount(l))}</strong>
        <small>${esc(store.formatTravaux(l.travaux))}</small></div>
        <div class="pf-inv-actions"><button type="button" class="btn btn-gold pf-sm" data-bill="${esc(l.id)}">Créer la facture</button></div>
      </div>`
      )
      .join("");

    const rank = (i) => (i.paidAt ? 1e9 - new Date(i.paidAt).getTime() / 1e5 : daysBetween(today(), i.due));
    const shown = state.invoices
      .filter((i) => (filter === "all" ? true : filter === "paid" ? i.paidAt : filter === "late" ? !i.paidAt && lateDays(i) > 0 : !i.paidAt))
      .sort((a, b) => rank(a) - rank(b));
    invList.innerHTML = shown.length
      ? shown.map((i) => invRow(i)).join("")
      : `<div class="empty">${state.invoices.length ? "Rien dans ce filtre." : "Aucune facture suivie. Passez un devis en « Gagné » ou créez une facture."}</div>`;
  }

  // ---------- Facture : création / édition ----------
  const invModal = document.getElementById("invModal");
  const f = (id) => document.getElementById(id);
  let editing = null;

  function openInvoice(inv) {
    editing = inv;
    f("invTitle").textContent = inv.id ? "Modifier la facture" : "Nouvelle facture";
    f("fClient").value = inv.client || "";
    f("fEmail").value = inv.email || "";
    f("fLabel").value = inv.label || "";
    f("fNumber").value = inv.number || nextNumber();
    f("fAmount").value = inv.amount || "";
    const issue = inv.issue || today();
    f("fIssue").value = issue;
    f("fDue").value = inv.due || addDays(issue, Number(state.settings.delay) || 30);
    invModal.showModal();
  }
  f("fIssue").addEventListener("change", () => {
    if (!editing.id) f("fDue").value = addDays(f("fIssue").value, Number(state.settings.delay) || 30);
  });
  f("invCancel").addEventListener("click", () => invModal.close());
  f("invForm").addEventListener("submit", () => {
    const data = {
      client: f("fClient").value.trim(),
      email: f("fEmail").value.trim(),
      label: f("fLabel").value.trim(),
      number: f("fNumber").value.trim(),
      amount: Number(f("fAmount").value) || 0,
      issue: f("fIssue").value,
      due: f("fDue").value,
    };
    if (editing.id) Object.assign(state.invoices.find((i) => i.id === editing.id), data);
    else {
      state.invoices.push(Object.assign({ id: "inv_" + Date.now().toString(36), leadId: editing.leadId || null, reminders: [], lastStep: 0 }, data));
      if (editing.leadId) store.addEvent(editing.leadId, `Facture ${data.number} créée (${eur(data.amount)}), paiement suivi.`, "note").catch(() => {});
    }
    save();
    render();
  });
  f("newInvoice").addEventListener("click", () => openInvoice({}));

  function billLead(id) {
    const l = store.get(id);
    if (!l) return;
    openInvoice({
      leadId: l.id,
      client: store.displayName(l),
      email: l.email || "",
      label: (l.estimate && l.estimate.titrePredevis) || store.formatTravaux(l.travaux),
      amount: leadAmount(l),
    });
  }

  // ---------- Relance ----------
  const remModal = f("remModal");
  let reminding = null;
  function openReminder(inv) {
    let idx = dueStep(inv);
    if (idx < 0) idx = Math.min(state.steps.length - 1, inv.lastStep || 0);
    const step = state.steps[idx] || DEFAULT_STEPS[0];
    reminding = { inv, idx };
    const msg = buildMessage(inv, step);
    f("remTitle").textContent = `${step.label} · ${inv.number}`;
    f("remTo").textContent = inv.email ? `À : ${inv.email}` : "Pas d’email pour ce client : copiez le message (SMS, WhatsApp…).";
    f("remSubject").value = msg.subject;
    f("remBody").value = msg.body;
    f("remSend").hidden = !inv.email;
    remModal.showModal();
  }
  function logReminder(channel) {
    const { inv, idx } = reminding;
    inv.reminders = inv.reminders || [];
    inv.reminders.push({ at: new Date().toISOString(), step: idx + 1, channel, subject: f("remSubject").value });
    inv.lastStep = Math.max(inv.lastStep || 0, idx + 1);
    if (inv.leadId) store.addEvent(inv.leadId, `${state.steps[idx].label} envoyée pour la facture ${inv.number}.`, "note").catch(() => {});
    save();
    remModal.close();
    render();
  }
  f("remCancel").addEventListener("click", () => remModal.close());
  f("remSend").addEventListener("click", () => {
    const inv = reminding.inv;
    window.location.href = `mailto:${encodeURIComponent(inv.email)}?subject=${encodeURIComponent(f("remSubject").value)}&body=${encodeURIComponent(f("remBody").value)}`;
    logReminder("email");
  });
  f("remCopy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(f("remSubject").value + "\n\n" + f("remBody").value);
    } catch (e) {}
    logReminder("manuel");
  });

  // ---------- Actions de liste ----------
  document.querySelector(".pf-page").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const find = (id) => state.invoices.find((i) => i.id === id);
    if (b.dataset.remind) openReminder(find(b.dataset.remind));
    else if (b.dataset.edit) openInvoice(find(b.dataset.edit));
    else if (b.dataset.bill) billLead(b.dataset.bill);
    else if (b.dataset.paid) {
      const inv = find(b.dataset.paid);
      inv.paidAt = new Date().toISOString();
      if (inv.leadId) store.addEvent(inv.leadId, `Facture ${inv.number} payée (${eur(inv.amount)}).`, "note").catch(() => {});
      save();
      render();
    } else if (b.dataset.unpay) {
      find(b.dataset.unpay).paidAt = null;
      save();
      render();
    }
  });
  f("pfFilters").addEventListener("click", (e) => {
    const b = e.target.closest("[data-f]");
    if (!b) return;
    filter = b.dataset.f;
    f("pfFilters").querySelectorAll(".filter").forEach((x) => x.classList.toggle("is-on", x === b));
    render();
  });

  // ---------- Scénario & coordonnées ----------
  function renderScenario() {
    f("scenario").innerHTML = state.steps
      .map(
        (s, i) => `<div class="pf-step">
        <span class="pf-step-n">${i + 1}</span>
        <input class="pf-input" data-step="${i}" data-k="label" value="${esc(s.label)}" aria-label="Nom de l’étape ${i + 1}" />
        <label class="pf-step-d">J<input class="pf-input" type="number" data-step="${i}" data-k="offset" value="${Number(s.offset)}" aria-label="Jour de l’étape ${i + 1}" /></label>
      </div>`
      )
      .join("");
  }
  f("saveScenario").addEventListener("click", () => {
    f("scenario").querySelectorAll("[data-step]").forEach((el) => {
      const s = state.steps[Number(el.dataset.step)];
      s[el.dataset.k] = el.dataset.k === "offset" ? Number(el.value) || 0 : el.value.trim() || s.label;
    });
    state.steps.sort((a, b) => a.offset - b.offset).forEach((s, i) => (s.tone = i + 1));
    save();
    renderScenario();
    render();
    f("scenarioOk").hidden = false;
  });
  f("pIban").value = state.settings.iban;
  f("pLink").value = state.settings.link;
  f("pDelay").value = state.settings.delay;
  f("saveSettings").addEventListener("click", () => {
    state.settings = { iban: f("pIban").value.trim(), link: f("pLink").value.trim(), delay: Number(f("pDelay").value) || 30 };
    save();
    f("settingsOk").hidden = false;
  });

  renderScenario();
  render();
  store.subscribe && store.subscribe(render);

  const leadParam = new URLSearchParams(location.search).get("lead");
  if (leadParam) billLead(leadParam);
})();
