(async function () {
  const store = window.DevisStore;
  await store.ready();
  store.seedIfEmpty();

  const ref = new URLSearchParams(location.search).get("a") || "";
  const artisan = await store.resolvePublicArtisan(ref);
  const missing = document.getElementById("missing");
  const page = document.getElementById("page");
  if (!artisan) {
    missing.hidden = false;
    page.hidden = true;
    return;
  }
  missing.hidden = true;

  const q = store.artisanQuery(artisan);
  const where = [artisan.metier, artisan.ville].filter(Boolean).join(" · ");
  document.title = artisan.displayName + " — " + (artisan.metier || "Artisan");
  document.getElementById("kicker").textContent = artisan.metier || "Artisan";
  document.getElementById("name").textContent = artisan.displayName;
  document.getElementById("tag").textContent = where || "Devis en ligne";
  document.getElementById("bio").textContent = artisan.bio || "";
  document.getElementById("ctaDevis").href = "../widget/index.html" + q;
  document.getElementById("footName").textContent = artisan.displayName;

  const tel = (artisan.telephone || "").replace(/\s/g, "");
  const telBtn = document.getElementById("ctaTel");
  if (tel.length >= 10) {
    telBtn.hidden = false;
    telBtn.href = "tel:" + tel;
    telBtn.textContent = "Appeler";
  }

  document.getElementById("page").hidden = false;
})();
