"use strict";
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const STATUS = { done: "Готово", review: "На проверку", failed: "Ошибка", pending: "В очереди", running: "В работе", cancelled: "Отменено" };
const JOB_STATUS = { draft: "черновик", queued: "в очереди", running: "в работе", paused: "пауза", done: "завершено", cancelled: "отменено" };

let jobId = localStorage.getItem("pa_job") || null;
let jobData = null;
let filter = "all";
let selected = new Set();
let modalFrame = null;
let pollTimer = null;
let planOk = false;

function toast(text, err = false) {
  const t = $("#toast");
  t.textContent = text; t.className = "toast" + (err ? " err" : "");
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.add("hidden"), err ? 7000 : 3500);
}
async function api(path, opts = {}) {
  const r = await fetch(path, opts);
  const ct = r.headers.get("content-type") || "";
  const body = ct.includes("json") ? await r.json() : await r.text();
  if (!r.ok) throw new Error((body && (body.error || body.detail)) || ("Ошибка " + r.status));
  return body;
}
const post = (path, data) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data || {}) });
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------------------------------------------------------------- навигация
$$(".nav").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));
function showView(v) {
  $$(".nav").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
  $$(".view").forEach((s) => s.classList.toggle("hidden", s.id !== "view-" + v));
  if (v === "history") loadHistory();
  if (v === "review") loadReview();
  if (v === "system") loadSystem();
}

// ---------------------------------------------------------------- задание
async function ensureJob() {
  if (jobId) {
    try { await api("/api/jobs/" + jobId); return jobId; } catch { jobId = null; }
  }
  const fd = new FormData();
  const r = await api("/api/jobs", { method: "POST", body: fd });
  jobId = r.id; localStorage.setItem("pa_job", jobId);
  return jobId;
}
async function openJob(id) {
  jobId = id; localStorage.setItem("pa_job", id);
  selected.clear(); planOk = false;
  $("#plan").innerHTML = "";
  await refresh(true);
  showView("job");
}
$("#newJob").onclick = async () => {
  const r = await api("/api/jobs", { method: "POST", body: new FormData() });
  await openJob(r.id);
  $("#task").value = "";
  toast("Создано новое задание");
};
$("#deleteJob").onclick = async () => {
  if (!jobId || !confirm("Удалить задание вместе с загруженными копиями и результатами? Ваши исходные файлы на диске не затрагиваются.")) return;
  try { await api("/api/jobs/" + jobId, { method: "DELETE" }); jobId = null; localStorage.removeItem("pa_job"); await ensureJob(); await refresh(true); }
  catch (e) { toast(e.message, true); }
};
$("#jobTitle").addEventListener("change", async () => { await post(`/api/jobs/${jobId}/rename`, { title: $("#jobTitle").value }); });

// загрузка
async function uploadFiles(files) {
  files = Array.from(files).filter((f) => /\.(jpe?g|png|tiff?|webp|bmp|zip)$/i.test(f.name));
  if (!files.length) { toast("Не найдено подходящих файлов", true); return; }
  await ensureJob();
  let added = 0, errors = [];
  const batch = 8;
  for (let i = 0; i < files.length; i += batch) {
    const fd = new FormData();
    for (const f of files.slice(i, i + batch)) fd.append("files", f, f.webkitRelativePath || f.name);
    $("#uploadStatus").textContent = `Загрузка ${Math.min(i + batch, files.length)} из ${files.length}…`;
    try { const r = await api(`/api/jobs/${jobId}/files`, { method: "POST", body: fd }); added += r.added; errors = errors.concat(r.errors); }
    catch (e) { errors.push(e.message); }
  }
  $("#uploadStatus").textContent = `Добавлено кадров: ${added}` + (errors.length ? `. Ошибки: ${errors.join("; ")}` : "");
  await refresh(true);
}
$("#pickFiles").onchange = (e) => { uploadFiles(e.target.files); e.target.value = ""; };
$("#pickFolder").onchange = (e) => { uploadFiles(e.target.files); e.target.value = ""; };
const drop = $("#drop");
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", async (e) => {
  e.preventDefault(); drop.classList.remove("over");
  const items = Array.from(e.dataTransfer.items || []);
  const entries = items.map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (entries.some((en) => en.isDirectory)) {
    const files = [];
    const walk = (entry, path) => new Promise((res) => {
      if (entry.isFile) entry.file((f) => { Object.defineProperty(f, "webkitRelativePath", { value: path + f.name }); files.push(f); res(); });
      else { const rd = entry.createReader(); const all = [];
        const read = () => rd.readEntries(async (ents) => { if (!ents.length) { for (const en of all) await walk(en, path + entry.name + "/"); res(); } else { all.push(...ents); read(); } });
        read(); }
    });
    for (const en of entries) await walk(en, "");
    uploadFiles(files);
  } else uploadFiles(e.dataTransfer.files);
});

// референсы
(async () => {
  const roles = await api("/api/ref-roles");
  $("#refRole").innerHTML = Object.entries(roles).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("");
})();
$("#pickRef").onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  await ensureJob();
  const fd = new FormData(); fd.append("role", $("#refRole").value); fd.append("file", f);
  try { await api(`/api/jobs/${jobId}/refs`, { method: "POST", body: fd }); toast("Референс добавлен"); await refresh(true); if ($("#task").value.trim()) parseTask(true); }
  catch (err) { toast(err.message, true); }
};
async function delRef(id) { await api(`/api/jobs/${jobId}/refs/${id}`, { method: "DELETE" }); await refresh(true); if ($("#task").value.trim()) parseTask(true); }
window.delRef = delRef;

// задание
$$(".ex").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); $("#task").value = a.textContent; parseTask(); }));
$("#resolution").onchange = () => $("#longSideWrap").classList.toggle("hidden", $("#resolution").value !== "long_side");
function exportSettings() {
  const fmt = $("#fmt").value;
  return { format: fmt === "auto" ? "" : fmt, quality: +$("#quality").value || 95, resolution: $("#resolution").value,
    long_side: +$("#longSide").value || 0, bit_depth: $("#bitDepth").value ? +$("#bitDepth").value : null };
}
$("#parse").onclick = () => parseTask();
async function parseTask(silent = false) {
  const text = $("#task").value.trim();
  if (!text) { toast("Опишите задание", true); return; }
  await ensureJob();
  try {
    const r = await post(`/api/jobs/${jobId}/task`, { text, export: exportSettings(), use_llm: $("#useLlm").checked });
    renderPlan(r.spec, r.plan);
    if (!silent) toast("Задание разобрано");
    await refresh(true);
  } catch (e) { toast(e.message, true); }
}
function renderPlan(spec, plan) {
  planOk = plan && !plan.errors.length && plan.steps.length > 0;
  let h = "";
  if (spec && spec.understood && spec.understood.length)
    h += `<div class="msg ok"><b>Понял:</b> ${spec.understood.map(esc).join("; ")}</div>`;
  if (plan) {
    if (plan.steps.length) h += `<div><b>План обработки:</b><ol>${plan.steps.map((s) => `<li>${esc(s.title)}</li>`).join("")}</ol></div>`;
    for (const e of plan.errors) h += `<div class="msg err">${esc(e)}</div>`;
    for (const w of plan.warnings) h += `<div class="msg warn">${esc(w)}</div>`;
  }
  if (spec && spec.export) h += `<div class="muted small">Экспорт: ${esc((spec.export.format || "").toUpperCase())}${spec.export.transparent ? ", прозрачный фон" : ""}, разрешение: ${spec.export.resolution === "original" ? "исходное" : spec.export.resolution === "long_side" ? "по длинной стороне" : "после обработки"}</div>`;
  $("#plan").innerHTML = h;
  updateButtons();
}

// пробный кадр
$("#previewBtn").onclick = async () => {
  const fr = (jobData && jobData.frames || []).find((f) => selected.has(f.id)) || (jobData && jobData.frames[0]);
  if (!fr) return;
  $("#previewBtn").disabled = true; $("#previewBtn").textContent = "Обработка пробного кадра…";
  try {
    const r = await post(`/api/jobs/${jobId}/preview`, { frame: fr.id });
    if (r.error) toast("Пробный кадр: " + r.error, true);
    openModal(fr, r);
  } catch (e) { toast(e.message, true); }
  finally { $("#previewBtn").textContent = "Пробный кадр"; updateButtons(); }
};

// управление
for (const a of ["start", "pause", "resume", "cancel"]) {
  $("#" + a).onclick = async () => {
    if (a === "cancel" && !confirm("Отменить обработку? Уже готовые кадры сохранятся.")) return;
    try {
      if (a === "start" && $("#task").value.trim() && (!jobData.job.task_text || jobData.job.task_text !== $("#task").value.trim())) await parseTask(true);
      await post(`/api/jobs/${jobId}/${a}`); await refresh(true);
    } catch (e) { toast(e.message, true); }
  };
}
$$(".filters .chip").forEach((c) => c.addEventListener("click", () => {
  filter = c.dataset.filter; $$(".filters .chip").forEach((x) => x.classList.toggle("active", x === c)); renderFrames();
}));
$("#reprocessSel").onclick = async () => {
  if (!selected.size) return;
  try { await post(`/api/jobs/${jobId}/reprocess`, { frames: Array.from(selected) }); selected.clear(); toast("Кадры поставлены на повторную обработку"); await refresh(true); }
  catch (e) { toast(e.message, true); }
};

async function refresh(full = false) {
  if (!jobId) await ensureJob();
  try { jobData = await api("/api/jobs/" + jobId); }
  catch { jobId = null; await ensureJob(); jobData = await api("/api/jobs/" + jobId); }
  const j = jobData.job;
  if (full || document.activeElement !== $("#jobTitle")) $("#jobTitle").value = j.title;
  if (full && j.task_text && !$("#task").value) $("#task").value = j.task_text;
  if (full && j.spec && j.plan && j.task_text) renderPlan(j.spec, j.plan);
  $("#refs").innerHTML = jobData.refs.map((r) => `<div class="ref"><img src="/api/refs/${r.id}/image"><div>${esc({ background: "Фон", clothes: "Одежда", style: "Стиль", layout: "Макет" }[r.role] || r.role)}</div><button onclick="delRef('${r.id}')" title="Удалить">✕</button></div>`).join("");
  const c = jobData.counts;
  const finished = c.done + c.review + c.failed + c.cancelled;
  const cur = jobData.current;
  const curPart = cur ? (cur.progress || 0) : 0;
  $("#bar").style.width = c.total ? ((finished + curPart) / c.total * 100).toFixed(1) + "%" : "0";
  $("#summary").textContent = c.total ? `Статус: ${JOB_STATUS[j.status] || j.status}. Кадров ${c.total}: готово ${c.done}, на проверку ${c.review}, ошибок ${c.failed}, в очереди ${c.pending + c.running}` + (cur ? `. Сейчас: ${cur.name} — ${cur.step}` : "") + (j.message ? `. ${j.message}` : "") : "Загрузите фотографии";
  renderFrames();
  updateButtons();
  const ev = await api(`/api/jobs/${jobId}/events`);
  $("#events").innerHTML = ev.map((e) => `<div class="${e.level}">${new Date(e.ts * 1000).toLocaleTimeString()} ${esc(e.message)}</div>`).join("");
  const z = (c.done > 0), zr = (c.done + c.review > 0);
  $("#zip").classList.toggle("disabled", !z); $("#zip").href = `/api/jobs/${jobId}/zip`;
  $("#zipAll").classList.toggle("disabled", !zr); $("#zipAll").href = `/api/jobs/${jobId}/zip?include_review=true`;
  $("#report").classList.toggle("disabled", !finished); $("#report").href = `/api/jobs/${jobId}/report`;
  schedulePoll(j.status === "running" || j.status === "queued");
}
function updateButtons() {
  if (!jobData) return;
  const s = jobData.job.status, n = jobData.counts.total;
  const active = s === "running" || s === "queued";
  $("#start").disabled = active || s === "paused" || !n;
  $("#start").textContent = (s === "done" || s === "cancelled") ? "Запустить заново (необработанные)" : "Запустить";
  $("#pause").disabled = !active;
  $("#resume").disabled = s !== "paused";
  $("#cancel").disabled = !(active || s === "paused");
  $("#previewBtn").disabled = active || !n || !planOk;
  $("#reprocessSel").disabled = !selected.size || active;
}
function renderFrames() {
  const frames = (jobData && jobData.frames) || [];
  const cur = jobData && jobData.current;
  const list = frames.filter((f) => filter === "all" || f.status === filter || (filter === "pending" && (f.status === "pending" || f.status === "running")));
  $("#frames").innerHTML = list.map((f) => {
    const st = cur && cur.frame_id === f.id ? "running" : f.status;
    const img = f.result_path ? `/api/frames/${f.id}/image/result?size=300&t=${f.updated_at}` : `/api/frames/${f.id}/image/original?size=300`;
    const prog = st === "running" ? `<div class="fbar" style="width:${((cur.progress || 0) * 100).toFixed(0)}%"></div>` : "";
    return `<div class="frame" data-id="${f.id}"><input type="checkbox" class="sel" ${selected.has(f.id) ? "checked" : ""}>
      <img loading="lazy" src="${img}" alt="">${prog}<div class="meta"><div class="name" title="${esc(f.rel_path)}">${esc(f.name)}</div>
      <span class="badge b-${st}">${STATUS[st] || st}</span>${st === "running" ? ` <span class="small muted">${esc(cur.step || "")}</span>` : ""}
      ${f.error ? `<div class="small" style="color:var(--err)">${esc(f.error)}</div>` : ""}</div></div>`;
  }).join("") || `<div class="muted">Нет кадров</div>`;
  $$("#frames .frame").forEach((el) => {
    el.querySelector(".sel").addEventListener("click", (e) => { e.stopPropagation(); e.target.checked ? selected.add(el.dataset.id) : selected.delete(el.dataset.id); updateButtons(); });
    el.addEventListener("click", () => openModal(frames.find((f) => f.id === el.dataset.id)));
  });
}
function schedulePoll(active) {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    if (!$("#view-job").classList.contains("hidden")) await refresh().catch(() => {});
    else schedulePoll(active);
  }, active ? 1500 : 6000);
}

// ---------------------------------------------------------------- просмотр кадра
let compareMode = "side";
$$("#modal [data-mode]").forEach((b) => b.addEventListener("click", () => {
  compareMode = b.dataset.mode; $$("#modal [data-mode]").forEach((x) => x.classList.toggle("active", x === b)); applyCompare();
}));
function applyCompare() {
  $("#compare").className = "compare " + compareMode;
  $("#sliderWrap").classList.toggle("hidden", compareMode !== "slider");
  if (compareMode === "slider") syncSlider();
}
function syncSlider() {
  const a = $("#sA"), b = $("#sB");
  b.style.width = a.clientWidth + "px"; b.style.height = a.clientHeight + "px";
  $("#sBclip").style.width = $("#slider").value + "%";
}
$("#slider").addEventListener("input", syncSlider);
$("#sA").addEventListener("load", syncSlider);
function issueList(qcData) {
  const issues = (qcData && qcData.issues) || [];
  const shown = issues.filter((i) => i.severity !== "info");
  let h = shown.length ? `<ul class="issues">${shown.map((i) => `<li class="${i.severity}">${esc(i.message)}</li>`).join("")}</ul>` : `<div class="msg ok">Автоматические проверки не нашли проблем. Художественное качество оцените сами.</div>`;
  const m = (qcData && qcData.metrics) || {};
  if (m.face_similarity && m.face_similarity.length) h += `<div class="muted">Сходство лица с оригиналом: ${m.face_similarity.join(", ")} (1.0 — без изменений)</div>`;
  const w = (qcData && qcData.warnings) || [];
  for (const x of w) h += `<div class="msg warn">${esc(x)}</div>`;
  return h;
}
function openModal(f, preview = null) {
  modalFrame = f;
  $("#mTitle").textContent = (preview ? "Пробный кадр: " : "") + f.rel_path;
  const t = Date.now();
  const orig = `/api/frames/${f.id}/image/original?size=1600`;
  const res = preview ? `/api/frames/${f.id}/image/preview?size=1600&t=${t}` : (f.result_path ? `/api/frames/${f.id}/image/result?size=1600&t=${t}` : orig);
  $("#imgA").src = orig; $("#imgB").src = res; $("#sA").src = res; $("#sB").src = orig;
  let info = "";
  if (preview) info = (preview.error ? `<div class="msg err">${esc(preview.error)}</div>` : "") + issueList(preview);
  else {
    info = `<div>Статус: <span class="badge b-${f.status}">${STATUS[f.status] || f.status}</span>, попыток: ${f.attempts}</div>`;
    if (f.error) info += `<div class="msg err">${esc(f.error)}</div>`;
    if (f.result_path) info += issueList(f.qc);
  }
  $("#mInfo").innerHTML = info;
  $("#mApprove").classList.toggle("hidden", preview || f.status !== "review");
  $("#mReprocess").classList.toggle("hidden", !!preview);
  $("#mText").classList.toggle("hidden", !!preview);
  $("#mDownload").classList.toggle("hidden", !!preview || !f.result_path);
  $("#mDownload").href = `/api/frames/${f.id}/download`;
  $("#modal").classList.remove("hidden");
  applyCompare();
}
$("#mClose").onclick = () => $("#modal").classList.add("hidden");
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") $("#modal").classList.add("hidden"); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("#modal").classList.add("hidden"); });
$("#mApprove").onclick = async () => {
  try { await post(`/api/frames/${modalFrame.id}/approve`); toast("Кадр одобрен"); $("#modal").classList.add("hidden"); refresh(); loadReview(); } catch (e) { toast(e.message, true); }
};
$("#mReprocess").onclick = async () => {
  try { await post(`/api/jobs/${modalFrame.job_id}/reprocess`, { frames: [modalFrame.id], text: $("#mText").value.trim() || null });
    toast("Кадр поставлен на повторную обработку"); $("#modal").classList.add("hidden"); $("#mText").value = ""; refresh(); loadReview(); }
  catch (e) { toast(e.message, true); }
};

// ---------------------------------------------------------------- история, проверка, система
async function loadHistory() {
  const jobs = await api("/api/jobs");
  $("#history").innerHTML = jobs.length ? `<table><tr><th>Задание</th><th>Описание</th><th>Статус</th><th>Кадры</th><th>Создано</th><th></th></tr>${jobs.map((j) => `
    <tr><td><b>${esc(j.title)}</b></td><td class="small">${esc((j.task_text || "").slice(0, 160))}</td><td>${JOB_STATUS[j.status] || j.status}</td>
    <td class="small">всего ${j.total}, готово ${j.done}, на проверку ${j.review}, ошибок ${j.failed}</td>
    <td class="small">${new Date(j.created_at * 1000).toLocaleString()}</td>
    <td><button onclick="openJob('${j.id}')">Открыть</button></td></tr>`).join("")}</table>` : `<div class="muted">Заданий пока нет</div>`;
}
window.openJob = openJob;
async function loadReview() {
  const list = await api("/api/review");
  $("#reviewCount").textContent = list.length; $("#reviewCount").classList.toggle("hidden", !list.length);
  $("#reviewList").innerHTML = list.map((f) => `<div class="frame" data-id="${f.id}">
    <img loading="lazy" src="${f.result_path ? `/api/frames/${f.id}/image/result?size=300&t=${f.updated_at}` : `/api/frames/${f.id}/image/original?size=300`}">
    <div class="meta"><div class="name">${esc(f.name)}</div><div class="small muted">${esc(f.job_title)}</div>
    <span class="badge b-${f.status}">${STATUS[f.status]}</span>
    <div class="small">${esc(f.error || ((f.qc.issues || []).filter((i) => i.severity !== "info").map((i) => i.message).join("; ")))}</div></div></div>`).join("") || `<div class="muted">Нет кадров, требующих проверки</div>`;
  $$("#reviewList .frame").forEach((el) => el.addEventListener("click", () => openModal(list.find((f) => f.id === el.dataset.id))));
}
async function loadSystem() {
  const [models, sys] = await Promise.all([api("/api/models"), api("/api/system")]);
  $("#models").innerHTML = `<table><tr><th>Модель</th><th>Назначение</th><th>Лицензия</th><th>Размер</th><th></th></tr>${models.map((m) => {
    const d = m.download;
    let act = m.installed ? `<span class="badge b-done">Установлена</span>` : `<button onclick="dl('${m.id}')">Скачать</button>`;
    if (d && d.status === "downloading") act = `Скачивание ${(d.done / 1048576).toFixed(0)} / ${(d.total / 1048576).toFixed(0)} МБ`;
    if (d && d.status === "error") act = `<span style="color:var(--err)">${esc(d.error)}</span> <button onclick="dl('${m.id}')">Повторить</button>`;
    return `<tr><td><b>${esc(m.title)}</b>${m.required ? ' <span class="small muted">(основная)</span>' : ""}</td><td class="small">${esc(m.purpose)}</td>
      <td class="small"><a href="${m.license_url}" target="_blank">${esc(m.license)}</a>${m.commercial_ok ? " — коммерческое использование разрешено" : ""}</td><td>${m.size_mb} МБ</td><td>${act}</td></tr>`;
  }).join("")}</table>`;
  const c = sys.comfyui || {};
  let comfy = c.available ? `Запущен${c.device ? " (" + esc(c.device) + (c.vram_total_gb ? ", " + c.vram_total_gb + " ГБ" : "") + ")" : ""}. ` +
    (c.can_edit ? `Модель редактирования: ${esc(c.edit_models.unet)}.` : `Для замены одежды не хватает: ${esc((c.missing_models || []).concat(c.missing_nodes || []).join(", "))}.`) +
    (c.upscale_model ? ` Увеличение: ${esc(c.upscale_model)}.` : " Модели ИИ-увеличения нет — используется классическое.")
    : esc(c.reason || "не запущен") + ". Без него работают все операции, кроме замены одежды и ИИ-увеличения.";
  $("#sysinfo").innerHTML = `<table>
    <tr><td>Версия</td><td>${esc(sys.version)}</td></tr>
    <tr><td>Папка данных</td><td>${esc(sys.data_dir)}</td></tr>
    <tr><td>Папка моделей</td><td>${esc(sys.models_dir)}</td></tr>
    <tr><td>Ускорение нейросетей (ONNX)</td><td>${esc(sys.onnx_providers.join(", "))}</td></tr>
    <tr><td>ComfyUI</td><td>${comfy}</td></tr>
    <tr><td>Локальная языковая модель</td><td>${sys.ollama_model ? esc(sys.ollama_model) : "не настроена (не обязательна)"}</td></tr></table>`;
  if (models.some((m) => m.download && m.download.status === "downloading")) setTimeout(() => { if (!$("#view-system").classList.contains("hidden")) loadSystem(); }, 1500);
}
window.dl = async (id) => { await post(`/api/models/${id}/download`); loadSystem(); };

async function workerStatus() {
  try {
    const s = await api("/api/system");
    const cur = s.current;
    $("#worker").textContent = cur && cur.name ? `Обработка: ${cur.name} — ${cur.step}` : "Ожидание";
  } catch { $("#worker").textContent = "Нет связи с сервером"; }
  setTimeout(workerStatus, 4000);
}

(async function init() {
  await ensureJob();
  await refresh(true);
  loadReview().catch(() => {});
  workerStatus();
})();
