let snippets = [];
let editingId = null;
let activeCategory = null; // null = show all
let activeSnippetId = null;
let searchQuery = '';
let settings = {
  profileName: 'Zeze%Canned',
  theme: 'mevcut',
  avatarPath: '',
  listenedKeys: [],
  emergencyDeletePaths: [],
  uiZoom: 100,
};

const $ = (id) => document.getElementById(id);
const triggerInput = $('trigger-input');
const textInput = $('text-input');
const catInput = $('cat-input');
const catSuggestions = $('cat-suggestions');
const formTitle = $('form-title');
const saveBtn = $('save-btn');
const cancelBtn = $('cancel-btn');
const deleteBtn = $('delete-btn');
const addNewBtn = $('add-new-btn');
const searchInput = $('search-input');
const categorySelect = $('category-select');
const snippetSidebar = $('snippet-sidebar');
const emptySidebar = $('empty-sidebar');
const editorForm = $('editor-form');
const emptyMain = $('empty-main');
const panelTitle = $('panel-title');
const snippetCount = $('snippet-count');
const pasteKeySelect = $('paste-key-select');

/** Eski export / io: değerleri için kısa etiket (uiohook kodu) */
const LEGACY_IO_LABELS = {
  91: 'F13', 92: 'F14', 93: 'F15', 99: 'F16', 100: 'F17', 101: 'F18', 102: 'F19',
  103: 'F20', 104: 'F21', 105: 'F22', 106: 'F23', 107: 'F24',
};

function pasteKeyLabel(code) {
  const n = Number(code);
  if (!n) return '';
  return LEGACY_IO_LABELS[n] || `io:${n}`;
}

function hotkeyBadgeForSnippet(s) {
  if (Number(s.pasteVk)) {
    const vk = Number(s.pasteVk);
    const hit = (settings.listenedKeys || []).find((x) => x.vk === vk);
    return hit ? hit.label : `VK${vk}`;
  }
  if (Number(s.pasteKeycode)) return pasteKeyLabel(s.pasteKeycode);
  return '';
}

function fillPasteKeySelect() {
  if (!pasteKeySelect) return;
  const keys = Array.isArray(settings.listenedKeys) ? settings.listenedKeys : [];
  const parts = ['<option value="">Yok — sadece tetikleyici</option>'];
  if (!keys.length) {
    parts.push('<option value="" disabled>Ayarlar → Klavye: tuşlara basınca bu liste dolacak</option>');
    pasteKeySelect.innerHTML = parts.join('');
    return;
  }
  parts.push('<optgroup label="Algılanan tuşlar (VK)">');
  for (const k of keys) {
    parts.push(`<option value="vk:${k.vk}">${escapeHtml(k.label)} — VK ${k.vk}</option>`);
  }
  parts.push('</optgroup>');
  pasteKeySelect.innerHTML = parts.join('');
}

function renderListenedKeysLog() {
  if (!kbdCaptureLog) return;
  const keys = Array.isArray(settings.listenedKeys) ? settings.listenedKeys : [];
  kbdCaptureLog.value = keys.map((k) => `${k.label} (VK ${k.vk})`).join('  ');
}

function escapeHtml(s) { const e = document.createElement('span'); e.textContent = s; return e.innerHTML; }
function truncate(s, n = 60) { return s.length > n ? s.slice(0, n) + '…' : s; }

function getInitials(name) {
  const s = String(name || '').trim();
  if (!s) return 'Z';
  const parts = s.split(/\s+/).filter(Boolean);
  const first = (parts[0] || 'Z')[0];
  const second = (parts[1] || '')[0] || '';
  return (first + second).toUpperCase();
}

function applyTheme(theme) {
  const t = theme || 'mevcut';
  document.documentElement.setAttribute('data-theme', t);
  // Some Tailwind classes are fixed emerald; we keep them for now, but core accents are CSS-driven.
}

const UI_ZOOM_LEVELS = [90, 100, 120, 140];
function normalizeUiZoom(z) {
  const n = Number(z);
  return UI_ZOOM_LEVELS.includes(n) ? n : 100;
}
function applyUiZoom(z) {
  const pct = normalizeUiZoom(z);
  if (typeof window.api.setUiZoomPercent === 'function') window.api.setUiZoomPercent(pct);
}
function syncZoomOptionButtons(activePct) {
  const wrap = $('zoom-options');
  if (!wrap) return;
  const z = String(normalizeUiZoom(activePct));
  wrap.querySelectorAll('button[data-zoom]').forEach((b) => {
    const on = b.dataset.zoom === z;
    b.classList.toggle('ring-2', on);
    b.classList.toggle('ring-white/25', on);
  });
}

function applyProfileUI(source = settings) {
  const appNameEl = $('app-name');
  const avatarImg = $('app-avatar');
  const avatarFallback = $('app-avatar-fallback');
  const settingsAvatarImg = $('settings-avatar');
  const settingsAvatarFallback = $('settings-avatar-fallback');
  const settingsName = $('settings-name');

  if (appNameEl) appNameEl.textContent = source.profileName || 'Zeze%Canned';
  if (settingsName) settingsName.value = source.profileName || 'Zeze%Canned';

  const initials = getInitials(source.profileName);
  if (avatarFallback) avatarFallback.textContent = initials;
  if (settingsAvatarFallback) settingsAvatarFallback.textContent = initials;

  const hasAvatar = source.avatarPath && typeof source.avatarPath === 'string';
  if (hasAvatar) {
    const src = 'file:///' + source.avatarPath.replace(/\\/g, '/') + '?t=' + Date.now();
    if (avatarImg) { avatarImg.src = src; avatarImg.classList.remove('hidden'); }
    if (settingsAvatarImg) { settingsAvatarImg.src = src; settingsAvatarImg.classList.remove('hidden'); }
    if (avatarFallback) avatarFallback.classList.add('hidden');
    if (settingsAvatarFallback) settingsAvatarFallback.classList.add('hidden');
  } else {
    if (avatarImg) { avatarImg.src = ''; avatarImg.classList.add('hidden'); }
    if (settingsAvatarImg) { settingsAvatarImg.src = ''; settingsAvatarImg.classList.add('hidden'); }
    if (avatarFallback) avatarFallback.classList.remove('hidden');
    if (settingsAvatarFallback) settingsAvatarFallback.classList.remove('hidden');
  }
}

function showToast(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'fixed top-4 right-4 bg-red-600 text-white text-sm px-4 py-2.5 rounded-lg shadow-xl z-50 transition-all opacity-0 translate-y-[-8px]';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1'; t.style.transform = 'translateY(0)';
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(-8px)'; }, 2500);
}

const CAT_COLORS = [
  ['bg-emerald-500/15','text-emerald-400','border-emerald-500/30'],
  ['bg-blue-500/15','text-blue-400','border-blue-500/30'],
  ['bg-purple-500/15','text-purple-400','border-purple-500/30'],
  ['bg-amber-500/15','text-amber-400','border-amber-500/30'],
  ['bg-rose-500/15','text-rose-400','border-rose-500/30'],
  ['bg-cyan-500/15','text-cyan-400','border-cyan-500/30'],
  ['bg-pink-500/15','text-pink-400','border-pink-500/30'],
  ['bg-orange-500/15','text-orange-400','border-orange-500/30'],
];

function getCatColor(cat) {
  let hash = 0;
  for (const c of cat) hash = ((hash << 5) - hash + c.charCodeAt(0)) | 0;
  return CAT_COLORS[Math.abs(hash) % CAT_COLORS.length];
}

function getCategories() {
  const cats = {};
  for (const s of snippets) {
    const c = s.category || 'Genel';
    cats[c] = (cats[c] || 0) + 1;
  }
  return cats;
}

function getFilteredSnippets() {
  let list = snippets;
  if (activeCategory) list = list.filter(s => (s.category || 'Genel') === activeCategory);
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(s =>
      s.trigger.toLowerCase().includes(q) ||
      s.text.toLowerCase().includes(q) ||
      (s.category || '').toLowerCase().includes(q) ||
      hotkeyBadgeForSnippet(s).toLowerCase().includes(q)
    );
  }
  return list;
}

// ── Render ──────────────────────────────────────────────────────────────────

function renderCategories() {
  const cats = getCategories();
  const total = snippets.length;
  const names = Object.keys(cats).sort((a, b) => a.localeCompare(b, 'tr', { sensitivity: 'base' }));
  if (activeCategory && !names.includes(activeCategory)) activeCategory = null;

  if (categorySelect) {
    const opts = [`<option value="">Tümü (${total})</option>`];
    for (const cat of names) {
      const count = cats[cat];
      opts.push(`<option value="${escapeHtml(cat)}">${escapeHtml(cat)} (${count})</option>`);
    }
    categorySelect.innerHTML = opts.join('');
    categorySelect.value = activeCategory || '';
  }

  catSuggestions.innerHTML = names.map((c) => `<option value="${escapeHtml(c)}">`).join('');
}

function renderSidebar() {
  const list = getFilteredSnippets();
  snippetCount.textContent = `${list.length} canned`;

  if (list.length === 0) {
    snippetSidebar.innerHTML = '';
    emptySidebar.classList.remove('hidden');
    return;
  }
  emptySidebar.classList.add('hidden');

  snippetSidebar.innerHTML = list.map(s => {
    const [bg, txt] = getCatColor(s.category || 'Genel');
    const isActive = activeSnippetId === s.id;
    return `
    <div data-id="${s.id}" draggable="true" class="sidebar-item w-full text-left px-3 py-2.5 rounded-lg border-l-2 cursor-grab active:cursor-grabbing ${isActive ? 'border-l-emerald-500 bg-emerald-500/10' : 'border-l-transparent'}">
      <div class="flex items-center gap-2 mb-0.5">
        <svg class="w-3 h-3 text-slate-600 shrink-0 drag-handle" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>
        <code class="text-xs font-mono font-semibold text-emerald-400">${escapeHtml(s.trigger)}</code>
        <span class="text-[10px] px-1.5 py-0.5 rounded ${bg} ${txt}">${escapeHtml(s.category || 'Genel')}</span>
        ${(s.pasteVk || s.pasteKeycode) ? `<span class="text-[9px] px-1 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/25 font-mono" title="Anında yapıştır">${escapeHtml(hotkeyBadgeForSnippet(s))}</span>` : ''}
        ${s.imagePath ? '<svg class="w-3 h-3 text-blue-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>' : ''}
      </div>
      <p class="text-[11px] text-slate-500 truncate leading-relaxed pl-5">${escapeHtml(truncate(s.text, 50))}</p>
    </div>`;
  }).join('');

  snippetSidebar.querySelectorAll('[data-id]').forEach(el => {
    el.addEventListener('click', () => selectSnippet(el.dataset.id));
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', el.dataset.id);
      el.classList.add('opacity-40');
    });
    el.addEventListener('dragend', () => el.classList.remove('opacity-40'));
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      el.classList.add('border-t-2', 'border-t-emerald-500');
    });
    el.addEventListener('dragleave', () => el.classList.remove('border-t-2', 'border-t-emerald-500'));
    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      el.classList.remove('border-t-2', 'border-t-emerald-500');
      const draggedId = e.dataTransfer.getData('text/plain');
      const targetId = el.dataset.id;
      if (draggedId === targetId) return;
      const fromIdx = snippets.findIndex(s => s.id === draggedId);
      const toIdx = snippets.findIndex(s => s.id === targetId);
      if (fromIdx === -1 || toIdx === -1) return;
      const [moved] = snippets.splice(fromIdx, 1);
      snippets.splice(toIdx, 0, moved);
      snippets = await window.api.reorderSnippets(snippets);
      renderAll();
    });
  });
}

function renderAll() {
  renderCategories();
  renderSidebar();
}

// ── Snippet selection & editing ─────────────────────────────────────────────

function selectSnippet(id) {
  const s = snippets.find(x => x.id === id);
  if (!s) return;
  activeSnippetId = id;
  editingId = id;
  showEditor(s);
  renderSidebar();
}

let currentImagePath = null;
const imageZone = $('image-zone');
const imagePlaceholder = $('image-placeholder');
const imagePreview = $('image-preview');
const imageThumb = $('image-thumb');
const imageName = $('image-name');
const imageRemoveBtn = $('image-remove-btn');

function showImagePreview(imgPath) {
  currentImagePath = imgPath;
  if (imgPath) {
    const src = 'file:///' + imgPath.replace(/\\/g, '/') + '?t=' + Date.now();
    imageThumb.src = src;
    imageName.textContent = imgPath.split(/[\\/]/).pop();
    imagePlaceholder.classList.add('hidden');
    imagePreview.classList.remove('hidden');
  } else {
    imagePlaceholder.classList.remove('hidden');
    imagePreview.classList.add('hidden');
    imageThumb.src = '';
    currentImagePath = null;
  }
}

imagePlaceholder.addEventListener('click', async () => {
  const savedPath = await window.api.pickImage();
  if (savedPath) {
    showImagePreview(savedPath);
    await refreshImageGallery();
  }
});

imageRemoveBtn.addEventListener('click', async () => {
  if (currentImagePath && !editingId) {
    await window.api.deleteImage(currentImagePath);
  }
  showImagePreview(null);
  await refreshImageGallery();
});

const imageGallery = $('image-gallery');
const refreshImagesBtn = $('refresh-images');

async function refreshImageGallery() {
  if (!imageGallery) return;
  const images = await window.api.listImages();
  imageGallery.innerHTML = images.slice(0, 40).map((p) => {
    const src = 'file:///' + p.replace(/\\/g, '/') + '?t=' + Date.now();
    return `<button type="button" class="w-6 h-6 rounded overflow-hidden border border-slate-700/50 hover:border-emerald-500/40 transition-colors" data-img="${escapeHtml(p)}" title="Seç"><img src="${src}" class="w-full h-full object-cover" alt="" /></button>`;
  }).join('');
  imageGallery.querySelectorAll('button[data-img]').forEach((b) => {
    b.addEventListener('click', () => showImagePreview(b.dataset.img));
  });
}

if (refreshImagesBtn) refreshImagesBtn.addEventListener('click', refreshImageGallery);

function showEditor(snippet) {
  emptyMain.classList.add('hidden');
  editorForm.classList.remove('hidden');

  if (snippet) {
    formTitle.innerHTML = '<svg class="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg> Canned Düzenle';
    panelTitle.textContent = `Düzenleniyor: ${snippet.trigger}`;
    triggerInput.value = snippet.trigger;
    textInput.value = snippet.text;
    catInput.value = snippet.category || '';
    if (pasteKeySelect) {
      fillPasteKeySelect();
      if (Number(snippet.pasteVk)) {
        const v = `vk:${snippet.pasteVk}`;
        pasteKeySelect.value = [...pasteKeySelect.options].some((o) => o.value === v) ? v : '';
      } else pasteKeySelect.value = '';
    }
    showImagePreview(snippet.imagePath || null);
    deleteBtn.classList.remove('hidden');
  } else {
    formTitle.innerHTML = '<svg class="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg> Yeni Canned';
    panelTitle.textContent = 'Yeni canned oluştur';
    triggerInput.value = '';
    textInput.value = '';
    catInput.value = activeCategory || '';
    if (pasteKeySelect) { fillPasteKeySelect(); pasteKeySelect.value = ''; }
    showImagePreview(null);
    deleteBtn.classList.add('hidden');
  }
}

function hideEditor() {
  editingId = null;
  activeSnippetId = null;
  editorForm.classList.add('hidden');
  emptyMain.classList.remove('hidden');
  panelTitle.textContent = 'Canned seçin veya yeni oluşturun';
  renderSidebar();
}

// ── CRUD ────────────────────────────────────────────────────────────────────

async function loadSnippets() {
  snippets = await window.api.getSnippets();
  renderAll();
}

async function saveSnippet() {
  const trigger = triggerInput.value.trim();
  const text = textInput.value.trim();
  const category = catInput.value.trim() || 'Genel';

  if (!trigger || !text) {
    const el = !trigger ? triggerInput : textInput;
    el.classList.add('ring-2', 'ring-red-500/50');
    setTimeout(() => el.classList.remove('ring-2', 'ring-red-500/50'), 1200);
    el.focus();
    return;
  }

  const duplicate = snippets.find(s => s.trigger === trigger && s.id !== editingId);
  if (duplicate) {
    triggerInput.classList.add('ring-2', 'ring-red-500/50');
    showToast(`"${trigger}" zaten kullanılıyor!`);
    setTimeout(() => triggerInput.classList.remove('ring-2', 'ring-red-500/50'), 2000);
    triggerInput.focus();
    return;
  }

  const rawHot = pasteKeySelect ? String(pasteKeySelect.value || '') : '';
  let pasteVk = 0;
  let pasteKeycode = 0;
  if (rawHot.startsWith('vk:')) pasteVk = parseInt(rawHot.slice(3), 10) || 0;
  else if (rawHot.startsWith('io:')) pasteKeycode = parseInt(rawHot.slice(3), 10) || 0;

  const dupVk = snippets.find((s) => Number(s.pasteVk) === pasteVk && pasteVk && s.id !== editingId);
  if (dupVk) {
    if (pasteKeySelect) pasteKeySelect.classList.add('ring-2', 'ring-red-500/50');
    showToast(`Bu VK zaten "${dupVk.trigger}" için kullanılıyor`);
    setTimeout(() => pasteKeySelect?.classList.remove('ring-2', 'ring-red-500/50'), 2000);
    pasteKeySelect?.focus();
    return;
  }
  const dupIo = snippets.find((s) => Number(s.pasteKeycode) === pasteKeycode && pasteKeycode && s.id !== editingId);
  if (dupIo) {
    if (pasteKeySelect) pasteKeySelect.classList.add('ring-2', 'ring-red-500/50');
    showToast(`Bu kısayol zaten "${dupIo.trigger}" için kullanılıyor`);
    setTimeout(() => pasteKeySelect?.classList.remove('ring-2', 'ring-red-500/50'), 2000);
    pasteKeySelect?.focus();
    return;
  }

  const imagePath = currentImagePath || '';
  const payload = { trigger, text, category, imagePath, pasteVk, pasteKeycode };

  if (editingId) {
    snippets = await window.api.updateSnippet({ id: editingId, ...payload });
  } else {
    snippets = await window.api.addSnippet(payload);
  }

  hideEditor();
  renderAll();
}

async function deleteSnippet() {
  if (!editingId) return;
  snippets = await window.api.deleteSnippet(editingId);
  hideEditor();
  renderAll();
}

// ── Events ──────────────────────────────────────────────────────────────────

addNewBtn.addEventListener('click', () => {
  editingId = null;
  activeSnippetId = null;
  showEditor(null);
  renderSidebar();
  catInput.focus();
});

saveBtn.addEventListener('click', saveSnippet);
cancelBtn.addEventListener('click', hideEditor);
deleteBtn.addEventListener('click', deleteSnippet);

triggerInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') textInput.focus(); });
textInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.ctrlKey) saveSnippet(); });

searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value.trim();
  renderSidebar();
});

if (categorySelect) {
  categorySelect.addEventListener('change', () => {
    activeCategory = categorySelect.value || null;
    renderAll();
  });
}

// ── Emoji Picker ────────────────────────────────────────────────────────────

const EMOJI_DATA = {
  'Sık Kullanılan': ['😀','😂','❤️','👍','🔥','✅','⭐','🎉','💰','🎁','💎','🚀','💪','🙏','👏','😍','🤝','📌','⚡','✨'],
  'Yüzler': ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😉','😊','😇','🥰','😍','🤩','😘','😗','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🥵','🥶','🥴','😵','🤯','😎','🥸','🤠','🥳','🥺','😢','😭','😤','😠','😡','🤬','💀','☠️','😈','👿','👹','👻','💩','🤡','👽'],
  'El & Vücut': ['👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','💪','🦾','🖕','✍️','🤳','💅'],
  'Kalp & Sembol': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉️','☸️','✡️','🔯','🕎','☯️','☦️','🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚛️','🉑','☢️','☣️','📴','📳','🈶','🈚','🈸','🈺','🈷️','✴️','🆚','💮','🉐','㊙️','㊗️','🈴','🈵','🈹','🈲','🅰️','🅱️','🆎','🅾️','🆑','🆘','⛔','📛','🚫','💯','💢','♨️','🚷','🚯','🚳','🚱','🔞','📵','🔇','🔕','🚭','❗','❕','❓','❔','‼️','⁉️','💤','♻️','⚜️','🔱','📣','📢','💹','✳️','❇️','🌐','💠','Ⓜ️','🌀','💲','🏧','🚾','♿','🅿️','🈳','🈂️','🛂','🛃','🛄','🛅'],
  'Doğa': ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🐤','🦅','🦆','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🪱','🐛','🦋','🐌','🐞','🐜','🪰','🪲','🪳','🦟','🦗','🕷️','🌸','💐','🌹','🥀','🌺','🌻','🌼','🌷','🌱','🪴','🌲','🌳','🌴','🌵','🍀','☘️','🍁','🍂','🍃','🍄','🌾','🌑','🌒','🌓','🌔','🌕','🌖','🌗','🌘','🌙','🌚','🌛','🌜','☀️','🌤️','⛅','🌥️','☁️','🌦️','🌈','⭐','🌟','💫','✨','☄️','🌍','🌎','🌏'],
  'Yiyecek': ['🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🫑','🌽','🥕','🧄','🧅','🥔','🍠','🥐','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🫓','🥪','🌮','🌯','🫔','🥙','🧆','🥚','🍲','🥣','🥗','🍿','🧈','🧂','🥫','🍝','🍜','🍛','🍚','🍙','🍘','🍢','🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍩','🍪','🍯','☕','🍵','🫖','🧃','🥤','🧋','🍶','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🧉'],
  'Nesne': ['⌚','📱','💻','⌨️','🖥️','🖨️','🖱️','💾','💿','📀','🎮','🕹️','💡','🔦','📷','📹','📼','🔍','🔬','🔭','📡','📺','📻','🎙️','🎚️','🎛️','⏰','⏱️','⏲️','🕰️','⌛','⏳','📲','💰','💵','💴','💶','💷','💳','💎','⚖️','🧰','🔧','🔨','🪛','🔩','⚙️','🧱','🔗','📎','🖇️','📏','📐','✂️','🗃️','📁','📂','📑','📄','📃','📜','📊','📈','📉','📌','📍','📎','🖊️','🖋️','✒️','📝','✏️','🔒','🔓','🔑','🗝️','🔐'],
  'Bayrak': ['🇹🇷','🇺🇸','🇬🇧','🇩🇪','🇫🇷','🇪🇸','🇮🇹','🇷🇺','🇨🇳','🇯🇵','🇰🇷','🇧🇷','🇮🇳','🇦🇪','🇸🇦','🇦🇿','🏳️','🏴','🏁','🚩','🏳️‍🌈'],
};

const emojiToggle = $('emoji-toggle');
const emojiPicker = $('emoji-picker');
const emojiTabs = $('emoji-tabs');
const emojiGrid = $('emoji-grid');
const emojiSearch = $('emoji-search');
let activeEmojiCat = Object.keys(EMOJI_DATA)[0];

function renderEmojiTabs() {
  const tabIcons = {'Sık Kullanılan':'⭐','Yüzler':'😀','El & Vücut':'👋','Kalp & Sembol':'❤️','Doğa':'🌿','Yiyecek':'🍕','Nesne':'💡','Bayrak':'🏳️'};
  emojiTabs.innerHTML = Object.keys(EMOJI_DATA).map(cat =>
    `<button data-ecat="${escapeHtml(cat)}" class="text-sm px-1.5 py-1 rounded transition-colors shrink-0 ${activeEmojiCat === cat ? 'bg-slate-700' : 'hover:bg-slate-800'}" title="${escapeHtml(cat)}">${tabIcons[cat] || '📁'}</button>`
  ).join('');
  emojiTabs.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => { activeEmojiCat = b.dataset.ecat; renderEmojiTabs(); renderEmojiGrid(); });
  });
}

function renderEmojiGrid(filter = '') {
  let emojis = EMOJI_DATA[activeEmojiCat] || [];
  if (filter) {
    emojis = Object.values(EMOJI_DATA).flat().filter((e, i, a) => a.indexOf(e) === i);
  }
  emojiGrid.innerHTML = emojis.map(e =>
    `<button class="text-xl w-8 h-8 flex items-center justify-center rounded hover:bg-slate-700/60 transition-colors cursor-pointer" data-emoji="${e}">${e}</button>`
  ).join('');
  emojiGrid.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      const pos = textInput.selectionStart || textInput.value.length;
      const val = textInput.value;
      textInput.value = val.slice(0, pos) + b.dataset.emoji + val.slice(pos);
      textInput.focus();
      textInput.selectionStart = textInput.selectionEnd = pos + b.dataset.emoji.length;
    });
  });
}

emojiToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  const isHidden = emojiPicker.classList.contains('hidden');
  emojiPicker.classList.toggle('hidden', !isHidden);
  if (isHidden) { renderEmojiTabs(); renderEmojiGrid(); emojiSearch.value = ''; emojiSearch.focus(); }
});

emojiSearch.addEventListener('input', () => {
  const q = emojiSearch.value.trim();
  if (q) renderEmojiGrid(q);
  else { renderEmojiTabs(); renderEmojiGrid(); }
});

document.addEventListener('click', (e) => {
  if (!emojiPicker.contains(e.target) && e.target !== emojiToggle) {
    emojiPicker.classList.add('hidden');
  }
});

// ── Debug ───────────────────────────────────────────────────────────────────

const debugToggle = $('debug-toggle');
const debugPanel = $('debug-panel');
const debugChevron = $('debug-chevron');
const debugBuffer = $('debug-buffer');
const debugLog = $('debug-log');
let debugOpen = false;

debugToggle.addEventListener('click', () => {
  debugOpen = !debugOpen;
  debugPanel.classList.toggle('hidden', !debugOpen);
  debugChevron.style.transform = debugOpen ? 'rotate(180deg)' : '';
});

window.api.onDebugInfo((data) => {
  debugBuffer.textContent = data.buffer || '(boş)';
  const line = document.createElement('div');
  const colors = { char: 'text-emerald-400', key: 'text-amber-400', hotkey: 'text-violet-400', replacing: 'text-blue-400', done: 'text-cyan-400', error: 'text-red-400' };
  line.className = colors[data.type] || 'text-slate-600';
  line.textContent = data.detail;
  debugLog.appendChild(line);
  if (debugLog.children.length > 30) debugLog.removeChild(debugLog.firstChild);
  debugLog.scrollTop = debugLog.scrollHeight;
});

// ── Init ────────────────────────────────────────────────────────────────────
const settingsModal = $('settings-modal');
const settingsClose = $('settings-close');
const settingsCancel = $('settings-cancel');
const settingsSave = $('settings-save');
const pickAvatarBtn = $('pick-avatar-btn');
const removeAvatarBtn = $('remove-avatar-btn');
const profileBtn = $('profile-btn');
const profileEditHint = $('profile-edit-hint');
const kbdDeviceSelect = $('kbd-device-select');
const kbdClearLogBtn = $('kbd-clear-log-btn');
const kbdClearKeysBtn = $('kbd-clear-keys-btn');
const kbdCaptureLog = $('kbd-capture-log');
const triggerDebounceMsInput = $('trigger-debounce-ms');
const emergencyDeletePathsInput = $('emergency-delete-paths');

let draftSettings = null;

async function populateKbdDeviceSelect() {
  if (!kbdDeviceSelect) return;
  const want = String(draftSettings?.listenKeyboardDevicePath || settings.listenKeyboardDevicePath || '').trim();
  kbdDeviceSelect.innerHTML = '<option value="">Tüm klavyeler</option>';
  try {
    const r = await window.api.listKeyboardRawDevices();
    if (r?.ok && Array.isArray(r.devices)) {
      for (const d of r.devices) {
        const o = document.createElement('option');
        o.value = d.path;
        o.textContent = (d.label || d.path || '').slice(0, 120);
        o.title = d.path || '';
        kbdDeviceSelect.appendChild(o);
      }
    }
  } catch {}
  const ok = want && [...kbdDeviceSelect.options].some((o) => o.value === want);
  kbdDeviceSelect.value = ok ? want : '';
  try {
    await window.api.keyboardPreviewStart(kbdDeviceSelect.value || '');
  } catch {}
}

function openSettings() {
  draftSettings = {
    ...settings,
    listenKeyboardDevicePath: settings.listenKeyboardDevicePath || '',
    triggerDebounceMs: Number(settings.triggerDebounceMs) || 320,
    emergencyDeletePaths: Array.isArray(settings.emergencyDeletePaths) ? [...settings.emergencyDeletePaths] : [],
    uiZoom: normalizeUiZoom(settings.uiZoom),
  };
  const nameInput = $('settings-name');
  if (nameInput) nameInput.value = draftSettings.profileName || 'Zeze%Canned';
  applyTheme(draftSettings.theme);
  applyProfileUI(draftSettings);
  applyUiZoom(draftSettings.uiZoom);
  syncZoomOptionButtons(draftSettings.uiZoom);

  // highlight selected theme
  const wrap = $('theme-options');
  if (wrap) {
    wrap.querySelectorAll('button[data-theme]').forEach((b) => {
      b.classList.toggle('ring-2', b.dataset.theme === draftSettings.theme);
      b.classList.toggle('ring-white/25', b.dataset.theme === draftSettings.theme);
    });
  }

  if (kbdCaptureLog) kbdCaptureLog.value = '';
  if (triggerDebounceMsInput) triggerDebounceMsInput.value = String(draftSettings.triggerDebounceMs);
  if (emergencyDeletePathsInput) {
    emergencyDeletePathsInput.value = (draftSettings.emergencyDeletePaths || []).join('\n');
  }
  void populateKbdDeviceSelect();

  if (settingsModal) settingsModal.classList.remove('hidden');
}

function closeSettings() {
  void window.api.keyboardPreviewStop();
  if (settingsModal) settingsModal.classList.add('hidden');
  draftSettings = null;
  applyTheme(settings.theme);
  applyProfileUI(settings);
  applyUiZoom(settings.uiZoom);
  syncZoomOptionButtons(settings.uiZoom);
}

const faqModal = $('faq-modal');
const faqClose = $('faq-close');
function openFaq() { if (faqModal) faqModal.classList.remove('hidden'); }
function closeFaq() { if (faqModal) faqModal.classList.add('hidden'); }
if (faqClose) faqClose.addEventListener('click', closeFaq);
if (faqModal) faqModal.addEventListener('click', (e) => { if (e.target === faqModal) closeFaq(); });

if (settingsClose) settingsClose.addEventListener('click', closeSettings);
if (settingsCancel) settingsCancel.addEventListener('click', closeSettings);
if (settingsModal) settingsModal.addEventListener('click', (e) => { if (e.target === settingsModal) closeSettings(); });

if (profileBtn) profileBtn.addEventListener('click', openSettings);
if (profileEditHint) profileEditHint.addEventListener('click', openSettings);

const themeOptions = $('theme-options');
if (themeOptions) {
  themeOptions.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-theme]');
    if (!btn) return;
    if (!draftSettings) draftSettings = { ...settings };
    draftSettings.theme = btn.dataset.theme;
    applyTheme(draftSettings.theme);
    themeOptions.querySelectorAll('button[data-theme]').forEach((b) => {
      b.classList.toggle('ring-2', b === btn);
      b.classList.toggle('ring-white/25', b === btn);
    });
  });
}

const zoomOptions = $('zoom-options');
if (zoomOptions) {
  zoomOptions.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-zoom]');
    if (!btn) return;
    if (!draftSettings) draftSettings = { ...settings, uiZoom: normalizeUiZoom(settings.uiZoom) };
    draftSettings.uiZoom = normalizeUiZoom(btn.dataset.zoom);
    applyUiZoom(draftSettings.uiZoom);
    syncZoomOptionButtons(draftSettings.uiZoom);
  });
}

const settingsNameInput = $('settings-name');
if (settingsNameInput) {
  settingsNameInput.addEventListener('input', () => {
    if (!draftSettings) draftSettings = { ...settings };
    draftSettings.profileName = settingsNameInput.value;
    applyProfileUI(draftSettings);
  });
}

if (pickAvatarBtn) {
  pickAvatarBtn.addEventListener('click', async () => {
    const res = await window.api.pickAvatar();
    if (!res?.ok) return;
    if (!draftSettings) draftSettings = { ...settings };
    draftSettings.avatarPath = res.avatarPath || '';
    applyProfileUI(draftSettings);
  });
}

if (removeAvatarBtn) {
  removeAvatarBtn.addEventListener('click', async () => {
    if (!draftSettings) draftSettings = { ...settings };
    draftSettings.avatarPath = '';
    applyProfileUI(draftSettings);
  });
}

if (kbdDeviceSelect) {
  kbdDeviceSelect.addEventListener('change', () => {
    void (async () => {
      if (kbdCaptureLog) kbdCaptureLog.value = '';
      try {
        await window.api.keyboardPreviewStart(kbdDeviceSelect.value || '');
      } catch {}
    })();
  });
}

if (kbdClearLogBtn) {
  kbdClearLogBtn.addEventListener('click', () => {
    if (kbdCaptureLog) kbdCaptureLog.value = '';
  });
}

if (kbdClearKeysBtn) {
  kbdClearKeysBtn.addEventListener('click', async () => {
    try {
      settings = await window.api.setSettings({ clearListenedKeys: true });
      if (draftSettings) draftSettings.listenedKeys = Array.isArray(settings.listenedKeys) ? [...settings.listenedKeys] : [];
      fillPasteKeySelect();
      showToast('Algılanan tuş havuzu sıfırlandı');
    } catch {
      showToast('Havuz sıfırlanamadı');
    }
  });
}

if (typeof window.api.onKeyboardPreviewKey === 'function') {
  window.api.onKeyboardPreviewKey((data) => {
    if (!kbdCaptureLog) return;
    const lab = data?.label;
    if (!lab) return;
    const cur = kbdCaptureLog.value;
    const sep = cur ? ' ' : '';
    let next = cur + sep + lab;
    if (next.length > 2800) next = next.slice(-2800);
    kbdCaptureLog.value = next;
    kbdCaptureLog.scrollTop = kbdCaptureLog.scrollHeight;
  });
}

if (settingsSave) {
  settingsSave.addEventListener('click', async () => {
    const nameInput = $('settings-name');
    const profileName = (nameInput?.value || '').trim();
    const theme = draftSettings?.theme || settings.theme;
    const avatarPath = draftSettings?.avatarPath ?? settings.avatarPath;
    const listenKeyboardDevicePath = (kbdDeviceSelect?.value || '').trim();
    const triggerDebounceMs = parseInt(triggerDebounceMsInput?.value, 10);
    const emergencyDeletePaths = String(emergencyDeletePathsInput?.value || '')
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean);

    if (!avatarPath && settings.avatarPath) {
      await window.api.removeAvatar();
    }

    settings = await window.api.setSettings({
      profileName,
      theme,
      avatarPath,
      listenKeyboardDevicePath,
      triggerDebounceMs: Number.isFinite(triggerDebounceMs) ? triggerDebounceMs : 320,
      emergencyDeletePaths,
      uiZoom: normalizeUiZoom(draftSettings?.uiZoom ?? settings.uiZoom),
    });
    applyTheme(settings.theme);
    applyProfileUI();
    applyUiZoom(settings.uiZoom);
    syncZoomOptionButtons(settings.uiZoom);
    closeSettings();
    showToast('Ayarlar kaydedildi');
  });
}

window.api.onOpenFaq(() => openFaq());
window.api.onMenuExport(async () => {
  const res = await window.api.exportCanneds();
  if (res?.ok) showToast(`Export tamam: ${res.count} canned`);
});
window.api.onMenuImport(async () => {
  const res = await window.api.importCanneds();
  if (res?.ok) {
    await loadSnippets();
    await refreshImageGallery();
    showToast(`Import: ${res.imported} eklendi, ${res.skipped} atlandı`);
    return;
  }
  showToast(`Import hatası: ${res?.reason || 'dosya okunamadı'}`);
});
window.api.onMenuPurge(async () => {
  const res = await window.api.purgeAll();
  if (res?.ok) {
    const failed = Array.isArray(res.failedPaths) ? res.failedPaths.filter(Boolean) : [];
    const logPath = typeof res.purgeLogPath === 'string' ? res.purgeLogPath : '';
    if (res.purgeReport) console.warn('purgeReport (canlı doğrulama):', res.purgeReport);
    if (failed.length) {
      showToast(
        `${failed.length} yol silinemedi. Rapor: ${logPath || '%TEMP%\\\\ZezeCanned-last-purge.log'}`,
      );
      console.warn('purge failedPaths:', failed);
      console.warn('purge triedPaths:', res.triedPaths);
    } else {
      showToast(
        logPath
          ? `Silindi. Rapor: ${logPath}`
          : 'Veriler silindi. Uygulama kapanıyor...',
      );
    }
    setTimeout(() => window.close(), 800);
  }
});

async function initApp() {
  try {
    settings = await window.api.getSettings();
  } catch {
    settings = {
      profileName: 'Zeze%Canned',
      theme: 'mevcut',
      avatarPath: '',
      listenKeyboardDevicePath: '',
      triggerDebounceMs: 320,
      listenedKeys: [],
      emergencyDeletePaths: [],
      uiZoom: 100,
    };
  }
  if (!Array.isArray(settings.listenedKeys)) settings.listenedKeys = [];
  if (!Array.isArray(settings.emergencyDeletePaths)) settings.emergencyDeletePaths = [];
  settings.uiZoom = normalizeUiZoom(settings.uiZoom);
  fillPasteKeySelect();
  renderListenedKeysLog();
  applyTheme(settings.theme);
  applyProfileUI();
  applyUiZoom(settings.uiZoom);
  syncZoomOptionButtons(settings.uiZoom);
  await loadSnippets();
  await refreshImageGallery();
  if (typeof window.api.onListenedKeysChanged === 'function') {
    window.api.onListenedKeysChanged((data) => {
      settings.listenedKeys = Array.isArray(data?.keys) ? data.keys : [];
      if (draftSettings) draftSettings.listenedKeys = [...settings.listenedKeys];
      fillPasteKeySelect();
      renderListenedKeysLog();
      if (
        pasteKeySelect &&
        pasteKeySelect.value &&
        ![...pasteKeySelect.options].some((o) => o.value === pasteKeySelect.value)
      ) {
        pasteKeySelect.value = '';
      }
      renderSidebar();
    });
  }
}

initApp();
