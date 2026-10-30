import { firebaseConfig, ADMIN_EMAILS } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, doc, query, orderBy, onSnapshot, addDoc, setDoc, getDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const DOC_CATS = ["Kế hoạch", "Văn bản hướng dẫn", "Biểu mẫu", "Tài liệu sinh hoạt", "Khác"];
const S = { info: {}, anns: [], weeks: [], photos: [], docs: [], canEdit: false, user: null, photoFilter: "all", lbList: [], lbIndex: 0, loaded: false };
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const todayISO = () => { const t = new Date(); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`; };
const fmt = (d) => { if (!d) return ""; const [y, m, dd] = String(d).split("-"); return dd ? `${dd}/${m}/${y}` : d; };

/* ---------- Kết nối Firebase ---------- */
const configured = firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("DIEN_");
let db = null, auth = null;
if (configured) {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
}
const isAdmin = (u) => !!u && ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(String(u.email).toLowerCase());

/* ---------- Điều hướng ---------- */
const VIEWS = ["trang-chu", "sinh-hoat", "thong-bao", "anh", "tai-lieu"];
function show(v) {
  if (!VIEWS.includes(v)) v = "trang-chu";
  document.querySelectorAll(".view[data-v]").forEach((el) => (el.hidden = el.dataset.v !== v));
  document.querySelectorAll(".nav a").forEach((a) => a.dataset.view === v ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  history.replaceState(null, "", "#" + v);
}
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-view]");
  if (!a) return;
  e.preventDefault();
  show(a.dataset.view);
  window.scrollTo({ top: 0 });
});
show(location.hash.slice(1));

/* ---------- Hiển thị ---------- */
function currentWeek() {
  const t = todayISO();
  return S.weeks.find((w) => w.from <= t && t <= (w.to || w.from)) || null;
}
function weekHTML(w, isCurrent) {
  const lines = String(w.content || "").split("\n").map((s) => s.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
  return `<article class="card week${isCurrent ? " current" : ""}">
    <div class="week-no"><div class="lbl">Tuần</div><div class="num">${esc(w.week)}</div></div>
    <div class="week-body">
      <div class="week-top"><span class="dates">${fmt(w.from)}${w.to ? " – " + fmt(w.to) : ""}</span>${isCurrent ? '<span class="chip">Tuần này</span>' : ""}</div>
      ${w.theme ? `<h3>${esc(w.theme)}</h3>` : ""}
      <div class="meta-row">${w.duty ? `<span><b>Lớp trực tuần:</b> ${esc(w.duty)}</span>` : ""}${w.host ? `<span><b>Phụ trách chào cờ:</b> ${esc(w.host)}</span>` : ""}</div>
      ${lines.length ? `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}
      ${w.note ? `<div class="muted">Ghi chú: ${esc(w.note)}</div>` : ""}
      ${S.canEdit ? `<div class="actions"><button class="btn small" data-edit-week="${esc(w.id)}" type="button">Sửa</button><button class="btn small danger" data-del="weekly/${esc(w.id)}" type="button">Xóa</button></div>` : ""}
    </div></article>`;
}
function sortedAnns() {
  return [...S.anns].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || String(b.date).localeCompare(String(a.date)) || (b.createdAt || 0) - (a.createdAt || 0));
}
const annTags = (a) => (a.pinned ? '<span class="chip">Ghim</span>' : "") + (a.urgent ? '<span class="chip red">Khẩn</span>' : "");
const emptyHTML = (title, text) => `<div class="empty"><strong>${esc(title)}</strong>${esc(text)}</div>`;

function render() {
  const info = S.info;
  $("#hdr-unit").textContent = info.unit || "Liên đội";
  const sub = [info.school, info.year ? "Năm học " + info.year : ""].filter(Boolean).join(" · ");
  $("#hdr-sub").textContent = sub || "Sinh hoạt hàng tuần · Thông báo · Ảnh truyền thống · Tài liệu";
  if (info.school) document.title = "Góc Tổng Phụ trách Đội · " + info.school;
  $("#ftr-who").textContent = info.leader ? "Tổng Phụ trách Đội: " + info.leader + (info.contact ? " · " + info.contact : "") : "";
  ["#btn-info", "#add-week", "#add-ann", "#add-photo", "#add-doc"].forEach((s) => ($(s).hidden = !S.canEdit));
  $("#btn-auth").textContent = S.user ? `Đăng xuất (${S.user.email})` : "Đăng nhập quản trị";
  $("#btn-auth").hidden = !configured;

  const hint = S.canEdit ? " Bấm nút phía trên để thêm." : "";
  const loading = configured && !S.loaded;
  const canSeed = S.canEdit && S.loaded && !S.weeks.length && !S.anns.length;
  const seedBtn = canSeed ? `<div style="margin-top:12px"><button class="btn primary" type="button" data-seed="1">Thêm nội dung khởi đầu</button></div>` : "";

  const cw = currentWeek() || S.weeks[0];
  $("#home-week").innerHTML = cw ? weekHTML(cw, cw === currentWeek()) : emptyHTML(loading ? "Đang tải…" : "Chưa có lịch sinh hoạt", loading ? "" : "Lịch sinh hoạt của tuần sẽ hiện ở đây.").replace(/<\/div>$/, seedBtn + "</div>");
  const top = sortedAnns().slice(0, 4);
  $("#home-ann").innerHTML = top.length ? top.map((a) => `<div class="ann-mini"><div class="ann-head"><span class="t">${esc(a.title)}</span>${annTags(a)}</div><span class="muted" style="font-size:13px">${fmt(a.date)}</span></div>`).join("") : `<span class="muted">${loading ? "Đang tải…" : "Chưa có thông báo nào."}</span>`;
  const recent = S.photos.slice(0, 6);
  $("#home-photos").innerHTML = recent.length ? `<div class="strip">${recent.map((p, i) => `<button type="button" data-lb-home="${i}" aria-label="${esc(p.caption || "Xem ảnh")}"><img src="${esc(p.thumb)}" alt="${esc(p.caption || "")}" loading="lazy"></button>`).join("")}</div>` : emptyHTML("Kho ảnh đang trống", "Ảnh các hoạt động, ngày lễ của Liên đội sẽ hiện ở đây.");

  const cur = currentWeek();
  $("#weeks").innerHTML = S.weeks.length ? S.weeks.map((w) => weekHTML(w, w === cur)).join("") : emptyHTML("Chưa có tuần nào", "Mỗi tuần gồm chủ điểm, lớp trực tuần và nội dung sinh hoạt." + hint);

  const anns = sortedAnns();
  $("#anns").innerHTML = anns.length ? anns.map((a) => `<article class="card ann${a.urgent ? " urgent" : ""}">
      <div class="ann-head"><h3>${esc(a.title)}</h3>${annTags(a)}</div>
      <div class="date">Ngày ${fmt(a.date)}</div>
      ${a.body ? `<p class="body">${esc(a.body)}</p>` : ""}
      ${S.canEdit ? `<div class="actions"><button class="btn small" data-edit-ann="${esc(a.id)}" type="button">Sửa</button><button class="btn small danger" data-del="announcements/${esc(a.id)}" type="button">Xóa</button></div>` : ""}
    </article>`).join("") : emptyHTML("Chưa có thông báo", "Các thông báo cho chi đội sẽ hiện ở đây." + hint);

  renderPhotos(hint);
  renderDocs(hint);
}

const albumOf = (p) => (p.album || "Ảnh khác").trim();
function renderPhotos(hint) {
  const albums = [...new Set(S.photos.map(albumOf))];
  if (S.photoFilter !== "all" && !albums.includes(S.photoFilter)) S.photoFilter = "all";
  $("#photo-filters").innerHTML = albums.length > 1 ? [["all", "Tất cả"], ...albums.map((a) => [a, a])].map(([v, l]) => `<button type="button" data-filter="${esc(v)}" aria-pressed="${S.photoFilter === v}">${esc(l)}</button>`).join("") : "";
  const list = S.photos.filter((p) => S.photoFilter === "all" || albumOf(p) === S.photoFilter);
  S.lbList = list;
  if (!list.length) { $("#albums").innerHTML = emptyHTML("Chưa có ảnh", "Tải ảnh theo từng hoạt động, ví dụ “Đại hội Liên đội 2026–2027”." + (hint || "")); return; }
  const groups = new Map();
  list.forEach((p, i) => { const k = albumOf(p); if (!groups.has(k)) groups.set(k, []); groups.get(k).push([p, i]); });
  $("#albums").innerHTML = [...groups].map(([name, items]) => {
    const years = [...new Set(items.map(([p]) => p.year).filter(Boolean))].join(", ");
    return `<div class="album"><h3>${esc(name)} <span class="muted">${items.length} ảnh${years ? " · " + esc(years) : ""}</span></h3>
      <div class="gallery">${items.map(([p, i]) => `<figure class="photo"><button type="button" data-lb="${i}" aria-label="Phóng to ảnh"><img src="${esc(p.thumb)}" alt="${esc(p.caption || name)}" loading="lazy"></button>${p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ""}</figure>`).join("")}</div></div>`;
  }).join("");
}

function docType(url) {
  if (/docs\.google\.com\/document/.test(url)) return "DOC";
  if (/docs\.google\.com\/spreadsheets/.test(url)) return "SHEET";
  if (/docs\.google\.com\/presentation/.test(url)) return "SLIDE";
  if (/drive\.google\.com/.test(url)) return "DRIVE";
  if (/\.pdf($|\?)/i.test(url)) return "PDF";
  return "LINK";
}
function renderDocs(hint) {
  const sel = $("#doc-cat");
  if (!sel.options.length) sel.innerHTML = `<option value="all">Tất cả nhóm</option>` + DOC_CATS.map((c) => `<option>${esc(c)}</option>`).join("");
  const q = $("#doc-q").value.trim().toLowerCase();
  const cat = sel.value;
  const list = S.docs.filter((d) => (cat === "all" || d.category === cat) && (!q || String(d.name).toLowerCase().includes(q)));
  if (!S.docs.length) { $("#docs").innerHTML = emptyHTML("Chưa có tài liệu", "Tài liệu được lưu bằng đường link Google Drive." + (hint || "")); return; }
  if (!list.length) { $("#docs").innerHTML = emptyHTML("Không tìm thấy", "Thử từ khóa khác hoặc chọn “Tất cả nhóm”."); return; }
  $("#docs").innerHTML = `<div class="table-wrap"><table><thead><tr><th>Tên tài liệu</th><th>Nhóm</th><th>Loại</th><th>Ngày thêm</th><th></th></tr></thead><tbody>
    ${list.map((d) => `<tr><td class="name">${esc(d.name)}</td><td>${esc(d.category || "")}</td><td><span class="ftype">${docType(d.url)}</span></td><td class="num">${fmt(d.date)}</td>
      <td><div class="actions" style="justify-content:flex-end"><a class="btn small" href="${esc(d.url)}" target="_blank" rel="noopener">Mở</a>${S.canEdit ? `<button class="btn small" type="button" data-edit-doc="${esc(d.id)}">Sửa</button><button class="btn small danger" type="button" data-del="docs/${esc(d.id)}">Xóa</button>` : ""}</div></td></tr>`).join("")}
  </tbody></table></div>`;
}
$("#doc-q").addEventListener("input", () => renderDocs(""));
$("#doc-cat").addEventListener("change", () => renderDocs(""));

/* ---------- Hộp thoại nhập liệu ---------- */
const dlg = $("#dlg"), dform = $("#dlg-form");
let dSubmit = null;
function field(f) {
  const id = "f-" + f.name, v = f.value ?? "";
  if (f.type === "checkbox") return `<div class="field check"><input type="checkbox" id="${id}" name="${f.name}" ${v ? "checked" : ""}><label for="${id}">${esc(f.label)}</label></div>`;
  let input;
  if (f.type === "textarea") input = `<textarea id="${id}" name="${f.name}" placeholder="${esc(f.placeholder || "")}">${esc(v)}</textarea>`;
  else if (f.type === "select") input = `<select id="${id}" name="${f.name}">${f.options.map((o) => `<option ${o === v ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
  else input = `<input id="${id}" name="${f.name}" type="${f.type || "text"}" value="${esc(v)}" placeholder="${esc(f.placeholder || "")}" ${f.accept ? `accept="${f.accept}"` : ""} ${f.multiple ? "multiple" : ""} ${f.list ? `list="${id}-l"` : ""}>${f.list ? `<datalist id="${id}-l">${f.list.map((o) => `<option value="${esc(o)}">`).join("")}</datalist>` : ""}`;
  return `<div class="field"><label for="${id}">${esc(f.label)}${f.required ? " *" : ""}</label>${input}${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ""}</div>`;
}
function openForm(title, rows, onSubmit, submitLabel = "Lưu") {
  dform.innerHTML = `<h3>${esc(title)}</h3>${rows.map((r) => Array.isArray(r) ? `<div class="row2">${r.map(field).join("")}</div>` : field(r)).join("")}
    <div class="form-status" id="f-status" role="status"></div>
    <div class="form-foot"><button class="btn" type="button" id="f-cancel">Hủy</button><button class="btn primary" type="submit" id="f-submit">${esc(submitLabel)}</button></div>`;
  dSubmit = onSubmit;
  $("#f-cancel").onclick = () => dlg.close();
  dlg.showModal();
}
function status(msg, err) { const el = $("#f-status"); if (el) { el.textContent = msg; el.className = "form-status" + (err ? " err" : ""); } }
dform.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!dSubmit) return;
  const fd = {};
  dform.querySelectorAll("[name]").forEach((el) => (fd[el.name] = el.type === "checkbox" ? el.checked : el.type === "file" ? [...el.files] : el.value.trim()));
  const btn = $("#f-submit");
  btn.disabled = true;
  try { const done = await dSubmit(fd); if (done !== false) dlg.close(); }
  catch (err) { console.error(err); status(errText(err), true); }
  finally { btn.disabled = false; }
});
function errText(err) {
  const c = err && err.code;
  if (c === "permission-denied") return "Tài khoản này chưa có quyền chỉnh sửa. Kiểm tra email quản trị trong firebase-config.js và quy tắc Firestore.";
  if (c === "resource-exhausted") return "Đã hết hạn mức miễn phí trong ngày. Thử lại vào ngày mai.";
  if (c === "invalid-argument") return "Ảnh quá lớn sau khi nén. Hãy chọn ảnh khác.";
  return "Chưa lưu được. Kiểm tra kết nối mạng rồi thử lại." + (err && err.message ? " (" + err.message + ")" : "");
}

/* ---------- Nén ảnh để lưu thẳng trong Firestore (mỗi tài liệu tối đa 1 MB) ---------- */
async function compress(file, maxSide, maxChars) {
  const bmp = await createImageBitmap(file);
  let side = maxSide, q = 0.82, out = "";
  for (let i = 0; i < 8; i++) {
    const scale = Math.min(1, side / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    out = c.toDataURL("image/jpeg", q);
    if (out.length <= maxChars) return out;
    if (q > 0.6) q -= 0.1; else side = Math.round(side * 0.8);
  }
  return out;
}

/* ---------- Thêm / sửa ---------- */
function editInfo() {
  const i = S.info;
  openForm("Thông tin Liên đội", [
    { name: "school", label: "Tên trường", value: i.school, placeholder: "Trường THCS …" },
    { name: "unit", label: "Tên Liên đội", value: i.unit, placeholder: "Liên đội …" },
    [{ name: "leader", label: "Tổng Phụ trách Đội", value: i.leader, placeholder: "Thầy …" }, { name: "year", label: "Năm học", value: i.year, placeholder: "2026–2027" }],
    { name: "contact", label: "Liên hệ (không bắt buộc)", value: i.contact, placeholder: "Số điện thoại hoặc email" },
  ], async (f) => { await setDoc(doc(db, "site", "info"), { school: f.school, unit: f.unit, leader: f.leader, year: f.year, contact: f.contact }); });
}
function editWeek(w) {
  const last = S.weeks[0];
  w = w || { week: last ? Number(last.week) + 1 : 1 };
  openForm(w.id ? "Sửa tuần " + w.week : "Thêm tuần sinh hoạt", [
    [{ name: "week", label: "Tuần thứ", type: "number", value: w.week, required: true }, { name: "duty", label: "Lớp trực tuần", value: w.duty, placeholder: "7A2" }],
    [{ name: "from", label: "Từ ngày", type: "date", value: w.from, required: true }, { name: "to", label: "Đến ngày", type: "date", value: w.to }],
    { name: "theme", label: "Chủ điểm", value: w.theme, placeholder: "Tôn sư trọng đạo" },
    { name: "host", label: "Phụ trách chào cờ", value: w.host, placeholder: "Chi đội 8A1" },
    { name: "content", label: "Nội dung sinh hoạt", type: "textarea", value: w.content, hint: "Mỗi dòng là một nội dung.", placeholder: "Chào cờ, nhận xét thi đua tuần trước\nPhát động phong trào …" },
    { name: "note", label: "Ghi chú", value: w.note },
  ], async (f) => {
    if (!f.week || !f.from) { status("Hãy nhập số tuần và ngày bắt đầu.", true); return false; }
    const data = { week: Number(f.week), from: f.from, to: f.to, theme: f.theme, duty: f.duty, host: f.host, content: f.content, note: f.note, updatedAt: Date.now() };
    await (w.id ? setDoc(doc(db, "weekly", w.id), data) : addDoc(collection(db, "weekly"), data));
  });
}
function editAnn(a) {
  a = a || { date: todayISO() };
  openForm(a.id ? "Sửa thông báo" : "Đăng thông báo", [
    { name: "title", label: "Tiêu đề", value: a.title, required: true },
    { name: "date", label: "Ngày", type: "date", value: a.date },
    { name: "body", label: "Nội dung", type: "textarea", value: a.body },
    { name: "pinned", label: "Ghim lên đầu", type: "checkbox", value: a.pinned },
    { name: "urgent", label: "Đánh dấu khẩn", type: "checkbox", value: a.urgent },
  ], async (f) => {
    if (!f.title) { status("Hãy nhập tiêu đề.", true); return false; }
    const data = { title: f.title, date: f.date || todayISO(), body: f.body, pinned: f.pinned, urgent: f.urgent, createdAt: a.createdAt || Date.now() };
    await (a.id ? setDoc(doc(db, "announcements", a.id), data) : addDoc(collection(db, "announcements"), data));
  }, a.id ? "Lưu" : "Đăng");
}
function addPhotos() {
  const albums = [...new Set(S.photos.map(albumOf))];
  openForm("Tải ảnh truyền thống", [
    { name: "files", label: "Chọn ảnh", type: "file", accept: "image/*", multiple: true, required: true, hint: "Có thể chọn nhiều ảnh. Ảnh được tự động thu nhỏ còn khoảng 1600px để tiết kiệm dung lượng." },
    { name: "album", label: "Hoạt động / album", list: albums, placeholder: "Đại hội Liên đội 2026–2027" },
    [{ name: "year", label: "Năm", value: String(new Date().getFullYear()) }, { name: "caption", label: "Chú thích chung", placeholder: "Không bắt buộc" }],
  ], async (f) => {
    const files = f.files || [];
    if (!files.length) { status("Hãy chọn ít nhất một ảnh.", true); return false; }
    let ok = 0; const fail = [];
    for (const file of files) {
      status(`Đang xử lý ${ok + fail.length + 1}/${files.length}: ${file.name}`);
      try {
        const [full, thumb] = [await compress(file, 1600, 900000), await compress(file, 420, 60000)];
        const ref = await addDoc(collection(db, "photos"), { thumb, album: f.album || "Ảnh khác", year: f.year, caption: f.caption, createdAt: Date.now() });
        await setDoc(doc(db, "photoFull", ref.id), { data: full });
        ok++;
      } catch (err) { console.error(err); fail.push(file.name + ": " + errText(err)); }
    }
    if (fail.length) { status(`Đã tải ${ok} ảnh. Lỗi: ${fail.join(" · ")}`, true); return false; }
  }, "Tải lên");
}
function editDocItem(d) {
  d = d || {};
  openForm(d.id ? "Sửa tài liệu" : "Thêm tài liệu", [
    { name: "url", label: "Đường link tài liệu", type: "url", value: d.url, required: true, placeholder: "https://drive.google.com/…", hint: "Trên Google Drive: bấm Chia sẻ → “Bất kỳ ai có đường liên kết” → Sao chép đường liên kết." },
    { name: "name", label: "Tên hiển thị", value: d.name, required: true, placeholder: "Kế hoạch hoạt động Đội năm học 2026–2027" },
    { name: "category", label: "Nhóm", type: "select", options: DOC_CATS, value: d.category || DOC_CATS[0] },
  ], async (f) => {
    if (!/^https:\/\//i.test(f.url)) { status("Đường link phải bắt đầu bằng https://", true); return false; }
    if (!f.name) { status("Hãy nhập tên tài liệu.", true); return false; }
    const data = { url: f.url, name: f.name, category: f.category, date: d.date || todayISO(), createdAt: d.createdAt || Date.now() };
    await (d.id ? setDoc(doc(db, "docs", d.id), data) : addDoc(collection(db, "docs"), data));
  }, d.id ? "Lưu" : "Thêm");
}
$("#btn-info").onclick = editInfo;
$("#add-week").onclick = () => editWeek();
$("#add-ann").onclick = () => editAnn();
$("#add-photo").onclick = addPhotos;
$("#add-doc").onclick = () => editDocItem();
$("#btn-auth").onclick = async () => {
  try {
    if (S.user) await signOut(auth);
    else await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (err) { console.error(err); notice("Chưa đăng nhập được: " + (err.code || err.message) + ". Kiểm tra tên miền đã được thêm vào Firebase Authentication chưa."); }
};

/* ---------- Nội dung khởi đầu (chỉ hiện nút khi trang còn trống) ---------- */
async function seedSample() {
  const info = await getDoc(doc(db, "site", "info"));
  if (!info.exists()) await setDoc(doc(db, "site", "info"), { school: "Trường TH-THCS Đa Phước", unit: "Liên đội TH-THCS Đa Phước", leader: "", year: "2026–2027", contact: "" });
  const weeks = [
    { week: 8, from: "2026-10-26", to: "2026-10-31", theme: "Mừng ngày Phụ nữ Việt Nam 20/10 – tổng kết tháng 10", duty: "8A1", host: "Chi đội 8A1",
      content: "Chào cờ, nhận xét thi đua tuần 7\nTổng kết phong trào \"Kế hoạch nhỏ\" đợt 1\nPhổ biến chủ điểm tháng 11: Tôn sư trọng đạo" },
    { week: 9, from: "2026-11-02", to: "2026-11-07", theme: "Tôn sư trọng đạo", duty: "7A3", host: "Chi đội 7A3",
      content: "Chào cờ, nhận xét thi đua tuần 8\nPhát động thi đua \"Hoa điểm tốt\" chào mừng 20/11\nCác chi đội đăng ký tiết mục văn nghệ" },
    { week: 10, from: "2026-11-09", to: "2026-11-14", theme: "Tôn sư trọng đạo – Ngày Pháp luật Việt Nam 9/11", duty: "6A1", host: "Chi đội 6A1",
      content: "Chào cờ, nhận xét thi đua tuần 9\nTuyên truyền Ngày Pháp luật Việt Nam 9/11\nCác chi đội làm báo tường chào mừng 20/11, nộp trước thứ Sáu 13/11\nTập luyện văn nghệ chào mừng 20/11" },
    { week: 11, from: "2026-11-16", to: "2026-11-21", theme: "Mừng ngày Nhà giáo Việt Nam 20/11", duty: "9A1", host: "Chi đội 9A1",
      content: "Chào cờ, nhận xét thi đua tuần 10\nChấm và trao giải báo tường\nChương trình văn nghệ chào mừng 20/11\nHọc sinh tri ân thầy cô giáo" },
    { week: 12, from: "2026-11-23", to: "2026-11-28", theme: "Tổng kết tháng 11 – hướng về tháng 12", duty: "8A2", host: "Chi đội 8A2",
      content: "Chào cờ, nhận xét thi đua tuần 11\nTổng kết đợt thi đua \"Hoa điểm tốt\", khen thưởng chi đội xuất sắc\nPhổ biến chủ điểm tháng 12: Uống nước nhớ nguồn (22/12 – Ngày thành lập Quân đội nhân dân Việt Nam)" },
  ];
  for (const w of weeks) await addDoc(collection(db, "weekly"), { ...w, note: "", updatedAt: Date.now() });
  const anns = [
    { title: "Đăng ký tiết mục văn nghệ chào mừng 20/11", date: "2026-10-30", pinned: true, urgent: false,
      body: "Các chi đội nộp danh sách tiết mục cho Ban chỉ huy Liên đội trước thứ Sáu, 06/11/2026.\nMỗi chi đội tối thiểu 1 tiết mục." },
    { title: "Họp Ban chỉ huy Liên đội", date: "2026-10-29", pinned: false, urgent: true,
      body: "16h30 thứ Hai, 02/11/2026 tại phòng Đội. Chi đội trưởng các lớp tham dự đầy đủ." },
    { title: "Thi làm báo tường chào mừng 20/11", date: "2026-10-30", pinned: false, urgent: false,
      body: "Mỗi chi đội làm 1 tờ báo tường khổ A0 với chủ đề \"Tôn sư trọng đạo\".\nNộp về phòng Đội trước thứ Sáu, 13/11/2026. Kết quả công bố trong tuần 11." },
  ];
  for (const a of anns) await addDoc(collection(db, "announcements"), { ...a, createdAt: Date.now() });
}

/* ---------- Xóa (bấm hai lần) ---------- */
async function removePath(path) {
  const [col, id] = path.split("/");
  await deleteDoc(doc(db, col, id));
  if (col === "photos") await deleteDoc(doc(db, "photoFull", id));
}
function armOrRun(btn, run) {
  if (btn.classList.contains("armed")) { btn.disabled = true; run().catch((err) => { btn.textContent = "Lỗi – thử lại"; btn.disabled = false; console.error(err); }); return; }
  const orig = btn.textContent;
  btn.classList.add("armed"); btn.textContent = "Bấm lần nữa để xóa";
  setTimeout(() => { if (btn.isConnected && !btn.disabled) { btn.classList.remove("armed"); btn.textContent = orig; } }, 3500);
}
document.addEventListener("click", (e) => {
  const t = e.target.closest("button");
  if (!t) return;
  if (t.dataset.seed) { t.disabled = true; t.textContent = "Đang thêm…"; return seedSample().catch((err) => { console.error(err); notice(errText(err)); t.disabled = false; t.textContent = "Thêm nội dung khởi đầu"; }); }
  if (t.dataset.del) return armOrRun(t, () => removePath(t.dataset.del));
  if (t.dataset.editWeek) return editWeek(S.weeks.find((w) => w.id === t.dataset.editWeek));
  if (t.dataset.editAnn) return editAnn(S.anns.find((a) => a.id === t.dataset.editAnn));
  if (t.dataset.editDoc) return editDocItem(S.docs.find((d) => d.id === t.dataset.editDoc));
  if (t.dataset.filter) { S.photoFilter = t.dataset.filter; return renderPhotos(""); }
  if (t.dataset.lb) return openLb(S.lbList, Number(t.dataset.lb));
  if (t.dataset.lbHome) return openLb(S.photos, Number(t.dataset.lbHome));
});

/* ---------- Xem ảnh lớn ---------- */
const lb = $("#lb");
let lbSrc = [];
function openLb(list, i) { lbSrc = list; S.lbIndex = i; drawLb(); lb.hidden = false; $("#lb-close").focus(); }
async function drawLb() {
  const p = lbSrc[S.lbIndex]; if (!p) return closeLb();
  const img = $("#lb-img");
  img.src = p.thumb; img.alt = p.caption || albumOf(p);
  $("#lb-cap").innerHTML = `${esc(p.caption || albumOf(p))}<small>${esc(albumOf(p))}${p.year ? " · " + esc(p.year) : ""} · ${S.lbIndex + 1}/${lbSrc.length}</small>`;
  const del = $("#lb-del"); del.hidden = !S.canEdit; del.classList.remove("armed"); del.textContent = "Xóa ảnh"; del.disabled = false;
  try {
    const snap = await getDoc(doc(db, "photoFull", p.id));
    if (snap.exists() && lbSrc[S.lbIndex] === p) img.src = snap.data().data;
  } catch (err) { console.error(err); }
}
function closeLb() { lb.hidden = true; }
$("#lb-close").onclick = closeLb;
$("#lb-prev").onclick = () => { S.lbIndex = (S.lbIndex - 1 + lbSrc.length) % lbSrc.length; drawLb(); };
$("#lb-next").onclick = () => { S.lbIndex = (S.lbIndex + 1) % lbSrc.length; drawLb(); };
$("#lb-del").onclick = (e) => armOrRun(e.currentTarget, async () => { const p = lbSrc[S.lbIndex]; closeLb(); await removePath("photos/" + p.id); });
document.addEventListener("keydown", (e) => {
  if (lb.hidden) return;
  if (e.key === "Escape") closeLb();
  if (e.key === "ArrowLeft") $("#lb-prev").click();
  if (e.key === "ArrowRight") $("#lb-next").click();
});

/* ---------- Tải dữ liệu ---------- */
function notice(msg) { const n = $("#global-notice"); n.hidden = !msg; n.textContent = msg || ""; }
render();
if (!configured) {
  notice("Trang chưa được kết nối Firebase. Thầy mở tệp firebase-config.js và dán cấu hình theo hướng dẫn trong HUONG-DAN.md.");
} else {
  const rows = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  let pending = 4;
  const done = () => { if (--pending <= 0) S.loaded = true; };
  const onErr = (err) => { console.error(err); notice("Không tải được dữ liệu (" + err.code + "). Kiểm tra quy tắc Firestore đã dán đúng chưa."); };
  onSnapshot(doc(db, "site", "info"), (s) => { S.info = s.exists() ? s.data() : {}; render(); }, onErr);
  onSnapshot(query(collection(db, "weekly"), orderBy("from", "desc")), (s) => { S.weeks = rows(s); done(); render(); }, onErr);
  onSnapshot(query(collection(db, "announcements"), orderBy("date", "desc")), (s) => { S.anns = rows(s); done(); render(); }, onErr);
  onSnapshot(query(collection(db, "photos"), orderBy("createdAt", "desc")), (s) => { S.photos = rows(s); done(); render(); }, onErr);
  onSnapshot(query(collection(db, "docs"), orderBy("createdAt", "desc")), (s) => { S.docs = rows(s); done(); render(); }, onErr);
  onAuthStateChanged(auth, (u) => {
    S.user = u; S.canEdit = isAdmin(u);
    if (u && !S.canEdit) notice("Tài khoản " + u.email + " không nằm trong danh sách quản trị, nên chỉ xem được.");
    else if (u) notice("");
    render();
  });
}
