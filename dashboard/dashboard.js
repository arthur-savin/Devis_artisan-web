(async function () {
  const store = window.DevisStore;
  await store.ready();
  store.seedIfEmpty();

  const gate = document.getElementById("gate");
  const listEl = document.getElementById("list");
  const searchEl = document.getElementById("search");
  const filtersEl = document.getElementById("filters");
  const hint = document.getElementById("loginHint");
  const backendNote = document.getElementById("backendNote");
  const resetBtn = document.getElementById("resetDemo");
  const selectAllEl = document.getElementById("selectAll");
  const selectAllLabel = document.getElementById("selectAllLabel");
  const bulkStatusEl = document.getElementById("bulkStatus");
  const bulkHideEl = document.getElementById("bulkHide");

  let filter = "tous";
  let query = "";
  const selected = new Set();
  let busy = false;

  if (bulkStatusEl) {
    const opts = Object.keys(store.statuses)
      .map((key) => `<option value="${key}">${store.statuses[key].label}</option>`)
      .join("");
    bulkStatusEl.innerHTML = `<option value="">Changer le statut</option>${opts}`;
  }

  if (backendNote) {
    backendNote.textContent = !store.authRequired()
      ? "Authentification désactivée"
      : store.backend === "supabase"
        ? "Connecté à Supabase"
        : "Démo locale · pas d’API";
  }
  if (!store.authRequired()) {
    const logoutBtn = document.getElementById("logout");
    if (logoutBtn) logoutBtn.hidden = true;
  } else if (store.backend === "supabase") {
    hint.textContent =
      "Compte créé dans Supabase. Sur un navigateur déjà utilisé, le mot de passe suffit. Sur un nouveau, un code e-mail (et SMS si le compte a un numéro) est demandé.";
    if (resetBtn) resetBtn.hidden = true;
    const hashParams = new URLSearchParams(String(location.hash || "").replace(/^#/, ""));
    const authError = hashParams.get("error_description");
    if (authError) hint.textContent = decodeURIComponent(authError.replace(/\+/g, " "));
  }

  function applyArtisanBrand() {
    const artisan = store.currentArtisan();
    if (!artisan) return;
    const nameEl = document.getElementById("brandName");
    const metierEl = document.getElementById("brandMetier");
    if (nameEl) nameEl.textContent = artisan.displayName;
    if (metierEl) {
      metierEl.textContent = artisan.ville
        ? artisan.metier + " · " + artisan.ville
        : artisan.metier;
    }
    const q = store.artisanQuery(artisan);
    const pageLink = document.getElementById("linkPage");
    const widgetLink = document.getElementById("linkWidget");
    if (pageLink) pageLink.href = "../page/index.html" + q;
    if (widgetLink) widgetLink.href = "../widget/index.html" + q;
    document.title = artisan.displayName + " — Demandes";
  }

  function showApp() {
    gate.hidden = true;
    applyArtisanBrand();
    render();
  }

  function showVerify(info) {
    const data = info || {};
    document.getElementById("loginForm").hidden = true;
    const form = document.getElementById("verifyForm");
    form.hidden = false;
    const smsWrap = document.getElementById("smsWrap");
    const lead = document.getElementById("verifyLead");
    const hintEl = document.getElementById("verifyHint");
    const btn = document.getElementById("verifySubmit");
    const smsInput = document.getElementById("smsCode");
    smsWrap.hidden = !data.phone;
    if (smsInput) smsInput.disabled = !data.smsSent;
    if (data.emailSent) {
      lead.textContent = data.smsSent
        ? "Codes envoyés à " + data.email + " et par SMS. Ce navigateur sera enregistré ensuite."
        : "Code envoyé à " + data.email + ". Ce navigateur sera enregistré ensuite.";
      btn.textContent = "Valider";
    } else {
      lead.textContent = data.phone
        ? "Ce navigateur n’est pas encore reconnu. Un code va partir par e-mail et par SMS."
        : "Ce navigateur n’est pas encore reconnu. Un code va partir par e-mail.";
      btn.textContent = "Recevoir les codes";
    }
    const notes = [];
    if (data.sendError) notes.push(data.sendError);
    if (data.smsError) notes.push(data.smsError);
    if (data.emailSent && !data.phone) {
      notes.push("Pas de SMS pour l’instant : ajoutez un numéro sur l’utilisateur, dans Supabase → Authentication.");
    }
    hintEl.textContent = notes.join(" ");
  }

  function showLogin() {
    document.getElementById("verifyForm").hidden = true;
    document.getElementById("loginForm").hidden = false;
  }

  if (await store.hasSession()) showApp();
  else if (store.deviceChallenge()) showVerify(store.deviceChallenge());

  document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("loginEmail").value.trim();
    const pass = document.getElementById("loginPass").value;
    if (!email || !pass) {
      hint.textContent = "Indiquez l’e-mail et le mot de passe du compte artisan.";
      return;
    }
    try {
      const result = await store.login(email, pass);
      if (result && result.needsCode) {
        showVerify(result);
        return;
      }
      showApp();
    } catch (err) {
      hint.textContent = err.message || "Connexion refusée.";
    }
  });

  document.getElementById("verifyForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const hintEl = document.getElementById("verifyHint");
    const pending = store.deviceChallenge() || {};
    const btn = document.getElementById("verifySubmit");
    btn.disabled = true;
    try {
      if (!pending.emailSent) {
        showVerify(await store.sendLoginCodes());
        return;
      }
      await store.verifyLoginCodes(
        document.getElementById("emailCode").value,
        document.getElementById("smsCode").value
      );
      showLogin();
      showApp();
    } catch (err) {
      hintEl.textContent = err.message || "Code refusé.";
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById("resendCodes").addEventListener("click", async () => {
    const hintEl = document.getElementById("verifyHint");
    try {
      showVerify(await store.sendLoginCodes());
    } catch (err) {
      hintEl.textContent = err.message || "Envoi impossible.";
    }
  });

  document.getElementById("verifyCancel").addEventListener("click", async () => {
    await store.logout();
    showLogin();
    hint.textContent = "Indiquez l’e-mail et le mot de passe du compte.";
  });

  document.getElementById("logout").addEventListener("click", async () => {
    await store.logout();
    location.reload();
  });

  document.getElementById("resetDemo").addEventListener("click", async () => {
    await store.resetDemo();
    render();
  });

  searchEl.addEventListener("input", () => {
    query = searchEl.value.trim().toLowerCase();
    render();
  });

  filtersEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-filter]");
    if (!btn) return;
    filter = btn.dataset.filter;
    render();
  });

  listEl.addEventListener("change", (e) => {
    const box = e.target.closest("[data-select-id]");
    if (!box) return;
    const id = decodeURIComponent(box.dataset.selectId || "");
    if (!id) return;
    if (box.checked) selected.add(id);
    else selected.delete(id);
    const wrap = box.closest(".row-wrap");
    if (wrap) wrap.classList.toggle("is-selected", box.checked);
    syncBulk();
  });

  listEl.addEventListener("click", async (e) => {
    if (e.target.closest("[data-select-id]")) {
      e.stopPropagation();
      return;
    }
    const btn = e.target.closest("[data-hide-id]");
    if (!btn || busy) return;
    e.preventDefault();
    e.stopPropagation();
    const id = decodeURIComponent(btn.dataset.hideId || "");
    if (!id) return;
    await hideIds([id]);
  });

  selectAllEl.addEventListener("change", () => {
    const ids = filtered().map((item) => item.id);
    if (selectAllEl.checked) ids.forEach((id) => selected.add(id));
    else ids.forEach((id) => selected.delete(id));
    renderList(filtered());
    syncBulk();
  });

  bulkStatusEl.addEventListener("change", async () => {
    const status = bulkStatusEl.value;
    const ids = selectedIds();
    bulkStatusEl.value = "";
    if (!status || !ids.length || busy) return;
    busy = true;
    syncBulk();
    try {
      await store.setStatusMany(ids, status);
      render();
    } catch (err) {
      console.warn(err && err.message ? err.message : err);
    } finally {
      busy = false;
      syncBulk();
    }
  });

  bulkHideEl.addEventListener("click", async () => {
    const ids = selectedIds();
    if (!ids.length || busy) return;
    await hideIds(ids);
  });

  async function hideIds(ids) {
    if (!ids.length || busy) return;
    busy = true;
    syncBulk();
    try {
      await store.hideLeads(ids);
      ids.forEach((id) => selected.delete(id));
      render();
    } catch (err) {
      console.warn(err && err.message ? err.message : err);
    } finally {
      busy = false;
      syncBulk();
    }
  }

  function selectedIds() {
    return [...selected];
  }

  function pruneSelected() {
    const live = new Set(store.list().map((item) => item.id));
    [...selected].forEach((id) => {
      if (!live.has(id)) selected.delete(id);
    });
  }

  function syncBulk() {
    const visible = filtered();
    const visibleIds = visible.map((item) => item.id);
    const visibleSelected = visibleIds.filter((id) => selected.has(id));
    const count = selected.size;
    selectAllEl.disabled = busy || !visible.length;
    selectAllEl.checked = visible.length > 0 && visibleSelected.length === visible.length;
    selectAllEl.indeterminate = visibleSelected.length > 0 && visibleSelected.length < visible.length;
    selectAllLabel.textContent = count
      ? count + " chantier" + (count > 1 ? "s" : "") + " sélectionné" + (count > 1 ? "s" : "")
      : "Tout sélectionner";
    const canAct = !busy && count > 0;
    bulkStatusEl.disabled = !canAct;
    bulkHideEl.disabled = !canAct;
  }

  function filtered() {
    return store.list().filter((item) => {
      if (filter !== "tous" && item.status !== filter) return false;
      if (!query) return true;
      const blob = [
        item.prenom,
        item.nom,
        store.formatTravaux(item.travaux),
        item.cp,
        item.ville,
        item.email,
        item.tel,
        item.details,
      ]
        .join(" ")
        .toLowerCase();
      return blob.includes(query);
    });
  }

  function fmtDate(ts) {
    return new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(ts);
  }

  function badge(status) {
    const meta = store.statuses[status] || store.statuses.nouveau;
    return `<span class="badge ${meta.tone}">${meta.label}</span>`;
  }

  function renderStats(all) {
    document.getElementById("statNew").textContent = String(all.filter((x) => x.status === "nouveau").length);
    document.getElementById("statOpen").textContent = String(all.filter((x) => x.status === "contacte").length);
    document.getElementById("statSent").textContent = String(all.filter((x) => x.status === "devis_envoye").length);
  }

  function renderFilters() {
    [...filtersEl.querySelectorAll("[data-filter]")].forEach((b) => {
      b.classList.toggle("is-on", b.dataset.filter === filter);
    });
  }

  function renderList(items) {
    if (!items.length) {
      const artisan = store.currentArtisan();
      const q = store.artisanQuery(artisan);
      listEl.innerHTML = `<div class="empty">Aucune demande pour l’instant. Partagez <a href="../page/index.html${q}">votre page</a> ou le widget pour en recevoir.</div>`;
      return;
    }
    listEl.innerHTML = items
      .map((item) => {
        const id = encodeURIComponent(item.id);
        const on = selected.has(item.id);
        return `<div class="row-wrap${on ? " is-selected" : ""}">
          <label class="row-check">
            <input type="checkbox" data-select-id="${id}" ${on ? "checked" : ""} aria-label="Sélectionner ${store.displayName(item)}" />
          </label>
          <a class="row" href="./fiche-client.html?id=${id}">
            <div>
              <strong>${store.displayName(item)} · ${store.formatTravaux(item.travaux)}</strong>
              <small>${item.cp} · ${item.surface} m² · ${fmtDate(item.createdAt)}</small>
            </div>
            <div class="row-end">${badge(item.status)}<span class="row-go">Fiche →</span></div>
          </a>
          <button type="button" class="row-hide" data-hide-id="${id}" title="Supprimer de la liste" aria-label="Supprimer de la liste">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M6 7l1 14h10l1-14"/></svg>
          </button>
        </div>`;
      })
      .join("");
  }

  function render() {
    pruneSelected();
    const all = store.list();
    renderStats(all);
    renderFilters();
    renderList(filtered());
    syncBulk();
  }

  store.subscribe(render);
})();
