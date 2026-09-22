(function () {
  if (window.self !== window.top || new URLSearchParams(location.search).has("embed")) {
    document.body.classList.add("is-embed");
  }
  document.body.classList.add("is-booting");

  const names = ["Votre besoin", "Captures guidées", "Coordonnées", "Envoi"];
  const MAX_EXTRA = 3;
  const MAX_ATTEMPTS = 4;
  const MAX_VIDEOS = 5;
  const MAX_VIDEO_MS = 30000;
  const RECORD_W = 1280;
  const RECORD_H = 720;
  const artisanRef = new URLSearchParams(location.search).get("a") || "";

  let current = 1;
  let direction = "next";
  let artisan = null;
  let description = "";
  let plan = null;
  let queue = [];
  let queueIndex = 0;
  let captured = [];
  let extraTaken = 0;
  let preview = null;
  let attempts = 0;
  let createdLead = null;
  let lastResult = null;
  let recognizing = false;
  let recognition = null;
  let mediaStream = null;
  let mediaRecorder = null;
  let recordedChunks = [];
  let recording = false;
  let recordStartedAt = 0;
  let recordTimer = null;
  let restoring = false;
  let saveTimer = null;

  const DRAFT_DB = "artisan-devis-widget";
  const DRAFT_STORE = "drafts";
  const DRAFT_LS = "artisan-devis.widget-draft.v1";

  const steps = [...document.querySelectorAll(".step")];
  const bar = document.getElementById("bar");
  const stepLabel = document.getElementById("stepLabel");
  const stepName = document.getElementById("stepName");
  const progressWrap = document.getElementById("progressWrap");
  const dots = [...document.querySelectorAll("[data-dot]")];

  function draftKey() {
    return (artisanRef || "default") + "";
  }

  function lsDraftKey() {
    return DRAFT_LS + ":" + draftKey();
  }

  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout")), ms);
      promise.then(
        (value) => {
          clearTimeout(t);
          resolve(value);
        },
        (err) => {
          clearTimeout(t);
          reject(err);
        }
      );
    });
  }

  function openDraftDb() {
    return withTimeout(
      new Promise((resolve, reject) => {
        if (!window.indexedDB) {
          reject(new Error("no-idb"));
          return;
        }
        const req = indexedDB.open(DRAFT_DB, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(DRAFT_STORE)) db.createObjectStore(DRAFT_STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error("idb"));
        req.onblocked = () => reject(new Error("idb-blocked"));
      }),
      1200
    );
  }

  function idbOp(mode, fn) {
    return openDraftDb().then((db) =>
      withTimeout(
        new Promise((resolve, reject) => {
          const tx = db.transaction(DRAFT_STORE, mode);
          const store = tx.objectStore(DRAFT_STORE);
          const req = fn(store);
          tx.oncomplete = () => {
            db.close();
            resolve(req ? req.result : undefined);
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error || new Error("idb-tx"));
          };
        }),
        1200
      )
    );
  }

  function readContactFields() {
    const val = (id) => {
      const el = document.getElementById(id);
      return el ? el.value : "";
    };
    return {
      besoin: val("besoin"),
      prenom: val("prenom"),
      tel: val("tel"),
      email: val("email"),
      adresse: val("adresse"),
      cp: val("cp"),
    };
  }

  function fillContactFields(contact) {
    if (!contact) return;
    ["besoin", "prenom", "tel", "email", "adresse", "cp"].forEach((id) => {
      const el = document.getElementById(id);
      if (el && contact[id] != null) el.value = contact[id];
    });
  }

  function slimLead(lead) {
    if (!lead) return null;
    return { id: lead.id || lead.public_id || "", public_id: lead.public_id || lead.id || "" };
  }

  function landingModeNow() {
    const result = document.getElementById("landingResult");
    const error = document.getElementById("landingError");
    if (result && !result.hidden) return "result";
    if (error && !error.hidden) return "error";
    return "wait";
  }

  function capturedRecords(includeFiles) {
    return captured.map((c) => ({
      item: c.item,
      dataUrl: c.dataUrl || "",
      frames: Array.isArray(c.frames) ? c.frames : [],
      title: c.title || (c.item && c.item.label) || "",
      kind: c.kind === "video" ? "video" : "photo",
      file: includeFiles && c.file ? c.file : null,
    }));
  }

  function draftPayload(includeFiles) {
    const contact = readContactFields();
    const descriptionNow = description || String(contact.besoin || "").trim();
    return {
      v: 1,
      artisanRef: artisanRef || "",
      savedAt: Date.now(),
      current,
      description: descriptionNow,
      plan,
      queue,
      queueIndex,
      extraTaken,
      lastResult,
      createdLead: slimLead(createdLead),
      contact,
      landingMode: current === 6 ? landingModeNow() : "",
      captured: capturedRecords(includeFiles),
    };
  }

  function hasDraftProgress(payload) {
    if (!payload) return false;
    const c = payload.contact || {};
    return Boolean(
      payload.current > 1 ||
        payload.description ||
        (payload.captured && payload.captured.length) ||
        c.besoin ||
        c.prenom ||
        c.tel ||
        c.email ||
        c.adresse ||
        c.cp
    );
  }

  async function clearDraft() {
    try {
      localStorage.removeItem(lsDraftKey());
    } catch {
      /* ignore */
    }
    try {
      await idbOp("readwrite", (store) => store.delete(draftKey()));
    } catch {
      /* ignore */
    }
  }

  async function saveDraft() {
    if (restoring) return;
    const payload = draftPayload(true);
    if (!hasDraftProgress(payload)) {
      await clearDraft();
      return;
    }
    try {
      localStorage.setItem(
        lsDraftKey(),
        JSON.stringify({ ...payload, captured: capturedRecords(false) })
      );
    } catch {
      try {
        localStorage.setItem(lsDraftKey(), JSON.stringify({ ...payload, captured: [] }));
      } catch {
        /* quota */
      }
    }
    try {
      await idbOp("readwrite", (store) => store.put(payload, draftKey()));
    } catch {
      try {
        const lighter = { ...payload, captured: capturedRecords(false) };
        await idbOp("readwrite", (store) => store.put(lighter, draftKey()));
      } catch {
        /* quota */
      }
    }
  }

  function scheduleSaveDraft() {
    if (restoring) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveDraft().catch(() => {});
    }, 120);
  }

  function reviveFile(raw, name, mime) {
    if (!raw) return null;
    if (raw instanceof File) return raw;
    if (raw instanceof Blob) {
      return new File([raw], name || "capture.bin", { type: raw.type || mime || "" });
    }
    return null;
  }

  function reviveCaptured(list) {
    return (Array.isArray(list) ? list : []).map((c, i) => {
      const kind = c && c.kind === "video" ? "video" : "photo";
      const item = (c && c.item) || { id: "restored_" + (i + 1), label: (c && c.title) || "Capture", kind };
      const fallbackName = kind === "video" ? "capture.webm" : "capture.jpg";
      const mime = kind === "video" ? "video/webm" : "image/jpeg";
      const file = reviveFile(c && c.file, fallbackName, mime);
      const dataUrl = (c && c.dataUrl) || "";
      let url = dataUrl;
      if (file && kind !== "video") url = URL.createObjectURL(file);
      return {
        item,
        file,
        dataUrl,
        frames: Array.isArray(c && c.frames) ? c.frames : dataUrl ? [dataUrl] : [],
        url,
        title: (c && c.title) || item.label || "",
        kind,
      };
    });
  }

  async function readDraft() {
    let data = null;
    try {
      data = (await idbOp("readonly", (store) => store.get(draftKey()))) || null;
    } catch {
      data = null;
    }
    if (!data) {
      try {
        data = JSON.parse(localStorage.getItem(lsDraftKey()) || "null");
      } catch {
        data = null;
      }
    }
    if (!data || data.v !== 1) return null;
    if ((data.artisanRef || "") !== (artisanRef || "")) return null;
    return data;
  }

  async function restoreDraft() {
    const data = await readDraft();
    if (!data) return null;
    restoring = true;
    try {
      description = data.description || "";
      plan = data.plan || null;
      queue = Array.isArray(data.queue) ? data.queue : [];
      queueIndex = Number(data.queueIndex) || 0;
      extraTaken = Number(data.extraTaken) || 0;
      lastResult = data.lastResult || null;
      createdLead = data.createdLead && data.createdLead.id ? data.createdLead : null;
      captured = reviveCaptured(data.captured);
      fillContactFields(data.contact || {});
      const besoin = document.getElementById("besoin");
      if (besoin && !besoin.value && description) besoin.value = description;

      const lostMedia =
        Number(data.current) >= 3 &&
        !captured.length &&
        plan &&
        Array.isArray(plan.photos) &&
        plan.photos.length;
      if (lostMedia) {
        queue = plan.photos.slice();
        queueIndex = 0;
        extraTaken = 0;
      }

      let step = Number(data.current) || 1;
      let resume = "";
      if (lostMedia) {
        step = 3;
      } else if (step === 2) {
        if (plan && queue.length) step = 3;
        else if (description) resume = "plan";
        else step = 1;
      } else if (step === 4) {
        if (queueIndex < queue.length && queue.length) step = 3;
        else if (captured.length) resume = "review";
        else step = 1;
      }
      if (!lostMedia && step === 3 && (!queue.length || queueIndex >= queue.length)) {
        if (captured.length && !resume) step = 5;
        else if (!captured.length) {
          step = plan && plan.photos && plan.photos.length ? 3 : 1;
          if (step === 3) {
            queue = (plan.photos || []).slice();
            queueIndex = 0;
          }
        }
      }
      if (step > 1 && !description && !(data.contact && data.contact.besoin)) step = 1;
      if (step === 6 && !createdLead && !lastResult) step = 5;
      if (resume === "plan") step = 2;
      if (resume === "review") step = 4;

      direction = "next";
      show(step, { save: false });
      if (step === 3) renderShot();
      if (step === 6) {
        if (data.landingMode === "error") {
          setLandingMode("error");
        } else if (createdLead || lastResult) {
          renderConfirmation(lastResult || {});
        } else {
          setLandingMode("wait");
        }
      }
      return { resume };
    } finally {
      restoring = false;
    }
  }

  function visualStep(n) {
    if (n <= 1) return 1;
    if (n <= 4) return 2;
    if (n === 5) return 3;
    return 4;
  }

  function show(n, opts) {
    steps.forEach((el) => {
      const id = Number(el.dataset.step);
      const active = id === n;
      el.classList.toggle("is-active", active);
      el.classList.toggle("is-back", active && direction === "back");
      el.hidden = !active;
      el.setAttribute("aria-hidden", active ? "false" : "true");
    });
    current = n;
    const visual = visualStep(n);
    bar.style.width = visual * 25 + "%";
    stepLabel.textContent = String(Math.min(visual, 4));
    stepName.textContent = n === 6 ? "Transmission" : names[visual - 1];
    progressWrap.style.display = n === 6 ? "none" : "";
    dots.forEach((d) => {
      const i = Number(d.dataset.dot);
      d.classList.toggle("is-current", i === visual && n < 6);
      d.classList.toggle("is-done", i < visual || n === 6);
    });
    if (!opts || opts.save !== false) saveDraft().catch(() => {});
  }

  function invalidate(el, on) {
    el.classList.toggle("is-invalid", on);
  }

  function phoneDigits(v) {
    return String(v || "").replace(/\D/g, "");
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"]/g, (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch])
    );
  }

  function currentItem() {
    return queue[queueIndex] || null;
  }

  function totalPlanned() {
    return (plan && plan.photos && plan.photos.length) || 0;
  }

  function money(n) {
    if (n == null || Number.isNaN(Number(n))) return "—";
    return new Intl.NumberFormat("fr-FR").format(Math.round(Number(n))) + "\u00a0€";
  }

  function itemKind() {
    const item = currentItem();
    return item && String(item.kind || "").toLowerCase() === "video" ? "video" : "photo";
  }

  function isVideo(item) {
    return item && String(item.kind || "").toLowerCase() === "video";
  }

  function videoSlotsUsed(includeCurrent) {
    let n = captured.filter((c) => c.kind === "video").length;
    queue.forEach((item, i) => {
      if (!isVideo(item)) return;
      if (i === queueIndex && !includeCurrent) return;
      n += 1;
    });
    return n;
  }

  function canOfferVideo() {
    return itemKind() === "photo" && videoSlotsUsed(false) < MAX_VIDEOS;
  }

  function capVideoKinds(list, already) {
    let videos = already;
    return (list || []).map((item) => {
      if (!isVideo(item)) return item;
      videos += 1;
      if (videos > MAX_VIDEOS) return { ...item, kind: "photo" };
      return item;
    });
  }

  function videoHint(existing) {
    const base = String(existing || "").trim();
    if (/seconde/i.test(base)) return base;
    return (base ? base.replace(/\.*$/, ".") + " " : "") + "Filmez environ 30 secondes, lentement, à la lumière du jour.";
  }

  function formatClock(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  }

  function stopLiveCamera() {
    if (recordTimer) {
      clearInterval(recordTimer);
      recordTimer = null;
    }
    recording = false;
    if (mediaRecorder && mediaRecorder.state === "recording") {
      try {
        mediaRecorder.stop();
      } catch {
        /* ignore */
      }
    }
    mediaRecorder = null;
    recordedChunks = [];
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }
    const live = document.getElementById("shotLive");
    const timer = document.getElementById("shotTimer");
    const stopBtn = document.getElementById("btnStopRec");
    if (live) {
      live.srcObject = null;
      live.hidden = true;
    }
    if (timer) timer.hidden = true;
    if (stopBtn) stopBtn.hidden = true;
  }

  function fileToThumb(file) {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const max = 900;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve({ name: file.name, dataUrl: canvas.toDataURL("image/jpeg", 0.72), frames: [] });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  }

  function videoToFrames(file, count) {
    return new Promise((resolve) => {
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      const url = URL.createObjectURL(file);
      const cleanup = () => {
        URL.revokeObjectURL(url);
        video.src = "";
      };
      const fail = () => {
        cleanup();
        resolve(null);
      };
      video.onerror = fail;
      video.onloadeddata = async () => {
        try {
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
          const ratios = count <= 1 ? [0.35] : [0.2, 0.72];
          const frames = [];
          for (const ratio of ratios) {
            const t = Math.min(Math.max(0.05, duration * ratio), Math.max(0.05, duration - 0.05));
            video.currentTime = t;
            await new Promise((ok, ko) => {
              const onSeek = () => {
                video.removeEventListener("seeked", onSeek);
                ok();
              };
              video.addEventListener("seeked", onSeek);
              setTimeout(() => {
                video.removeEventListener("seeked", onSeek);
                ok();
              }, 800);
            });
            const w = video.videoWidth || 640;
            const h = video.videoHeight || 360;
            const max = 900;
            const scale = Math.min(1, max / Math.max(w, h));
            canvas.width = Math.max(1, Math.round(w * scale));
            canvas.height = Math.max(1, Math.round(h * scale));
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            frames.push(canvas.toDataURL("image/jpeg", 0.72));
          }
          cleanup();
          resolve({
            name: file.name,
            dataUrl: frames[0],
            frames,
            duration,
          });
        } catch {
          fail();
        }
      };
      video.src = url;
      video.load();
    });
  }

  function setFeedback(text, tone) {
    const el = document.getElementById("shotFeedback");
    if (!el) return;
    el.hidden = !text;
    el.textContent = text || "";
    el.classList.toggle("is-ok", tone === "ok");
    el.classList.toggle("is-wait", tone === "wait");
  }

  function renderShot() {
    const item = currentItem();
    const title = document.getElementById("t3");
    const hint = document.getElementById("shotHint");
    const kicker = document.getElementById("shotKicker");
    const previewImg = document.getElementById("shotPreview");
    const previewVideo = document.getElementById("shotPreviewVideo");
    const placeholder = document.getElementById("shotPlaceholder");
    const placeholderText = document.getElementById("shotPlaceholderText");
    const sendBtn = document.getElementById("btnSendPhoto");
    const pickers = document.getElementById("shotPickers");
    const captureBtn = pickers.querySelector("#btnCapture");
    const pickBtn = document.getElementById("btnPick");
    const videoMode = itemKind() === "video";
    if (!item) return;
    const word = videoMode ? "Vidéo" : "Photo";
    const ordinal = captured.length + 1;
    const total = Math.max(totalPlanned() + extraTaken, captured.length + (queue.length - queueIndex));
    if (kicker) {
      kicker.textContent =
        extraTaken > 0 && captured.length >= totalPlanned()
          ? word + " complémentaire " + (captured.length - totalPlanned() + 1)
          : word + " " + ordinal + " sur " + total;
    }
    if (title) title.textContent = item.label;
    const offerBtn = document.getElementById("btnOfferVideo");
    const videoNote = document.getElementById("shotVideoNote");
    const badge = document.getElementById("shotBadge");
    const live = document.getElementById("shotLive");
    const liveOn = Boolean(live && !live.hidden && live.srcObject);
    pickers.classList.toggle("is-video", videoMode);
    if (hint) {
      hint.textContent =
        item.hint ||
        (videoMode
          ? "Filmez environ 30 secondes, lentement, à la lumière du jour."
          : "Une seule photo, lumière du jour si possible.");
    }
    if (placeholderText) {
      placeholderText.textContent = videoMode
        ? "Filmez ici environ 30 secondes (720p)"
        : "Prenez ou choisissez une photo";
    }
    pickBtn.textContent = "Choisir dans l’appareil";
    pickBtn.hidden = videoMode;
    if (captureBtn) {
      captureBtn.style.gridColumn = videoMode && !recording ? "1 / -1" : "";
    }
    if (offerBtn) {
      offerBtn.hidden = !canOfferVideo() || recording || liveOn || Boolean(preview && preview.url);
    }
    if (videoNote) videoNote.hidden = !videoMode;
    if (badge) badge.hidden = !videoMode;
    if (preview && preview.url) {
      if (preview.kind === "video") {
        previewVideo.src = preview.url;
        previewVideo.hidden = false;
        previewImg.hidden = true;
        previewImg.removeAttribute("src");
      } else {
        previewImg.src = preview.url;
        previewImg.hidden = false;
        previewVideo.hidden = true;
        previewVideo.removeAttribute("src");
      }
      if (live) live.hidden = true;
      placeholder.hidden = true;
      sendBtn.hidden = false;
      sendBtn.disabled = false;
      sendBtn.textContent = videoMode ? "Envoyer cette vidéo" : "Envoyer cette photo";
      captureBtn.textContent = videoMode ? "Reprendre la vidéo" : "Reprendre";
    } else if (liveOn) {
      previewImg.hidden = true;
      previewVideo.hidden = true;
      placeholder.hidden = true;
      sendBtn.hidden = true;
      captureBtn.textContent = recording ? "Enregistrement…" : "Démarrer l’enregistrement";
    } else {
      previewImg.removeAttribute("src");
      previewImg.hidden = true;
      previewVideo.removeAttribute("src");
      previewVideo.hidden = true;
      placeholder.hidden = false;
      sendBtn.hidden = true;
      sendBtn.textContent = videoMode ? "Envoyer cette vidéo" : "Envoyer cette photo";
      captureBtn.textContent = videoMode ? "Filmer" : "Prendre la photo";
    }
    const done = document.getElementById("shotDone");
    if (captured.length) {
      done.hidden = false;
      done.innerHTML = captured
        .map(
          (c, i) =>
            `<button type="button" class="shot-mini" data-retake="${i}" title="Reprendre cette capture (l’ancienne sera supprimée)">` +
            `<img src="${c.url && !isVideo(c.item) ? c.url : c.dataUrl}" alt="${escapeHtml(c.item.label)}" />` +
            `<span>${i + 1}</span></button>`
        )
        .join("");
    } else {
      done.hidden = true;
      done.innerHTML = "";
    }
  }

  function releaseCapture(entry) {
    if (!entry) return;
    if (entry.url && String(entry.url).startsWith("blob:")) {
      try {
        URL.revokeObjectURL(entry.url);
      } catch {
        /* ignore */
      }
    }
    entry.file = null;
    entry.dataUrl = "";
    entry.frames = [];
    entry.url = "";
  }

  function retakeCaptured(index) {
    const entry = captured[index];
    if (!entry || !entry.item) return;
    const sendBtn = document.getElementById("btnSendPhoto");
    if (sendBtn && sendBtn.disabled && !sendBtn.hidden) return;
    stopLiveCamera();
    clearPreview();
    const item = entry.item;
    releaseCapture(entry);
    captured.splice(index, 1);
    const remaining = queue.slice(queueIndex);
    queue = captured.map((c) => c.item).concat([item], remaining);
    queueIndex = captured.length;
    attempts = 0;
    saveDraft().catch(() => {});
    setFeedback("L’ancienne capture a été supprimée. Vous pouvez en prendre une nouvelle.", "ok");
    renderShot();
  }

  function clearPreview() {
    stopLiveCamera();
    if (preview && preview.url) URL.revokeObjectURL(preview.url);
    if (preview) {
      preview.file = null;
      preview.url = "";
    }
    preview = null;
    ["photoCapture", "photoPick"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    const previewVideo = document.getElementById("shotPreviewVideo");
    if (previewVideo) previewVideo.removeAttribute("src");
  }

  async function setPreviewFromFile(file, opts) {
    const videoMode = itemKind() === "video";
    const fromRecorder = Boolean(opts && opts.fromRecorder);
    const isVid = file && String(file.type || "").startsWith("video/");
    const isImg = file && String(file.type || "").startsWith("image/");
    if (videoMode && !fromRecorder) {
      setFeedback("Filmez la vidéo ici, en 720p (environ 30 secondes). L’import depuis l’appareil n’est pas possible.", "wait");
      return;
    }
    if (videoMode && !isVid) {
      setFeedback("Filmez une courte vidéo ici, environ 30 secondes.", "wait");
      return;
    }
    if (!videoMode && !isImg) {
      setFeedback("Choisissez une image (JPG ou PNG), s’il vous plaît.", "wait");
      return;
    }
    stopLiveCamera();
    if (preview && preview.url) URL.revokeObjectURL(preview.url);
    if (preview) {
      preview.file = null;
      preview.url = "";
    }
    preview = { file, url: URL.createObjectURL(file), kind: isVid ? "video" : "photo" };
    setFeedback("", "");
    renderShot();
  }

  async function getCameraStream() {
    const withMax = {
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: RECORD_W, max: RECORD_W },
        height: { ideal: RECORD_H, max: RECORD_H },
      },
    };
    const fallback = {
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: RECORD_W },
        height: { ideal: RECORD_H },
      },
    };
    try {
      return await navigator.mediaDevices.getUserMedia(withMax);
    } catch {
      return await navigator.mediaDevices.getUserMedia(fallback);
    }
  }

  async function startLiveRecord() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === "undefined") {
      throw new Error("camera");
    }
    stopLiveCamera();
    mediaStream = await getCameraStream();
    const live = document.getElementById("shotLive");
    live.srcObject = mediaStream;
    live.muted = true;
    live.playsInline = true;
    live.hidden = false;
    document.getElementById("shotPlaceholder").hidden = true;
    try {
      await live.play();
    } catch {
      /* autoplay parfois bloqué, l’aperçu reste */
    }
    startRecording();
    renderShot();
  }

  function startRecording() {
    if (!mediaStream) return;
    recordedChunks = [];
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
      ? "video/webm;codecs=vp8"
      : MediaRecorder.isTypeSupported("video/webm")
        ? "video/webm"
        : "";
    mediaRecorder = mime
      ? new MediaRecorder(mediaStream, { mimeType: mime, videoBitsPerSecond: 1_200_000 })
      : new MediaRecorder(mediaStream);
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size) recordedChunks.push(e.data);
    };
    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: mediaRecorder && mediaRecorder.mimeType ? mediaRecorder.mimeType : "video/webm" });
      if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
        mediaStream = null;
      }
      const live = document.getElementById("shotLive");
      if (live) {
        live.srcObject = null;
        live.hidden = true;
      }
      if (blob.size < 800) {
        setFeedback("La vidéo est trop courte. Filmez à nouveau environ 30 secondes.", "wait");
        renderShot();
        return;
      }
      const file = new File([blob], "capture.webm", { type: blob.type || "video/webm" });
      setPreviewFromFile(file, { fromRecorder: true });
    };
    mediaRecorder.start(200);
    recording = true;
    recordStartedAt = Date.now();
    const timer = document.getElementById("shotTimer");
    const stopBtn = document.getElementById("btnStopRec");
    if (timer) {
      timer.hidden = false;
      timer.textContent = "00:00 / 00:30";
    }
    if (stopBtn) stopBtn.hidden = false;
    recordTimer = setInterval(() => {
      const elapsed = Date.now() - recordStartedAt;
      if (timer) timer.textContent = formatClock(elapsed) + " / 00:30";
      if (elapsed >= MAX_VIDEO_MS) stopRecording();
    }, 250);
    renderShot();
  }

  function stopRecording() {
    if (!recording) return;
    recording = false;
    if (recordTimer) {
      clearInterval(recordTimer);
      recordTimer = null;
    }
    const timer = document.getElementById("shotTimer");
    const stopBtn = document.getElementById("btnStopRec");
    if (timer) timer.hidden = true;
    if (stopBtn) stopBtn.hidden = true;
    if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
  }

  async function startPlan() {
    direction = "next";
    show(2);
    const waitText = document.getElementById("planWaitText");
    try {
      const result = await window.DevisStore.qualify("plan", {
        description,
        metier: artisan && artisan.metier,
        artisan_ref: artisanRef || (artisan && artisan.id) || "",
      });
      const photos = capVideoKinds(
        (Array.isArray(result.photos) ? result.photos : [])
          .slice(0, 5)
          .map((p, i) => ({
            id: p.id || "media_" + (i + 1),
            kind: String(p.kind || "").toLowerCase() === "video" ? "video" : "photo",
            label: p.label,
            hint: String(p.kind || "").toLowerCase() === "video" ? videoHint(p.hint) : p.hint,
          }))
          .filter((p) => p.label),
        0
      );
      const fillers = [
        { id: "vue_ensemble", kind: "photo", label: "Vue d’ensemble de la zone concernée", hint: "Reculez un peu, de jour, pour situer le chantier." },
        { id: "detail", kind: "photo", label: "Gros plan sur le détail à traiter", hint: "Approchez-vous du point précis, photo nette, sans flash." },
        { id: "contexte", kind: "photo", label: "Contexte autour de la zone", hint: "Ce qui se raccorde ou se trouve juste à côté." },
        { id: "acces", kind: "photo", label: "Accès au chantier", hint: "Le passage qui mènera l’artisan sur place." },
        { id: "parcours", kind: "video", label: "Parcours lent de la zone", hint: "Filmez environ 30 secondes, lentement, de l’ensemble vers le détail." },
      ];
      fillers.forEach((extra) => {
        if (photos.length >= 5) return;
        if (photos.some((x) => x.id === extra.id)) return;
        photos.push(extra);
      });
      const planned = capVideoKinds(photos, 0);
      if (!planned.length) throw new Error("Aucune capture n’a pu être préparée.");
      plan = {
        metier: result.metier || (artisan && artisan.metier) || "",
        intervention: result.intervention || "",
        photos: planned,
      };
      queue = planned.slice();
      queueIndex = 0;
      captured = [];
      extraTaken = 0;
      attempts = 0;
      clearPreview();
      direction = "next";
      show(3);
      renderShot();
    } catch (err) {
      if (waitText) {
        waitText.textContent =
          (err && err.message) || "Nous n’avons pas pu préparer les photos. Réessayez.";
      }
      setTimeout(() => {
        direction = "back";
        show(1);
      }, 1600);
    }
  }

  async function sendCurrentPhoto() {
    const item = currentItem();
    const btn = document.getElementById("btnSendPhoto");
    const videoMode = itemKind() === "video";
    if (!item || !preview) return;
    btn.disabled = true;
    btn.textContent = videoMode ? "Lecture de la vidéo…" : "Lecture de la photo…";
    setFeedback(
      videoMode
        ? "Nous regardons si cette vidéo permet à l’artisan de bien voir l’élément."
        : "Nous regardons si cette photo permet à l’artisan de bien voir l’élément.",
      "wait"
    );
    try {
      const thumb = videoMode ? await videoToFrames(preview.file, 2) : await fileToThumb(preview.file);
      if (!thumb) {
        throw new Error(
          videoMode
            ? "Cette vidéo n’a pas pu être lue. Essayez-en une autre, plus courte."
            : "Cette image n’a pas pu être lue. Essayez-en une autre."
        );
      }
      const images = videoMode && thumb.frames && thumb.frames.length ? thumb.frames : [thumb.dataUrl];
      const result = await window.DevisStore.qualify("validate_photo", {
        description,
        label: item.label,
        hint: item.hint,
        kind: videoMode ? "video" : "photo",
        image: images[0],
        images,
      });
      const accepted = result.accepted === true || (result.accepted == null && result.ok === true);
      const sendLabel = videoMode ? "Envoyer cette vidéo" : "Envoyer cette photo";
      if (!accepted && attempts + 1 < MAX_ATTEMPTS) {
        attempts += 1;
        setFeedback(
          result.message ||
            (videoMode
              ? "Pouvez-vous filmer à nouveau, plus lentement, un peu plus près ?"
              : "Pouvez-vous reprendre la photo un peu plus près, à la lumière du jour ?"),
          "wait"
        );
        btn.disabled = false;
        btn.textContent = sendLabel;
        return;
      }
      if (!accepted) {
        setFeedback(
          videoMode
            ? "Nous transmettons cette vidéo telle quelle. L’artisan pourra vous redemander un cliché s’il en a besoin."
            : "Nous transmettons cette photo telle quelle. L’artisan pourra vous redemander un cliché s’il en a besoin.",
          "ok"
        );
      } else {
        setFeedback(result.message || "Merci, c’est bien lisible. On continue.", "ok");
      }
      if (preview.url && videoMode) URL.revokeObjectURL(preview.url);
      captured.push({
        item,
        file: preview.file,
        dataUrl: thumb.dataUrl,
        frames: images,
        url: preview.kind === "video" ? thumb.dataUrl : preview.url,
        title: item.label,
        kind: videoMode ? "video" : "photo",
      });
      preview = null;
      attempts = 0;
      queueIndex += 1;
      saveDraft();
      setTimeout(() => {
        setFeedback("", "");
        if (queueIndex >= queue.length) {
          startReview();
        } else {
          renderShot();
        }
      }, accepted ? 700 : 1100);
    } catch (err) {
      setFeedback(
        (err && err.message) || "La lecture n’a pas abouti. Vous pouvez renvoyer la capture.",
        "wait"
      );
      btn.disabled = false;
      btn.textContent = videoMode ? "Envoyer cette vidéo" : "Envoyer cette photo";
    }
  }

  async function startReview() {
    direction = "next";
    show(4);
    try {
      const result = await window.DevisStore.qualify("review", {
        description,
        images: captured.flatMap((c) => (c.frames && c.frames.length ? c.frames : [c.dataUrl])),
        photo_labels: captured.map((c) => c.item.label + (isVideo(c.item) ? " (vidéo)" : "")),
        extra_taken: extraTaken,
      });
      lastResult = result;
      const extras = Array.isArray(result.extra_photos) ? result.extra_photos : [];
      const room = Math.max(0, MAX_EXTRA - extraTaken);
      const needed = capVideoKinds(
        extras
          .slice(0, room)
          .map((p, i) => ({
            id: p.id || "extra_" + (i + 1),
            kind: String(p.kind || "").toLowerCase() === "video" ? "video" : "photo",
            label: p.label,
            hint: String(p.kind || "").toLowerCase() === "video" ? videoHint(p.hint) : p.hint,
          }))
          .filter((p) => p.label),
        captured.filter((c) => c.kind === "video").length
      );
      if (!result.sufficient && needed.length && extraTaken < MAX_EXTRA) {
        extraTaken += needed.length;
        queue = needed;
        queueIndex = 0;
        attempts = 0;
        clearPreview();
        direction = "next";
        show(3);
        setFeedback(result.client_message || "Quelques captures de plus aideraient l’artisan.", "wait");
        renderShot();
        return;
      }
      direction = "next";
      show(5);
    } catch (err) {
      document.getElementById("reviewWaitText").textContent =
        "Nous transmettons le dossier en l’état. L’artisan pourra demander un complément s’il le souhaite.";
      setTimeout(() => {
        direction = "next";
        show(5);
      }, 1200);
    }
  }

  function validateContact() {
    const prenom = document.getElementById("prenom");
    const tel = document.getElementById("tel");
    const email = document.getElementById("email");
    const adresse = document.getElementById("adresse");
    const cp = document.getElementById("cp");
    const telOk = phoneDigits(tel.value).length >= 10;
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim());
    const adresseOk = adresse.value.trim().length >= 5;
    const cpOk = /^\d{5}$/.test(cp.value.trim());
    invalidate(document.getElementById("f-prenom"), !prenom.value.trim());
    invalidate(document.getElementById("f-tel"), !telOk);
    invalidate(document.getElementById("f-email"), !emailOk);
    invalidate(document.getElementById("f-adresse"), !adresseOk);
    invalidate(document.getElementById("f-cp"), !cpOk);
    return prenom.value.trim() && telOk && emailOk && adresseOk && cpOk;
  }

  function setLandingMode(mode) {
    const landing = document.getElementById("landing");
    const wait = document.getElementById("landingWait");
    const error = document.getElementById("landingError");
    const result = document.getElementById("landingResult");
    const spin = landing && landing.querySelector(".landing-spin");
    const check = landing && landing.querySelector(".landing-check");
    if (landing) landing.classList.toggle("is-wait", mode === "wait");
    if (wait) wait.hidden = mode !== "wait";
    if (error) error.hidden = mode !== "error";
    if (result) result.hidden = mode !== "result";
    if (spin) spin.hidden = mode !== "wait";
    if (check) check.hidden = mode === "wait";
  }

  function fillSummary() {
    const prenom = document.getElementById("prenom").value.trim();
    const nPhoto = captured.filter((c) => c.kind !== "video").length;
    const nVideo = captured.filter((c) => c.kind === "video").length;
    const mediaBits = [];
    if (nPhoto) mediaBits.push(nPhoto + " photo" + (nPhoto > 1 ? "s" : ""));
    if (nVideo) mediaBits.push(nVideo + " vidéo" + (nVideo > 1 ? "s" : ""));
    document.getElementById("summary").innerHTML =
      `<dt>Besoin</dt><dd>${escapeHtml(description.slice(0, 220))}${description.length > 220 ? "…" : ""}</dd>` +
      `<dt>Captures</dt><dd>${mediaBits.join(" · ") || captured.length + " capture(s)"}</dd>` +
      `<dt>Contact</dt><dd>${escapeHtml(prenom)} · ${escapeHtml(document.getElementById("adresse").value.trim())}, ${escapeHtml(document.getElementById("cp").value)}</dd>`;
    document.getElementById("landingPhotos").innerHTML = captured
      .map((c, i) => `<div class="thumb"><img src="${c.dataUrl || c.url}" alt="${escapeHtml(c.item.label || "Capture " + (i + 1))}" /></div>`)
      .join("");
  }

  function fallbackPrestations() {
    const snapshot = {
      details: description,
      travaux: [plan && plan.intervention, plan && plan.metier].filter(Boolean),
      photos: captured.map((c) => ({ kind: c.kind })),
    };
    if (window.DevisStore && typeof window.DevisStore.localPrestations === "function") {
      return window.DevisStore.localPrestations(snapshot);
    }
    return [
      {
        label: (plan && plan.intervention) || "Réalisation des travaux",
        detail: description
          ? description.slice(0, 180)
          : "Exécution des travaux correspondant à votre demande, à confirmer par l’artisan.",
        amount: 0,
      },
      {
        label: "Contrôles après intervention",
        detail: "Vérification du résultat et des points visibles avant de quitter le chantier.",
        amount: 0,
      },
      {
        label: "Finition et nettoyage",
        detail: "Remise en état de la zone d’intervention et évacuation des déchets liés au chantier.",
        amount: 0,
      },
    ];
  }

  function renderPredevis(payload) {
    const estimate =
      (payload && payload.estimate) ||
      (lastResult && lastResult.estimate) ||
      lastResult ||
      {};
    const titleEl = document.getElementById("predevisTitle");
    const introEl = document.getElementById("predevisIntro");
    const listEl = document.getElementById("predevisLines");
    const totalEl = document.getElementById("predevisTotal");
    const legalEl = document.getElementById("landingDisclaimer");
    const lines = Array.isArray(estimate.prestations) && estimate.prestations.length
      ? estimate.prestations
      : fallbackPrestations();
    const titre =
      estimate.titrePredevis ||
      (payload && payload.titre_predevis) ||
      (plan && plan.intervention) ||
      (artisan && artisan.metier) ||
      "Votre intervention";
    if (titleEl) titleEl.textContent = titre;
    if (introEl) {
      introEl.textContent =
        estimate.clientSummary ||
        (payload && payload.client_message) ||
        "Voici le détail des travaux envisagés d’après votre description et vos photos.";
    }
    if (listEl) {
      const hasPrice = Boolean(estimate.hasPrice || (payload && payload.has_price));
      listEl.innerHTML = lines
        .map((p, i) => {
          const amount =
            hasPrice && p.amount != null && Number(p.amount) > 0
              ? `<em>${money(p.amount)}</em>`
              : "";
          return (
            `<li>` +
            `<span class="predevis-num">${i + 1}</span>` +
            `<div>` +
            `<strong>${escapeHtml(p.label)}</strong>` +
            (p.detail ? `<p>${escapeHtml(p.detail)}</p>` : "") +
            `</div>` +
            amount +
            `</li>`
          );
        })
        .join("");
    }
    const hasPrice = Boolean(estimate.hasPrice || (payload && payload.has_price));
    if (totalEl) {
      if (hasPrice && (estimate.priceMin != null || estimate.priceMax != null)) {
        totalEl.hidden = false;
        totalEl.innerHTML =
          `<span>Total indicatif HT</span>` +
          `<strong>${money(estimate.priceMin)} — ${money(estimate.priceMax)}</strong>`;
      } else {
        totalEl.hidden = true;
        totalEl.textContent = "";
      }
    }
    if (legalEl) {
      legalEl.textContent =
        estimate.disclaimer ||
        (payload && payload.disclaimer) ||
        "Ce prédevis est indicatif et non contractuel. Il ne vaut pas devis : l’artisan reste seul décisionnaire.";
    }
  }

  function renderConfirmation(payload) {
    const estimate =
      (payload && payload.estimate) ||
      (lastResult && lastResult.estimate) ||
      lastResult ||
      {};
    const title = document.getElementById("t6");
    const lead = document.getElementById("confirmLead");
    const summaryEl = document.getElementById("clientSummary");
    if (title) title.textContent = "Dossier transmis";
    if (lead) {
      lead.textContent = artisan
        ? artisan.displayName + " a bien reçu votre dossier et vous rappelle sous 24 h ouvrées."
        : "Un artisan a bien reçu votre dossier et vous rappelle sous 24 h ouvrées.";
    }
    renderPredevis(payload || {});
    summaryEl.textContent =
      estimate.clientSummary ||
      (payload && payload.client_message) ||
      "Votre description et vos photos ont été transmises. L’artisan établira le devis.";
    fillSummary();
    setLandingMode("result");
  }

  async function persistAndFinalize() {
    const title = document.getElementById("t6");
    const leadTxt = document.getElementById("confirmLead");
    if (title) title.textContent = "Transmission en cours";
    if (leadTxt) {
      leadTxt.textContent = artisan
        ? "Votre dossier part vers " + artisan.displayName + "."
        : "Votre dossier part vers l’artisan.";
    }
    setLandingMode("wait");
    const photos = captured.map((c, i) => ({
      name: (c.item.id || (c.kind === "video" ? "video" : "photo")) + (c.kind === "video" ? ".webm" : ".jpg"),
      title: c.item.label || (c.kind === "video" ? "Vidéo " : "Photo ") + (i + 1),
      dataUrl: c.kind === "video" ? "" : c.dataUrl,
      kind: c.kind === "video" ? "video" : "photo",
      size: c.file && c.file.size,
      file: c.file,
    }));
    const payload = {
      artisanRef: artisanRef || (artisan && artisan.id) || "",
      travaux: [plan && plan.intervention, plan && plan.metier].filter(Boolean),
      details: description,
      prenom: document.getElementById("prenom").value.trim(),
      tel: document.getElementById("tel").value.trim(),
      email: document.getElementById("email").value.trim(),
      adresse: document.getElementById("adresse").value.trim(),
      cp: document.getElementById("cp").value.trim(),
      photos,
    };
    createdLead = await window.DevisStore.create(payload);
    let finalized = lastResult;
    try {
      finalized = await window.DevisStore.qualify("finalize", {
        public_id: createdLead.id,
        description,
        snapshot: {
          ...createdLead,
          details: description,
          travaux: payload.travaux,
          photos: captured.map((c) => ({ kind: c.kind === "video" ? "video" : "photo", title: c.item.label })),
        },
      });
    } catch {
      /* le dossier est déjà parti */
    }
    lastResult = finalized;
    renderConfirmation(finalized || {});
    saveDraft();
  }

  document.getElementById("devisForm").addEventListener("click", (e) => {
    if (e.target.closest("[data-next]")) {
      if (current === 1) {
        const besoin = document.getElementById("besoin");
        const ok = besoin.value.trim().length >= 8;
        invalidate(document.getElementById("f-besoin"), !ok);
        document.getElementById("err1").classList.toggle("is-on", !ok);
        if (!ok) return;
        description = besoin.value.trim();
        startPlan();
        return;
      }
      if (current === 5) {
        if (!validateContact()) return;
        const btn = document.getElementById("submitBtn");
        const errSend = document.getElementById("errSend");
        if (errSend) errSend.classList.remove("is-on");
        btn.disabled = true;
        btn.textContent = "Envoi…";
        direction = "next";
        show(6);
        persistAndFinalize().catch((err) => {
          btn.disabled = false;
          btn.textContent = "Transmettre le dossier";
          if (!createdLead) {
            direction = "back";
            show(5);
            if (errSend) {
              errSend.textContent = err.message || "L’envoi a échoué. Réessayez dans un instant.";
              errSend.classList.add("is-on");
            }
            return;
          }
          document.getElementById("landingErrorText").textContent =
            (err.message || "L’analyse n’a pas abouti.") +
            " Votre demande est bien partie : l’artisan la reçoit quand même.";
          setLandingMode("error");
          saveDraft().catch(() => {});
        });
      }
    }
  });

  function offerVideoInstead() {
    const item = currentItem();
    if (!item || !canOfferVideo()) {
      setFeedback("Cinq vidéos au plus, d’environ 30 secondes chacune, filmées ici en 720p.", "wait");
      return;
    }
    clearPreview();
    item.kind = "video";
    item.hint = videoHint(item.hint);
    setFeedback("Filmez ici, en 720p, 30 secondes maximum. Pas d’import depuis l’appareil.", "ok");
    renderShot();
    saveDraft().catch(() => {});
  }

  document.getElementById("btnSendPhoto").addEventListener("click", sendCurrentPhoto);
  document.getElementById("shotDone").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-retake]");
    if (!btn) return;
    retakeCaptured(Number(btn.dataset.retake));
  });
  document.getElementById("btnCapture").addEventListener("click", () => {
    if (itemKind() === "video") {
      if (recording) {
        stopRecording();
        return;
      }
      startLiveRecord().catch(() => {
        setFeedback(
          "Autorisez la caméra du navigateur pour filmer ici en 720p. L’appli Appareil photo n’est pas utilisée, pour éviter les fichiers 4K trop lourds.",
          "wait"
        );
        renderShot();
      });
      return;
    }
    document.getElementById("photoCapture").click();
  });
  document.getElementById("btnPick").addEventListener("click", () => {
    if (itemKind() === "video") return;
    document.getElementById("photoPick").click();
  });
  document.getElementById("btnOfferVideo").addEventListener("click", offerVideoInstead);
  document.getElementById("btnStopRec").addEventListener("click", stopRecording);
  document.getElementById("photoCapture").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) setPreviewFromFile(file);
  });
  document.getElementById("photoPick").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) setPreviewFromFile(file);
  });

  document.querySelectorAll("input, textarea").forEach((el) => {
    const clear = () => {
      const field = el.closest(".field");
      if (field) field.classList.remove("is-invalid");
      scheduleSaveDraft();
    };
    el.addEventListener("input", clear);
    el.addEventListener("change", clear);
  });

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btnDictate = document.getElementById("btnDictate");
  const dictateLabel = document.getElementById("dictateLabel");
  if (!SR) {
    btnDictate.hidden = true;
  } else {
    btnDictate.addEventListener("click", () => {
      if (recognizing && recognition) {
        recognition.stop();
        return;
      }
      recognition = new SR();
      recognition.lang = "fr-FR";
      recognition.interimResults = true;
      recognition.continuous = true;
      const area = document.getElementById("besoin");
      const base = area.value.trim();
      recognition.onstart = () => {
        recognizing = true;
        btnDictate.classList.add("is-on");
        dictateLabel.textContent = "Arrêter la dictée";
      };
      recognition.onend = () => {
        recognizing = false;
        btnDictate.classList.remove("is-on");
        dictateLabel.textContent = "Dicter ma description";
      };
      recognition.onresult = (ev) => {
        let transcript = "";
        for (let i = 0; i < ev.results.length; i++) {
          transcript += ev.results[i][0].transcript;
        }
        area.value = [base, transcript].filter(Boolean).join(base && !base.endsWith(" ") ? " " : "");
        document.getElementById("f-besoin").classList.remove("is-invalid");
        document.getElementById("err1").classList.remove("is-on");
        scheduleSaveDraft();
      };
      recognition.start();
    });
  }

  document.getElementById("restart").addEventListener("click", () => {
    captured.forEach((c) => {
      if (c.url && String(c.url).startsWith("blob:")) URL.revokeObjectURL(c.url);
    });
    stopLiveCamera();
    clearPreview();
    description = "";
    plan = null;
    queue = [];
    queueIndex = 0;
    captured = [];
    extraTaken = 0;
    attempts = 0;
    createdLead = null;
    lastResult = null;
    document.getElementById("devisForm").reset();
    document.getElementById("submitBtn").disabled = false;
    document.getElementById("submitBtn").textContent = "Transmettre le dossier";
    document.querySelectorAll(".is-invalid").forEach((el) => el.classList.remove("is-invalid"));
    document.getElementById("err1").classList.remove("is-on");
    const errSend = document.getElementById("errSend");
    if (errSend) errSend.classList.remove("is-on");
    setLandingMode("wait");
    direction = "back";
    clearTimeout(saveTimer);
    show(1, { save: false });
    clearDraft();
  });

  document.getElementById("landingRetry").addEventListener("click", () => {
    const btn = document.getElementById("submitBtn");
    btn.disabled = true;
    persistAndFinalize().catch((err) => {
      document.getElementById("landingErrorText").textContent =
        err.message || "L’envoi n’a pas abouti. Réessayez dans un instant.";
      setLandingMode("error");
      saveDraft().catch(() => {});
    });
  });

  window.addEventListener("pagehide", () => {
    clearTimeout(saveTimer);
    saveDraft();
  });

  (async function boot() {
    const unveil = () => document.body.classList.remove("is-booting");
    const safety = setTimeout(unveil, 2500);
    try {
      if (window.DevisStore) {
        await withTimeout(window.DevisStore.ready(), 2000).catch(() => {});
        artisan = await window.DevisStore.resolvePublicArtisan(artisanRef);
        if (artisan) {
          const sub = document.getElementById("brandSub");
          if (sub) {
            sub.textContent = [artisan.metier, artisan.ville || "particuliers"].filter(Boolean).join(" · ");
          }
          document.title = "Demande de devis — " + artisan.displayName;
        }
      }
      const restored = await withTimeout(restoreDraft(), 1500).catch(() => null);
      if (restored && restored.resume === "plan") startPlan();
      else if (restored && restored.resume === "review") startReview();
    } finally {
      clearTimeout(safety);
      unveil();
    }
  })();
})();
