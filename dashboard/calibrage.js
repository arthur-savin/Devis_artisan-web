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

  const artisan = store.currentArtisan();
  if (artisan) {
    document.getElementById("brandName").textContent = artisan.displayName;
    document.getElementById("brandMetier").textContent = artisan.ville
      ? artisan.metier + " · " + artisan.ville
      : artisan.metier;
    const merged = Boolean(document.getElementById("tarifGrid"));
    if (!merged) {
      const q = store.artisanQuery(artisan);
      document.getElementById("linkPage").href = "../page/index.html" + q;
      document.getElementById("linkWidget").href = "../widget/index.html" + q;
      document.title = artisan.displayName + " — Former l’IA";
    }
  }

  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const docList = document.getElementById("docList");
  const priceBody = document.getElementById("priceBody");
  const priceEmpty = document.getElementById("priceEmpty");
  const priceCount = document.getElementById("priceCount");
  const errEl = document.getElementById("calibError");
  const okEl = document.getElementById("calibOk");
  const busyNote = document.getElementById("busyNote");
  const localNote = document.getElementById("localNote");

  const STATUS = {
    en_attente: "En attente",
    en_cours: "Lecture en cours",
    extrait: "Lu",
    erreur: "À relire",
  };

  let busy = false;
  let imports = [];

  function money(n) {
    if (n == null || Number.isNaN(Number(n))) return "—";
    return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(Number(n)) + "\u00a0€";
  }

  function fmtDate(ts) {
    if (!ts) return "—";
    return new Intl.DateTimeFormat("fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(ts);
  }

  function showError(message) {
    errEl.hidden = !message;
    errEl.textContent = message || "";
  }

  function showOk(message) {
    okEl.hidden = !message;
    okEl.textContent = message || "";
  }

  function setBusy(on, label) {
    busy = on;
    dropzone.classList.toggle("is-busy", on);
    fileInput.disabled = on;
    busyNote.hidden = !on;
    if (on && label) busyNote.textContent = label;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderDocs() {
    if (!imports.length) {
      docList.innerHTML = '<p class="tarif-help">Aucun devis déposé pour le moment.</p>';
      return;
    }
    docList.innerHTML = imports
      .map((row) => {
        const status = STATUS[row.status] || row.status;
        const canRead = row.status === "en_attente" || row.status === "erreur" || row.status === "extrait";
        const title = row.title ? "<b>" + escapeHtml(row.title) + "</b>" : "<b>" + escapeHtml(row.filename) + "</b>";
        const file = row.title ? '<span class="doc-file">' + escapeHtml(row.filename) + "</span>" : "";
        const note = row.errorMessage ? '<p class="doc-note">' + escapeHtml(row.errorMessage) + "</p>" : "";
        return (
          '<article class="doc-row" data-id="' +
          escapeHtml(row.id) +
          '">' +
          "<div>" +
          title +
          file +
          '<span class="pill pill-' +
          escapeHtml(row.status) +
          '">' +
          escapeHtml(status) +
          "</span>" +
          note +
          "</div>" +
          '<div class="doc-actions">' +
          (canRead
            ? '<button type="button" class="btn btn-ghost" data-read="' +
              escapeHtml(row.id) +
              '">' +
              (row.status === "extrait" ? "Relire" : "Lire avec l’IA") +
              "</button>"
            : "") +
          '<button type="button" class="btn btn-ghost" data-remove="' +
          escapeHtml(row.id) +
          '">Retirer</button>' +
          "</div></article>"
        );
      })
      .join("");
  }

  function renderPrices(prices) {
    const n = prices.length;
    priceCount.textContent = n + " prix en mémoire";
    priceEmpty.hidden = n > 0;
    if (!n) {
      priceBody.innerHTML = "";
      return;
    }
    priceBody.innerHTML = prices
      .map((row) => {
        const origin =
          row.source === "import"
            ? "Devis importé"
            : row.reason
              ? "Prix corrigé"
              : "Prix confirmé";
        const extra = [row.detail, row.reason].filter(Boolean).join(" — ");
        const previous =
          row.previousAmountHt != null && !Number.isNaN(row.previousAmountHt)
            ? '<span class="price-prev">à la place de ' + money(row.previousAmountHt) + "</span>"
            : "";
        return (
          "<tr><td><strong>" +
          escapeHtml(row.serviceLabel) +
          "</strong>" +
          (extra ? '<span class="price-detail">' + escapeHtml(extra) + "</span>" : "") +
          "</td><td>" +
          money(row.amountHt) +
          previous +
          "</td><td>" +
          escapeHtml(origin) +
          "</td><td>" +
          escapeHtml(fmtDate(row.createdAt)) +
          "</td></tr>"
        );
      })
      .join("");
  }

  async function refresh() {
    const data = await store.listCalibration();
    imports = data.imports || [];
    localNote.hidden = Boolean(data.cloud);
    renderDocs();
    renderPrices(data.prices || []);
  }

  async function ingest(fileList) {
    if (busy) return;
    const files = Array.from(fileList || []);
    if (!files.length) return;
    showError("");
    showOk("");
    setBusy(true, files.length > 1 ? "Lecture des devis…" : "Lecture du devis…");
    try {
      const result = await store.addQuoteFiles(files);
      await refresh();
      const warnings = (result && result.warnings) || [];
      if (warnings.length) showError(warnings.join(" "));
      else if ((result.imports || []).length) {
        showOk("Devis enregistré. Les prestations et les prix lus sont dans la mémoire ci-dessous.");
      }
    } catch (e) {
      showError((e && e.message) || "Dépôt impossible.");
      try {
        await refresh();
      } catch {
        /* ignore */
      }
    } finally {
      setBusy(false);
      fileInput.value = "";
    }
  }

  if (!document.getElementById("tarifGrid")) {
    document.getElementById("logout").addEventListener("click", async () => {
      await store.logout();
      window.location.href = "./index.html";
    });
  }

  fileInput.addEventListener("change", () => ingest(fileInput.files));

  ["dragenter", "dragover"].forEach((name) => {
    dropzone.addEventListener(name, (e) => {
      e.preventDefault();
      if (!busy) dropzone.classList.add("is-over");
    });
  });
  ["dragleave", "drop"].forEach((name) => {
    dropzone.addEventListener(name, (e) => {
      e.preventDefault();
      dropzone.classList.remove("is-over");
    });
  });
  dropzone.addEventListener("drop", (e) => {
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) ingest(files);
  });

  docList.addEventListener("click", async (e) => {
    const readBtn = e.target.closest("[data-read]");
    const removeBtn = e.target.closest("[data-remove]");
    if (!readBtn && !removeBtn) return;
    if (busy) return;
    showError("");
    showOk("");
    const id = (readBtn || removeBtn).dataset.read || (readBtn || removeBtn).dataset.remove;
    setBusy(true, readBtn ? "Lecture du devis…" : "Retrait…");
    try {
      if (readBtn) {
        const row = imports.find((item) => String(item.id) === String(id));
        const result = await store.extractQuote(id, Boolean(row && row.status === "extrait"));
        if (result && result.count === 0) {
          showError("Aucune ligne chiffrée lisible sur ce document.");
        } else {
          showOk("Lecture terminée. Les prix sont dans la mémoire.");
        }
      } else {
        await store.deleteQuoteImport(id);
        showOk("Devis retiré. Ses prix extraits ont été retirés de la mémoire.");
      }
      await refresh();
    } catch (err) {
      showError((err && err.message) || "Action impossible.");
      try {
        await refresh();
      } catch {
        /* ignore */
      }
    } finally {
      setBusy(false);
    }
  });

  try {
    await refresh();
  } catch (e) {
    showError((e && e.message) || "Impossible de charger la mémoire des prix.");
  }
})();
