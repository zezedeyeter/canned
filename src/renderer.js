let snippets = [];
let editingId = null;
let activeCategory = null; // null = show all
let activeSnippetId = null;
let searchQuery = '';
let settings = { profileName: 'Zeze%Canned', theme: 'mevcut', avatarPath: '' };

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
const categoryList = $('category-list');
const snippetSidebar = $('snippet-sidebar');
const emptySidebar = $('empty-sidebar');
const editorForm = $('editor-form');
const emptyMain = $('empty-main');
const panelTitle = $('panel-title');
const snippetCount = $('snippet-count');

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
      (s.category || '').toLowerCase().includes(q)
    );
  }
  return list;
}

// ── Render ──────────────────────────────────────────────────────────────────

function renderCategories() {
  const cats = getCategories();
  const total = snippets.length;
  let html = `<button data-cat="" class="cat-pill text-[11px] px-2.5 py-1 rounded-full border transition-all ${!activeCategory ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40' : 'text-slate-400 border-slate-700/50 hover:border-slate-600'}">Tümü <span class="text-slate-500 ml-0.5">${total}</span></button>`;
  for (const [cat, count] of Object.entries(cats).sort()) {
    const [bg, txt, brd] = getCatColor(cat);
    const isActive = activeCategory === cat;
    html += `<button data-cat="${escapeHtml(cat)}" class="cat-pill text-[11px] px-2.5 py-1 rounded-full border transition-all ${isActive ? `${bg} ${txt} ${brd}` : 'text-slate-400 border-slate-700/50 hover:border-slate-600'}">${escapeHtml(cat)} <span class="text-slate-500 ml-0.5">${count}</span></button>`;
  }
  categoryList.innerHTML = html;
  categoryList.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      activeCategory = btn.dataset.cat || null;
      renderAll();
    });
  });

  catSuggestions.innerHTML = Object.keys(cats).map(c => `<option value="${escapeHtml(c)}">`).join('');
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
    showImagePreview(snippet.imagePath || null);
    deleteBtn.classList.remove('hidden');
  } else {
    formTitle.innerHTML = '<svg class="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg> Yeni Canned';
    panelTitle.textContent = 'Yeni canned oluştur';
    triggerInput.value = '';
    textInput.value = '';
    catInput.value = activeCategory || '';
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

  const imagePath = currentImagePath || '';

  if (editingId) {
    snippets = await window.api.updateSnippet({ id: editingId, trigger, text, category, imagePath });
  } else {
    snippets = await window.api.addSnippet({ trigger, text, category, imagePath });
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
  const colors = { char: 'text-emerald-400', key: 'text-amber-400', replacing: 'text-blue-400', done: 'text-cyan-400', error: 'text-red-400' };
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

let draftSettings = null;

function openSettings() {
  draftSettings = { ...settings };
  const nameInput = $('settings-name');
  if (nameInput) nameInput.value = draftSettings.profileName || 'Zeze%Canned';
  applyTheme(draftSettings.theme);
  applyProfileUI(draftSettings);

  // highlight selected theme
  const wrap = $('theme-options');
  if (wrap) {
    wrap.querySelectorAll('button[data-theme]').forEach((b) => {
      b.classList.toggle('ring-2', b.dataset.theme === draftSettings.theme);
      b.classList.toggle('ring-white/25', b.dataset.theme === draftSettings.theme);
    });
  }

  if (settingsModal) settingsModal.classList.remove('hidden');
}

function closeSettings() {
  if (settingsModal) settingsModal.classList.add('hidden');
  draftSettings = null;
  applyTheme(settings.theme);
  applyProfileUI(settings);
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

if (settingsSave) {
  settingsSave.addEventListener('click', async () => {
    const nameInput = $('settings-name');
    const profileName = (nameInput?.value || '').trim();
    const theme = draftSettings?.theme || settings.theme;
    const avatarPath = draftSettings?.avatarPath ?? settings.avatarPath;

    if (!avatarPath && settings.avatarPath) {
      await window.api.removeAvatar();
    }

    settings = await window.api.setSettings({ profileName, theme, avatarPath });
    applyTheme(settings.theme);
    applyProfileUI();
    closeSettings();
    showToast('Profil / tema kaydedildi');
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
  }
});
window.api.onMenuPurge(async () => {
  const res = await window.api.purgeAll();
  if (res?.ok) {
    showToast('Veriler silindi. Uygulama kapanıyor...');
    setTimeout(() => window.close(), 800);
  }
});

async function initApp() {
  try {
    settings = await window.api.getSettings();
  } catch {
    settings = { profileName: 'Zeze%Canned', theme: 'mevcut', avatarPath: '' };
  }
  applyTheme(settings.theme);
  applyProfileUI();
  await loadSnippets();
  await refreshImageGallery();
}

initApp();
