(async function () {
  const store = window.DevisStore;
  await store.ready();
  store.seedIfEmpty();

  const list = document.getElementById("metiers");
  if (list) {
    list.innerHTML = (store.metiers || [])
      .map((m) => `<option value="${m}"></option>`)
      .join("");
  }

  const form = document.getElementById("createForm");
  const success = document.getElementById("success");
  const errEl = document.getElementById("formError");
  const btn = document.getElementById("submitBtn");
  let pageUrl = "";

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.hidden = true;
    btn.disabled = true;
    btn.textContent = "Création…";
    try {
      const result = await store.createArtisan({
        displayName: document.getElementById("displayName").value,
        metier: document.getElementById("metier").value,
        ville: document.getElementById("ville").value,
        telephone: document.getElementById("telephone").value,
        bio: document.getElementById("bio").value,
        email: document.getElementById("email").value,
        password: document.getElementById("password").value,
      });
      const artisan = result.artisan;
      if (!artisan) {
        errEl.hidden = false;
        errEl.textContent =
          result.needsConfirm
            ? "Compte créé. Confirmez l’e-mail " + result.email + " puis reconnectez-vous au dashboard."
            : "Création impossible.";
        btn.disabled = false;
        btn.textContent = "Créer ma page et mon dashboard";
        return;
      }
      const q = store.artisanQuery(artisan);
      pageUrl = new URL("../page/index.html" + q, location.href).href;
      document.getElementById("goPage").href = "../page/index.html" + q;
      document.getElementById("successTitle").textContent =
        artisan.displayName + " est en ligne";
      document.getElementById("successLead").textContent = result.needsConfirm
        ? "Confirmez l’e-mail " + result.email + " pour le cloud. En attendant, la page et le dashboard fonctionnent déjà ici."
        : "Les demandes faites depuis votre page arrivent dans votre dashboard, séparées des autres ateliers.";
      form.hidden = true;
      success.hidden = false;
    } catch (err) {
      errEl.hidden = false;
      errEl.textContent = err.message || "Création impossible.";
      btn.disabled = false;
      btn.textContent = "Créer ma page et mon dashboard";
    }
  });

  document.getElementById("copyLink").addEventListener("click", async () => {
    if (!pageUrl) return;
    try {
      await navigator.clipboard.writeText(pageUrl);
    } catch {
      window.prompt("Copiez ce lien :", pageUrl);
    }
    const hint = document.getElementById("copyHint");
    hint.hidden = false;
  });
})();
