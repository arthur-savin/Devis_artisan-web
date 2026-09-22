(async function () {
  const store = window.DevisStore;
  await store.ready();
  store.seedIfEmpty();

  if (!(await store.hasSession())) {
    window.location.href = "./index.html";
    return;
  }

  const artisan = store.currentArtisan();
  if (artisan) {
    document.getElementById("brandName").textContent = artisan.displayName;
    document.getElementById("brandMetier").textContent = artisan.ville
      ? artisan.metier + " · " + artisan.ville
      : artisan.metier;
    const q = store.artisanQuery(artisan);
    document.getElementById("linkPage").href = "../page/index.html" + q;
    document.getElementById("linkWidget").href = "../widget/index.html" + q;
    document.title = artisan.displayName + " — Grille tarifaire";
    document.getElementById("tarifGrid").value = artisan.tarifGrid || "";
  }

  document.getElementById("logout").addEventListener("click", async () => {
    await store.logout();
    window.location.href = "./index.html";
  });

  document.getElementById("saveTarif").addEventListener("click", async () => {
    const btn = document.getElementById("saveTarif");
    const err = document.getElementById("tarifError");
    const ok = document.getElementById("tarifOk");
    err.hidden = true;
    ok.hidden = true;
    btn.disabled = true;
    try {
      await store.saveTarifGrid(document.getElementById("tarifGrid").value);
      ok.hidden = false;
    } catch (e) {
      err.hidden = false;
      err.textContent = (e && e.message) || "Enregistrement impossible.";
    } finally {
      btn.disabled = false;
    }
  });
})();
