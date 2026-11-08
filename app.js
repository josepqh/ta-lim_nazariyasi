// ===== STATE =====
let currentUser = null; 
let currentModuleId = null;
let modulesCache = [];
let progressCache = {};
let stepContentsCache = {};
let activeCharts = [];

const API_BASE = '/api';

// ===== STRING & INPUT HELPERS =====
function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function normalizeUzbekText(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/[`’‘ʻʼ´]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('uz');
}

function refreshIcons() {
  setTimeout(() => {
    if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
    makeClickablesFocusable();
  }, 10);
}

function motionAllowed() {
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function getYouTubeEmbedUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const host = url.hostname.toLowerCase();
    let videoId = '';

    if (host === 'youtu.be') {
      videoId = url.pathname.slice(1).split('/')[0].split('?')[0];
    } else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(host)) {
      if (url.pathname === '/watch') videoId = url.searchParams.get('v') || '';
      else videoId = url.pathname.match(/^\/(?:embed|shorts)\/([^/?]+)/)?.[1] || '';
    }

    return /^[\w-]{11}$/.test(videoId) ? `https://www.youtube-nocookie.com/embed/${videoId}` : null;
  } catch {
    return null;
  }
}

// ===== API HELPER =====
class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function requestAPI(endpoint, method = 'GET', body = null) {
  const options = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== null) options.body = JSON.stringify(body);

  let res;
  try {
    res = await fetch(`${API_BASE}${endpoint}`, options);
  } catch {
    throw new ApiError("Server bilan aloqa yo‘q. Internetni tekshirib, qayta urinib ko‘ring.", 0);
  }
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok) throw new ApiError(data?.error || `Server xatosi: ${res.status}`, res.status);
  return data;
}

// For page code: shows the error to the user and returns null.
async function fetchAPI(endpoint, method = 'GET', body = null) {
  try {
    return await requestAPI(endpoint, method, body);
  } catch (error) {
    showToast(error.message, 'error');
    return null;
  }
}

// ===== FILE UPLOAD & DOWNLOAD =====
const MAX_FILE_SIZE = 30 * 1024 * 1024;
const DOCUMENT_ACCEPT = '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.jpg,.jpeg,.png';

function formatFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Throws ApiError on failure so the caller can keep the form open.
async function uploadFile(file, { moduleId, stepType, purpose }, onProgress) {
  if (file.size > MAX_FILE_SIZE) throw new ApiError('Fayl hajmi 30 MB dan oshmasin.', 413);
  if (file.size === 0) throw new ApiError("Fayl bo‘sh.", 400);

  const started = await requestAPI('/files', 'POST', {
    action: 'init', module_id: moduleId, step_type: stepType, purpose, filename: file.name, size: file.size
  });
  for (let index = 0; index < started.total_chunks; index++) {
    const start = index * started.chunk_size;
    const buffer = await file.slice(start, start + started.chunk_size).arrayBuffer();
    await requestAPI('/files', 'POST', {
      action: 'chunk', id: started.id, index, data: bytesToBase64(new Uint8Array(buffer))
    });
    onProgress?.(Math.round(((index + 1) / started.total_chunks) * 100));
  }
  return requestAPI('/files', 'POST', { action: 'complete', id: started.id });
}

async function downloadFile(id, button) {
  if (!currentUser) {
    document.getElementById('stepModal').classList.remove('active');
    openAuthModal('login');
    showToast('Faylni yuklab olish uchun tizimga kiring.', 'warning');
    return;
  }
  const label = button?.querySelector('.file-card-meta');
  const originalLabel = label?.textContent;
  if (button) button.disabled = true;
  try {
    const meta = await requestAPI(`/files?id=${encodeURIComponent(id)}`);
    const parts = [];
    for (let chunk = 0; chunk < meta.total_chunks; chunk++) {
      const { data } = await requestAPI(`/files?id=${encodeURIComponent(id)}&chunk=${chunk}`);
      parts.push(base64ToBytes(data));
      if (label) label.textContent = `Yuklanmoqda ${Math.round(((chunk + 1) / meta.total_chunks) * 100)}%`;
    }
    // octet-stream keeps uploaded content from ever rendering on this origin.
    const url = URL.createObjectURL(new Blob(parts, { type: 'application/octet-stream' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = meta.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    if (button) button.disabled = false;
    if (label) label.textContent = originalLabel;
  }
}

function fileCardHtml(file) {
  if (!file?.id) return '';
  return `
    <button type="button" class="file-card" onclick="downloadFile('${escapeHTML(file.id)}', this)">
      <i data-lucide="download"></i>
      <span class="file-card-text">
        <span class="file-card-name">${escapeHTML(file.name)}</span>
        <span class="file-card-meta">${formatFileSize(file.size)} &middot; Yuklab olish</span>
      </span>
    </button>`;
}

function setUploadProgress(percent) {
  const bar = document.getElementById('uploadProgress');
  if (!bar) return;
  bar.hidden = false;
  bar.querySelector('.progress-bar-fill').style.width = `${percent}%`;
  bar.querySelector('.upload-progress-text').textContent = `Yuklanmoqda: ${percent}%`;
}

const UPLOAD_PROGRESS_HTML = `
  <div id="uploadProgress" class="upload-progress" hidden>
    <div class="progress-bar-track"><div class="progress-bar-fill" style="width:0%"></div></div>
    <span class="upload-progress-text" aria-live="polite"></span>
  </div>`;

async function runBusy(button, work) {
  if (button) button.disabled = true;
  try {
    return await work();
  } finally {
    if (button) button.disabled = false;
  }
}

const GUIDE_DATA = [
  { title: "Darsni rejalashtirish", desc: "Aniq o‘quv maqsadini belgilang, mazmun va mashqlarni shu maqsadga moslang." },
  { title: "Faol o‘rganish", desc: "Savol, bahs-munozara va amaliy mashqlar orqali o‘quvchini dars jarayoniga jalb qiling." },
  { title: "O‘quv natijalarini baholash", desc: "Baholash mezonlarini oldindan tushuntiring va natijaga konstruktiv fikr-mulohaza qo‘shing." },
  { title: "Refleksiya va o‘z-o‘zini rivojlantirish", desc: "Darsdan keyin nimalar samarali ishlaganini ko‘rib chiqing va keyingi mashg‘ulotni shunga qarab boyiting." }
];

const STEP_TYPES = [
  { id: 'diag', title: '1. Diagnostika testi', type: 'quiz', icon: 'help-circle' },
  { id: 'video', title: '2. Video dars', type: 'video', icon: 'play-circle' },
  { id: 'pres', title: '3. Taqdimot (Prezentatsiya)', type: 'doc', icon: 'presentation' },
  { id: 'doc', title: '4. Qo‘shimcha material', type: 'doc', icon: 'file-text' },
  { id: 'task', title: '5. Amaliy topshiriq', type: 'upload', icon: 'upload-cloud' },
  { id: 'refl', title: '6. Refleksiv hisobot', type: 'text', icon: 'feather' }
];

// ===== PUBLIC WEBSITE LOGIC =====
async function initPublicSite() {
  setupEventListeners();
  try { localStorage.removeItem('talimnazariyasi_local_store_v2'); } catch { /* storage unavailable */ }

  const [modules, session] = await Promise.all([
    fetchAPI('/modules'),
    fetchAPI('/auth')
  ]);

  if (modules && Array.isArray(modules)) modulesCache = modules;
  renderPublicModules();

  const newsContainer = document.getElementById('publicNewsList');
  if (newsContainer) {
    newsContainer.innerHTML = GUIDE_DATA.map(article => `
      <div class="info-card">
        <h3>${escapeHTML(article.title)}</h3>
        <p>${escapeHTML(article.desc)}</p>
      </div>
    `).join('');
  }

  refreshIcons();

  if (session?.user) {
    await startSession(session.user, true);
  }
}

function setupEventListeners() {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.getElementById('authModal')?.classList.remove('active');
      document.getElementById('stepModal')?.classList.remove('active');
      const sidebar = document.getElementById('sidebar');
      if (sidebar?.classList.contains('open')) toggleSidebar();
    }
  });
}

function renderPublicModules() {
  const modContainer = document.getElementById('publicModulesList');
  if (!modContainer) return;

  if (!modulesCache.length) {
    modContainer.innerHTML = '<div class="info-card"><p>Hozircha modullar qo‘shilmagan.</p></div>';
    refreshIcons();
    return;
  }

  modContainer.innerHTML = modulesCache.map(m => {
    let progBarHtml = '';
    const isStudent = currentUser && currentUser.role === 'student';

    if (isStudent) {
      const prog = progressCache[m.id] || { completed_steps: [] };
      const stepCount = (prog.completed_steps || []).length;
      const pct = Math.round((stepCount / 6) * 100);
      const isComplete = stepCount >= 6;

      progBarHtml = `
        <div style="margin-top:16px;">
          <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:500; color:var(--text-main);">
            <span>${isComplete ? '🎉 Tamomlandi' : `${stepCount}/6 qadam`}</span>
            <span>${pct}%</span>
          </div>
          <div class="progress-bar-track">
            <div class="progress-bar-fill ${isComplete ? 'complete' : ''}" style="width: ${pct}%"></div>
          </div>
        </div>
      `;
    }

    return `
      <div class="info-card" style="cursor:pointer;" onclick="openStudentModule(${Number(m.id)})">
        <div style="font-size:11px; text-transform:uppercase; letter-spacing:2px; color:var(--primary); margin-bottom:8px;">Modul ${m.order_num}</div>
        <h3>${escapeHTML(m.title)}</h3>
        <p>${escapeHTML(m.description || "Ta'lim nazariyasi moduli")}</p>
        ${progBarHtml}
        <button class="btn-outline" style="margin-top:20px; padding:8px 18px; font-size:11px;" onclick="event.stopPropagation(); openStudentModule(${Number(m.id)})">
          <i data-lucide="arrow-right"></i> Modulni o‘rganish &rarr;
        </button>
      </div>
    `;
  }).join('') + (!currentUser ? `
    <div class="info-card" style="display:flex; flex-direction:column; align-items:center; justify-content:center; cursor:pointer; background:rgba(168,155,140,0.06); border:2px dashed var(--primary);" onclick="openAuthModal('register')">
      <div style="margin-bottom:10px; color:var(--primary);"><i data-lucide="graduation-cap" style="width:36px;height:36px;"></i></div>
      <h3 style="color:var(--text-main)">Barcha modullarga kirish</h3>
      <p>Bepul ro‘yxatdan o‘tib, darslarni o‘zlashtirishni boshlang</p>
      <button class="btn-primary" style="margin-top:15px; padding:10px 20px;"><i data-lucide="sparkles"></i> Ro‘yxatdan o‘tish</button>
    </div>` : '');

  refreshIcons();
}

function openModule(id) {
  currentModuleId = Number(id);
  const target = modulesCache.find(x => Number(x.id) === currentModuleId);
  navigate('module-view', target ? target.title : `Modul ${id}`);
}

async function openStudentModule(id) {
  currentModuleId = Number(id);

  // Agar foydalanuvchi tizimga kirgan bo'lsa, bevosita shaxsiy kabinetga o'tadi
  if (currentUser) {
    document.getElementById('public-website').style.display = 'none';
    document.getElementById('screen-app').classList.add('active');
    openModule(id);
    return;
  }

  // Agar kirmagan bo'lsa ham public o'quv bo'limida modulni to'liq ochish
  showPublicSection('public-module-view');
  const container = document.getElementById('publicModuleViewContainer');
  container.innerHTML = '<div class="spinner"></div><div style="text-align:center; padding:10px; color:var(--text-muted)">Yuklanmoqda...</div>';
  await renderModuleView(container, true);
}

function showPublicSection(sectionId) {
  document.querySelectorAll('.public-section').forEach(s => s.classList.remove('active'));
  document.getElementById(sectionId)?.classList.add('active');
  document.getElementById('mainNav')?.classList.remove('open');
  const menuButton = document.querySelector('.mobile-menu-btn');
  menuButton?.setAttribute('aria-expanded', 'false');
  menuButton?.setAttribute('aria-label', 'Menyuni ochish');
  window.scrollTo(0, 0);
  refreshIcons();
}

// ===== AUTH MODAL LOGIC =====
function openAuthModal(type) {
  document.getElementById('authModal').classList.add('active');
  switchAuth(type);
  refreshIcons();
}

function closeAuthModal(e) {
  if (e.target.id === 'authModal') e.target.classList.remove('active');
}

function switchAuth(type) {
  document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
  document.getElementById('loginError').textContent = '';
  if (type === 'login') {
    document.getElementById('authTitle').textContent = 'Tizimga Kirish';
    document.getElementById('authSubtitle').textContent = "Platformadan foydalanish uchun o‘z rolingizni tanlang";
    document.getElementById('loginForm').classList.add('active');
  } else {
    document.getElementById('authTitle').textContent = "Ro‘yxatdan o‘tish";
    document.getElementById('authSubtitle').textContent = "Rolingizni tanlang va yangi hisob yarating";
    document.getElementById('registerForm').classList.add('active');
  }
  refreshIcons();
}

function selectRole(role, btn) {
  document.querySelectorAll('#loginForm .role-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

// ===== LOGIN & REGISTER HANDLING =====
async function handleLogin(e) {
  e.preventDefault();
  const roleTab = document.querySelector('#loginForm .role-tab.active');
  const role = roleTab ? roleTab.dataset.role : 'student';
  const login = document.getElementById('loginUser').value.trim();
  const pass = document.getElementById('loginPass').value;
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';

  const submitBtn = e.target.querySelector('button[type="submit"]');
  const oldText = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Kirilmoqda...';

  try {
    const user = await requestAPI('/auth', 'POST', { action: 'login', login, password: pass });
    if (user.role !== role) {
      await requestAPI('/auth', 'POST', { action: 'logout' });
      errEl.textContent = `Bu hisob "${ROLE_LABELS[user.role] || user.role}" roliga tegishli. Iltimos, to‘g‘ri rolni tanlang.`;
      return;
    }
    showToast(`Xush kelibsiz, ${user.name || user.login}!`);
    await startSession(user);
  } catch (err) {
    errEl.textContent = err.message || 'Kirishda xatolik yuz berdi.';
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = oldText;
    refreshIcons();
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const name = document.getElementById('regName').value.trim();
  const login = document.getElementById('regLogin').value.trim();
  const pass = document.getElementById('regPass').value;
  const role = document.querySelector('#registerForm .role-tab.active')?.dataset.role || 'student';
  const errEl = document.getElementById('registerError');
  errEl.textContent = '';

  const submitBtn = e.target.querySelector('button[type="submit"]');
  const oldText = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Ro‘yxatdan o‘tilmoqda...';

  try {
    const user = await requestAPI('/auth', 'POST', { action: 'register', login, password: pass, name, role });
    showToast("Ro‘yxatdan muvaffaqiyatli o‘tdingiz!");
    await startSession(user);
  } catch (err) {
    errEl.textContent = err.message || "Ro‘yxatdan o‘tishda xatolik yuz berdi.";
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = oldText;
    refreshIcons();
  }
}

async function startSession(user, modulesLoaded = false) {
  currentUser = user;

  if (!modulesLoaded) {
    const mods = await fetchAPI('/modules');
    if (mods && Array.isArray(mods)) modulesCache = mods;
  }

  // Only a student's own rows belong in this per-module cache.
  progressCache = {};
  if (currentUser.role === 'student') {
    const prog = await fetchAPI('/progress');
    (prog || []).forEach(p => {
      progressCache[p.module_id] = p;
    });
  }

  // Modallarni yopish va to'g'ridan-to'g'ri tizim shaxsiy kabinetiga o'tish (hech kim bosh sahifada qotib qolmaydi!)
  document.getElementById('authModal').classList.remove('active');
  document.getElementById('public-website').style.display = 'none';
  document.getElementById('screen-app').classList.add('active');

  // Navbar user holati
  document.getElementById('navAuth').style.display = 'none';
  document.getElementById('navUser').style.display = 'flex';

  const roleIcon = currentUser.role === 'student' ? 'user' : (currentUser.role === 'teacher' ? 'graduation-cap' : 'shield');
  const roleLabel = currentUser.role === 'student' ? 'TALABA' : (currentUser.role === 'teacher' ? 'O‘QITUVCHI' : 'ADMINISTRATOR');

  document.getElementById('navUserName').innerHTML = `<i data-lucide="${roleIcon}"></i> ${escapeHTML(currentUser.name || currentUser.login)}`;
  document.getElementById('sidebarUser').innerHTML = `<i data-lucide="user-check"></i> <span>${escapeHTML(currentUser.name || currentUser.login)}</span>`;
  document.getElementById('topbarUser').innerHTML = `<i data-lucide="${roleIcon}"></i> <span>${roleLabel}</span>`;

  buildSidebar();
  if (!restoreRoute()) navigate('home');
  refreshIcons();
}

async function logout() {
  await fetchAPI('/auth', 'POST', { action: 'logout' });
  currentUser = null;
  progressCache = {};
  history.replaceState(null, '', location.pathname);
  document.getElementById('screen-app').classList.remove('active');
  document.getElementById('public-website').style.display = 'block';

  document.getElementById('navAuth').style.display = 'flex';
  document.getElementById('navUser').style.display = 'none';

  document.getElementById('loginForm').reset();
  document.getElementById('registerForm').reset();
  document.getElementById('registerError').textContent = '';
  selectRegisterRole('student', document.querySelector('#registerForm .role-tab[data-role="student"]'));
  document.getElementById('loginError').textContent = '';

  renderPublicModules();
  showPublicSection('home');
  showToast("Tizimdan muvaffaqiyatli chiqildi.");
  refreshIcons();
}

function returnToWebsite() {
  document.getElementById('screen-app').classList.remove('active');
  document.getElementById('public-website').style.display = 'block';
  document.getElementById('navAuth').style.display = currentUser ? 'none' : 'flex';
  document.getElementById('navUser').style.display = currentUser ? 'flex' : 'none';
  if (currentUser) {
    const roleIcon = currentUser.role === 'student' ? 'user' : (currentUser.role === 'teacher' ? 'graduation-cap' : 'shield');
    document.getElementById('navUserName').innerHTML = `<i data-lucide="${roleIcon}"></i> ${escapeHTML(currentUser.name || currentUser.login)}`;
  }
  showPublicSection('home');
  refreshIcons();
}

// ===== PRIVATE SYSTEM NAVIGATION =====
const STAFF_ROLES = ['teacher', 'admin'];
const ROLE_LABELS = { student: 'Talaba', teacher: 'O‘qituvchi', admin: 'Administrator' };
const PAGE_ROLES = {
  analytics: STAFF_ROLES,
  submissions: STAFF_ROLES,
  'manage-modules': STAFF_ROLES,
  'student-detail': STAFF_ROLES,
  users: ['admin'],
  'user-profile': ['admin']
};
const STAFF_MENU = [
  { id: 'home', title: 'Bosh sahifa', icon: 'home' },
  { id: 'manage-modules', title: 'Modullarni boshqarish', short: 'Modullar', icon: 'edit-3' },
  { id: 'modules', title: 'Modullar ko‘rinishi', icon: 'book-open' },
  { id: 'analytics', title: 'Tahlil va Grafika', icon: 'bar-chart-3' },
  { id: 'submissions', title: 'Talaba javoblari', icon: 'clipboard-check' }
];
const NAV_MENU = {
  student: [
    { id: 'home', title: 'Bosh sahifa', icon: 'home' },
    { id: 'modules', title: 'Modullar', icon: 'book-open' }
  ],
  teacher: STAFF_MENU,
  admin: [...STAFF_MENU, { id: 'users', title: 'Foydalanuvchilar', short: 'Ro‘yxat', icon: 'users' }]
};

function pageTitle(pageId) {
  if (pageId === 'module-view') {
    return modulesCache.find(x => Number(x.id) === Number(currentModuleId))?.title || 'Modul';
  }
  if (pageId === 'student-detail') return 'Talaba ishlari';
  if (pageId === 'user-profile') return 'Profil';
  return (NAV_MENU[currentUser?.role] || []).find(item => item.id === pageId)?.title || 'Bosh sahifa';
}

// ===== SKELETON LOADER HELPER =====
function getSkeletonCards(count = 3) {
  let html = `<div class="dashboard-grid">`;
  for (let i = 0; i < count; i++) {
    html += `
      <div class="stat-card skeleton-card">
        <div class="skeleton-shimmer" style="width:54px; height:54px; flex-shrink:0;"></div>
        <div style="flex:1;">
          <div class="skeleton-shimmer" style="width:40%; height:26px; margin-bottom:8px;"></div>
          <div class="skeleton-shimmer" style="width:70%; height:13px;"></div>
        </div>
      </div>
    `;
  }
  html += `</div>
    <div class="card skeleton-card">
      <div class="skeleton-shimmer" style="width:35%; height:22px; margin-bottom:20px;"></div>
      <div class="skeleton-shimmer" style="width:100%; height:15px; margin-bottom:12px;"></div>
      <div class="skeleton-shimmer" style="width:85%; height:15px; margin-bottom:12px;"></div>
      <div class="skeleton-shimmer" style="width:60%; height:15px;"></div>
    </div>
  `;
  return html;
}

function buildSidebar() {
  const nav = document.getElementById('sidebarNav');
  const bottomNav = document.getElementById('mobileBottomNav');
  if (!nav) return;
  nav.innerHTML = '';
  if (bottomNav) bottomNav.innerHTML = '';

  (NAV_MENU[currentUser.role] || []).forEach(item => {
    // 1. Desktop sidebar item
    const div = document.createElement('button');
    div.type = 'button';
    div.className = 'nav-item';
    div.id = 'nav-' + item.id;
    div.innerHTML = `<i data-lucide="${item.icon}"></i> <span>${item.title}</span>`;
    div.onclick = () => {
      syncActiveNav(item.id);
      navigate(item.id, item.title);
      if (window.innerWidth <= 900) toggleSidebar();
    };
    nav.appendChild(div);

    // 2. Mobile Bottom Nav item (bir qo'lda qulay boshqarish)
    // Keeps the bar at five items; staff still reach this page from the sidebar.
    const inBottomNav = !(item.id === 'modules' && currentUser.role !== 'student');
    if (bottomNav && inBottomNav) {
      const bBtn = document.createElement('button');
      bBtn.className = 'bottom-nav-item';
      bBtn.id = 'bnav-' + item.id;
      bBtn.setAttribute('type', 'button');
      bBtn.setAttribute('aria-label', item.title);
      const shortTitle = item.short || item.title.split(' ')[0];
      bBtn.innerHTML = `<i data-lucide="${item.icon}"></i> <span>${shortTitle}</span>`;
      bBtn.onclick = () => {
        syncActiveNav(item.id);
        navigate(item.id, item.title);
      };
      bottomNav.appendChild(bBtn);
    }
  });
  refreshIcons();
}

function syncActiveNav(pageId) {
  const targetId = pageId === 'module-view' ? 'modules' : pageId;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.bottom-nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('nav-' + targetId)?.classList.add('active');
  document.getElementById('bnav-' + targetId)?.classList.add('active');
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (!sidebar) return;
  const isOpen = sidebar.classList.toggle('open');
  if (backdrop) {
    if (isOpen) backdrop.classList.add('active');
    else backdrop.classList.remove('active');
  }
}

function navigate(pageId, title) {
  const allowedRoles = PAGE_ROLES[pageId];
  if (allowedRoles && !allowedRoles.includes(currentUser?.role)) {
    pageId = 'home';
    title = undefined;
  }
  if (!title) title = pageTitle(pageId);
  document.getElementById('pageTitle').textContent = title;
  const container = document.getElementById('pageContainer');

  syncActiveNav(pageId);
  writeRoute(pageId);

  // Avvalgi faol grafiklarni tozalash (xotirada qolib ketmasligi uchun)
  activeCharts.forEach(c => { try { c.destroy(); } catch(e) {} });
  activeCharts = [];

  // Zamonaviy Shimmer Skeleton Loader
  container.innerHTML = getSkeletonCards();

  switch (pageId) {
    case 'home': renderHome(container); break;
    case 'modules': renderModules(container); break;
    case 'module-view': renderModuleView(container); break;
    case 'manage-modules': renderManageModules(container); break;
    case 'analytics': renderAnalytics(container); break;
    case 'submissions': renderSubmissions(container); break;
    case 'student-detail': renderStudentDetail(container); break;
    case 'users': renderUsers(container); break;
    case 'user-profile': renderUserProfile(container); break;
    default: container.innerHTML = '<div class="card">Sahifa topilmadi.</div>';
  }
  refreshIcons();
}

// ===== RENDER SYSTEM PAGES =====
function renderHome(container) {
  let html = `<div class="dashboard-grid">`;
  if (currentUser.role === 'student') {
    const completed = Object.values(progressCache).filter(p => (p.completed_steps || []).length >= 6).length;
    const totalScore = Object.values(progressCache).reduce((sum, p) => sum + (Number(p.total_score) || 0), 0);
    html += `
      <div class="stat-card">
        <div class="stat-icon"><i data-lucide="book-open"></i></div>
        <div class="stat-info"><h3>${modulesCache.length}</h3><p>Jami modullar</p></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><i data-lucide="check-circle-2"></i></div>
        <div class="stat-info"><h3>${completed}</h3><p>Tugatilgan modullar</p></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><i data-lucide="award"></i></div>
        <div class="stat-info"><h3>${totalScore} ball</h3><p>To‘plangan ballar</p></div>
      </div>
    `;
  } else {
    html += `
      <div class="stat-card">
        <div class="stat-icon"><i data-lucide="book-open"></i></div>
        <div class="stat-info"><h3>${modulesCache.length}</h3><p>Mavjud modullar</p></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><i data-lucide="graduation-cap"></i></div>
        <div class="stat-info"><h3>${currentUser.role === 'admin' ? 'Administrator' : 'O‘qituvchi'}</h3><p>Sizning maqomingiz</p></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><i data-lucide="bar-chart-2"></i></div>
        <div class="stat-info"><h3>Faol</h3><p>Didaktik monitoring</p></div>
      </div>
    `;
  }
  html += `</div>
  <div class="card">
    <h3 class="card-title">Xush kelibsiz, ${escapeHTML(currentUser.name || currentUser.login)}!</h3>
    <p style="color:var(--text-muted); line-height: 1.8;">
      Platformada zamonaviy ta'lim nazariyalari, 6 qadamli didaktik modullar hamda talabalar monitoringi va interaktiv vizualizatsiyasi jamlangan. 
      ${currentUser.role === 'student' ? "Chap menyudan 'Modullar' bo‘limiga o‘tib bilimlaringizni oshiring." : "Siz modullarni boshqarishingiz, materiallar kiritishingiz, 'Tahlil va Grafika' bo‘limida o‘quvchilar natijalarini tahlil qilishingiz mumkin."}
    </p>
  </div>`;
  container.innerHTML = html;
  refreshIcons();
}

async function renderModules(container) {
  if (!modulesCache.length) {
    container.innerHTML = '<div class="card"><p>Hozircha modullar mavjud emas.</p></div>';
    refreshIcons();
    return;
  }
  let html = `<div class="modules-grid">`;

  modulesCache.forEach(m => {
    const prog = progressCache[m.id] || { completed_steps: [] };
    const stepCount = (prog.completed_steps || []).length;
    const isDone = stepCount >= 6;
    const pct = Math.round((stepCount / 6) * 100);

    html += `
      <div class="module-card" onclick="openModule(${Number(m.id)})">
        <div class="mod-info" style="flex:1; padding-right:20px;">
          <div style="font-size:11px; text-transform:uppercase; letter-spacing:1px; color:var(--primary); margin-bottom:4px;">Modul ${m.order_num}</div>
          <h4>${escapeHTML(m.title)}</h4>
          <p>${escapeHTML(m.description || '')}</p>
          ${currentUser.role === 'student' ? `
            <div style="margin-top:12px; max-width:320px;">
              <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--text-muted); margin-bottom:4px;">
                <span>${stepCount}/6 qadam bajarildi</span>
                <span>${pct}%</span>
              </div>
              <div class="progress-bar-track" style="margin:0;">
                <div class="progress-bar-fill ${isDone ? 'complete' : ''}" style="width:${pct}%"></div>
              </div>
            </div>
          ` : `
            <p style="margin-top:8px; font-size:12px; color:var(--primary); font-weight:500;">Materiallar va bosqichlarni ko‘rish &rarr;</p>
          `}
        </div>
        <div class="mod-status ${isDone || currentUser.role !== 'student' ? 'done' : ''}">
          <i data-lucide="${isDone ? 'check-circle' : 'play-circle'}"></i>
        </div>
      </div>
    `;
  });
  html += `</div>`;
  container.innerHTML = html;
  refreshIcons();
}

// ===== ANALYTICS & CHARTS (GRAFIK VA VIZUALIZATSIYA) =====
async function renderAnalytics(container) {
  container.innerHTML = getSkeletonCards(4);

  const rows = await fetchAPI('/progress');
  if (!rows) {
    container.innerHTML = '<div class="card">Ma\'lumotlarni yuklab bo‘lmadi.</div>';
    return;
  }
  const allProgress = rows;
  const hasStepData = allProgress.some(p => (p.completed_steps || []).length > 0);
  const hasModuleData = allProgress.length > 0 && modulesCache.length > 0;

  // Modullar statistikasini jamlash
  const moduleLabels = modulesCache.map(m => `Modul ${m.order_num}`);
  const moduleCompletion = modulesCache.map(m => {
    const relevant = allProgress.filter(p => p.module_id === m.id);
    if (!relevant.length) return 0;
    const completedCount = relevant.filter(p => (p.completed_steps || []).length >= 6).length;
    return Math.round((completedCount / relevant.length) * 100);
  });

  // Step types tahlili
  const stepCounts = { diag: 0, video: 0, pres: 0, doc: 0, task: 0, refl: 0 };
  allProgress.forEach(p => {
    (p.completed_steps || []).forEach(st => {
      if (stepCounts[st] !== undefined) stepCounts[st]++;
    });
  });

  // Talabalar reytingi (Leaderboard)
  const studentMap = {};
  allProgress.forEach(p => {
    const uid = p.user_id;
    const name = p.student_name || p.student_login || `Talaba #${uid}`;
    if (!studentMap[uid]) {
      studentMap[uid] = { id: uid, name, completedSteps: 0, score: 0, finishedModules: 0 };
    }
    const steps = (p.completed_steps || []).length;
    studentMap[uid].completedSteps += steps;
    studentMap[uid].score += (p.total_score || 0);
    if (steps >= 6) studentMap[uid].finishedModules++;
  });

  const leaderboard = Object.values(studentMap).sort((a, b) => b.completedSteps - a.completedSteps || b.score - a.score);

  let html = `
    <div class="charts-grid">
      <!-- Chart 1: Modullar o‘zlashtirish darajasi -->
      <div class="chart-card">
        <div class="chart-header">
          <h4><i data-lucide="bar-chart-2"></i> Modullar bo‘yicha o‘zlashtirish (%)</h4>
          <p>To‘liq yakunlash koeffitsiyenti</p>
        </div>
        <div class="chart-wrapper">
          ${hasModuleData ? '<canvas id="chartModules"></canvas>' : '<p class="muted-text empty-text">Hozircha ma\'lumot yo‘q.</p>'}
        </div>
      </div>

      <!-- Chart 2: 6 qadam taqsimoti -->
      <div class="chart-card">
        <div class="chart-header">
          <h4><i data-lucide="pie-chart"></i> Qadamlar faolligi taqsimoti</h4>
          <p>Didaktik bosqichlar</p>
        </div>
        <div class="chart-wrapper">
          ${hasStepData ? '<canvas id="chartSteps"></canvas>' : '<p class="muted-text empty-text">Hozircha ma\'lumot yo‘q.</p>'}
        </div>
      </div>
    </div>

    <!-- Leaderboard / Reyting jadvali -->
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; border-bottom:1px solid var(--border-color); padding-bottom:12px;">
        <h3 class="card-title" style="margin:0; border:none; padding:0; display:flex; align-items:center; gap:8px;">
          <i data-lucide="trophy" style="color:#d4af37;"></i> Talabalar Reytingi va Liderlar Jadvali
        </h3>
        <span class="badge badge-primary">Didaktik monitoring</span>
      </div>
      <p style="color:var(--text-muted); font-size:13px; margin-bottom:20px;">
        Modullardagi 6 qadamli didaktik vazifalarni eng faol bajargan va eng yuqori natija ko‘rsatgan iqtidorli talabalar:
      </p>

      <div style="overflow-x:auto;">
        <table class="leaderboard-table">
          <thead>
            <tr>
              <th style="width:70px;">O‘rin</th>
              <th>Talaba F.I.Sh</th>
              <th>Bajarilgan qadamlar</th>
              <th>Tugatilgan modullar</th>
              <th>Toplangan ball</th>
              <th>Holat</th>
            </tr>
          </thead>
          <tbody>
  `;

  if (!leaderboard.length) {
    html += `<tr><td colspan="6" style="text-align:center; padding:20px; color:var(--text-muted)">Hozircha talabalar natijalari mavjud emas.</td></tr>`;
  } else {
    leaderboard.forEach((st, idx) => {
      const rank = idx + 1;
      let rankBadgeClass = 'rank-default';
      if (rank === 1) rankBadgeClass = 'rank-1';
      else if (rank === 2) rankBadgeClass = 'rank-2';
      else if (rank === 3) rankBadgeClass = 'rank-3';

      html += `
        <tr class="clickable-row" onclick="openStudentDetail(${Number(st.id)})" title="Bajargan ishlarini ko‘rish">
          <td data-label="O‘rin"><span class="rank-badge ${rankBadgeClass}">${rank}</span></td>
          <td data-label="Talaba"><button type="button" class="link-btn" onclick="event.stopPropagation(); openStudentDetail(${Number(st.id)})">${escapeHTML(st.name)}</button></td>
          <td data-label="Qadamlar"><i data-lucide="check" style="width:14px;color:var(--success);"></i> ${st.completedSteps} ta qadam</td>
          <td data-label="Modullar"><span class="badge ${st.finishedModules > 0 ? 'badge-success' : 'badge-muted'}">${st.finishedModules} ta modul</span></td>
          <td data-label="Ball"><strong>${st.score} XP</strong></td>
          <td data-label="Holat">
            ${st.finishedModules > 0 ? '<span class="badge badge-success"><i data-lucide="award"></i> A\'lochi</span>' : '<span class="badge badge-primary">Faol</span>'}
          </td>
        </tr>
      `;
    });
  }

  html += `
          </tbody>
        </table>
      </div>
    </div>
  `;

  container.innerHTML = html;
  refreshIcons();

  // Chart.js diagrammalarini ishga tushirish
  setTimeout(() => {
    const ctxModules = document.getElementById('chartModules')?.getContext('2d');
    if (ctxModules && window.Chart) {
      activeCharts.push(new Chart(ctxModules, {
        type: 'bar',
        data: {
          labels: moduleLabels,
          datasets: [{
            label: 'O‘zlashtirish darajasi (%)',
            data: moduleCompletion,
            backgroundColor: '#A89B8C',
            borderColor: '#8F8171',
            borderWidth: 1,
            borderRadius: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: motionAllowed() ? undefined : false,
          scales: {
            y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' } }
          },
          plugins: {
            legend: { display: false }
          }
        }
      }));
    }

    const ctxSteps = document.getElementById('chartSteps')?.getContext('2d');
    if (ctxSteps && window.Chart) {
      activeCharts.push(new Chart(ctxSteps, {
        type: 'doughnut',
        data: {
          labels: ['Diagnostika', 'Video dars', 'Taqdimot', 'Material', 'Topshiriq', 'Refleksiya'],
          datasets: [{
            data: [stepCounts.diag, stepCounts.video, stepCounts.pres, stepCounts.doc, stepCounts.task, stepCounts.refl],
            backgroundColor: ['#A89B8C', '#81987F', '#C9B99A', '#D4B896', '#7A7571', '#333130'],
            borderWidth: 2,
            borderColor: getComputedStyle(document.documentElement).getPropertyValue('--bg-alt').trim()
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: motionAllowed() ? undefined : false,
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } }
          }
        }
      }));
    }
  }, 50);
}

// ===== MODULE VIEW & STEP LOGIC =====
let currentStepContents = {};

async function renderModuleView(container, isPublic = false) {
  if (!modulesCache.length) {
    const mods = await fetchAPI('/modules');
    if (mods && Array.isArray(mods)) modulesCache = mods;
  }

  let m = modulesCache.find(x => Number(x.id) === Number(currentModuleId));
  if (!m && modulesCache.length > 0) {
    m = modulesCache[0];
    currentModuleId = Number(m.id);
  }

  if (!m) {
    container.innerHTML = '<div class="card"><p style="color:var(--text-muted)">Modul topilmadi yoki hali qo‘shilmagan.</p></div>';
    refreshIcons();
    return;
  }

  const prog = progressCache[m.id] || { completed_steps: [] };
  const completed = prog.completed_steps || [];
  const isAllDone = completed.length >= 6;

  const contentRows = await fetchAPI(`/content?module_id=${m.id}`);
  currentStepContents = {};
  if (contentRows && Array.isArray(contentRows)) {
    contentRows.forEach(c => {
      currentStepContents[c.step_type] = c.content || {};
    });
  }

  let html = `
    <div class="back-btn" onclick="${isPublic ? `showPublicSection('public-modules')` : `navigate('modules', 'Modullar')`}">
      <i data-lucide="arrow-left"></i> Modullar ro‘yxatiga qaytish
    </div>
  `;

  if (isAllDone && currentUser && currentUser.role === 'student') {
    html += `
      <div class="celebration-box">
        <div style="margin-bottom:8px; color:var(--primary);"><i data-lucide="award" style="width:48px;height:48px;"></i></div>
        <h3>Tabriklaymiz! Siz ushbu modulni muvaffaqiyatli tamomladingiz!</h3>
        <p style="color:var(--text-muted); font-size:13px;">Barcha 6 ta didaktik qadam to‘liq yakunlandi va tizimda qayd etildi.</p>
      </div>
    `;
  }

  html += `
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:15px; margin-bottom:15px; border-bottom:1px solid var(--border-color); padding-bottom:15px;">
        <div>
          <span class="badge badge-primary">Modul ${m.order_num}</span>
          <h2 style="font-family:var(--font-heading); font-size:28px; font-weight:400; margin-top:8px;">${escapeHTML(m.title)}</h2>
        </div>
        ${currentUser && currentUser.role === 'student' ? `
          <div style="text-align:right;">
            <span class="badge ${isAllDone ? 'badge-success' : 'badge-primary'}">${completed.length}/6 qadam bajarildi</span>
          </div>
        ` : ''}
      </div>
      <p style="color:var(--text-muted); margin-bottom: 25px; line-height:1.8;">${escapeHTML(m.description || '')}</p>
      
      <div class="steps-list">
  `;

  STEP_TYPES.forEach((step, idx) => {
    const isCompleted = currentUser && currentUser.role !== 'student' ? true : completed.includes(step.id);
    const isLocked = currentUser && currentUser.role === 'student' && idx > 0 && !completed.includes(STEP_TYPES[idx - 1].id);
    const hasContent = !!(currentStepContents[step.id]?.value || currentStepContents[step.id]?.file?.id);

    html += `
      <div class="step-item ${isCompleted ? 'completed' : ''} ${isLocked ? 'disabled' : ''}" 
           onclick="${isLocked ? '' : `openStep(${idx}, ${isPublic})`}"
           title="${isLocked ? 'Oldingi qadamni yakunlang' : ''}">
        <div class="step-info">
          <span class="step-icon">
            <i data-lucide="${isLocked ? 'lock' : step.icon}"></i>
          </span>
          <div>
            <div style="font-weight:500; color:var(--text-main);">${step.title}</div>
            <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">
              ${isLocked ? 'Avvalgi qadamni yakunlash talab etiladi' : (hasContent ? 'O‘rganish uchun tayyor' : 'Material hali qo‘shilmagan')}
            </div>
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          ${isCompleted ? '<span class="badge badge-success"><i data-lucide="check"></i> Bajarildi</span>' : (isLocked ? '<span class="badge badge-muted"><i data-lucide="lock"></i> Qulflangan</span>' : '<span class="badge badge-primary">Boshlash &rarr;</span>')}
        </div>
      </div>
    `;
  });

  html += `</div></div>`;
  container.innerHTML = html;
  refreshIcons();
}

// ===== TEACHER MANAGEMENT =====
let editModuleId = null;

async function renderManageModules(container) {
  const formTitle = editModuleId ? "Modulni tahrirlash" : "Yangi modul qo‘shish";
  let mOrder = modulesCache.length + 1;
  let mTitle = "";
  let mDesc = "";

  if (editModuleId) {
    const em = modulesCache.find(x => x.id === editModuleId);
    if (em) {
      mOrder = em.order_num;
      mTitle = em.title;
      mDesc = em.description || '';
    }
  }

  let html = `
    <div class="card">
      <h3 class="card-title"><i data-lucide="edit"></i> ${formTitle}</h3>
      <div style="display:grid; grid-template-columns: 120px 1fr; gap:20px;">
        <div class="form-group">
          <label>Tartib №</label>
          <input type="number" id="newModOrder" value="${mOrder}" min="1"/>
        </div>
        <div class="form-group">
          <label>Modul nomi</label>
          <input type="text" id="newModTitle" placeholder="Masalan: Ta'lim tamoyillari" value="${escapeHTML(mTitle)}"/>
        </div>
      </div>
      <div class="form-group">
        <label>Modul haqida qisqacha ta'rif</label>
        <input type="text" id="newModDesc" placeholder="Modul nimalarni o‘rgatadi..." value="${escapeHTML(mDesc)}" />
      </div>
      <div style="display:flex; gap:10px; margin-top:10px;">
        <button class="btn-primary" onclick="addModule()">
          <i data-lucide="save"></i> ${editModuleId ? "O‘zgarishlarni saqlash" : "Modulni yaratish"}
        </button>
        ${editModuleId ? `<button class="btn-outline" onclick="editModuleId=null; renderManageModules(document.getElementById('pageContainer'))"><i data-lucide="x"></i> Bekor qilish</button>` : ''}
      </div>
    </div>
    
    <div class="card">
      <h3 class="card-title"><i data-lucide="layers"></i> Mavjud modullar va didaktik materiallar</h3>
  `;

  if (!modulesCache.length) {
    html += `<p style="color:var(--text-muted)">Hozircha hech qanday modul yo‘q. Yuqoridagi shakl orqali modul qo‘shing.</p>`;
  } else {
    modulesCache.forEach(m => {
      html += `
        <div style="border:1px solid var(--border-color); padding: 20px; margin-bottom: 15px; background:var(--bg-alt);">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:10px;">
            <div>
              <span class="badge badge-primary">№ ${m.order_num}</span>
              <strong style="font-size:16px; margin-left:8px;">${escapeHTML(m.title)}</strong>
              <p style="color:var(--text-muted); font-size:12px; margin-top:4px;">${escapeHTML(m.description || '')}</p>
            </div>
            <div style="display:flex; gap:8px;">
              <button class="btn-outline" style="padding:6px 12px; font-size:11px;" onclick="editModuleId=${m.id}; renderManageModules(document.getElementById('pageContainer'))">
                <i data-lucide="edit-2"></i> Tahrirlash
              </button>
              <button class="btn-danger" onclick="deleteModule(${m.id})">
                <i data-lucide="trash-2"></i> O‘chirish
              </button>
            </div>
          </div>
          
          <div style="margin-top: 15px; padding-top:15px; border-top:1px dashed var(--border-color);">
            <div style="font-size:11px; text-transform:uppercase; letter-spacing:1px; color:var(--text-muted); margin-bottom:8px;">6 ta qadam materiallarini biriktirish:</div>
            <div style="display:flex; gap: 8px; flex-wrap:wrap">
              <button class="btn-outline" style="padding:6px 10px; font-size:11px" onclick="openContentModal(${m.id}, 'diag')"><i data-lucide="help-circle"></i> Test savoli</button>
              <button class="btn-outline" style="padding:6px 10px; font-size:11px" onclick="openContentModal(${m.id}, 'video')"><i data-lucide="play-circle"></i> Video (URL)</button>
              <button class="btn-outline" style="padding:6px 10px; font-size:11px" onclick="openContentModal(${m.id}, 'pres')"><i data-lucide="presentation"></i> Taqdimot</button>
              <button class="btn-outline" style="padding:6px 10px; font-size:11px" onclick="openContentModal(${m.id}, 'doc')"><i data-lucide="file-text"></i> Qo‘shimcha matn</button>
              <button class="btn-outline" style="padding:6px 10px; font-size:11px" onclick="openContentModal(${m.id}, 'task')"><i data-lucide="upload-cloud"></i> Topshiriq</button>
              <button class="btn-outline" style="padding:6px 10px; font-size:11px" onclick="openContentModal(${m.id}, 'refl')"><i data-lucide="feather"></i> Refleksiya</button>
            </div>
          </div>
        </div>
      `;
    });
  }
  html += `</div><div id="deletedModules"></div>`;
  container.innerHTML = html;
  refreshIcons();
  loadDeletedModules();
}

async function loadDeletedModules() {
  const target = document.getElementById('deletedModules');
  if (!target) return;
  const rows = await fetchAPI('/modules?deleted=1');
  if (!rows?.length || !document.getElementById('deletedModules')) return;
  target.innerHTML = `
    <div class="card">
      <h3 class="card-title"><i data-lucide="archive"></i> O‘chirilgan modullar</h3>
      <ul class="plain-list">
        ${rows.map(m => `
          <li class="deleted-module">
            <span>№ ${Number(m.order_num)}. ${escapeHTML(m.title)}</span>
            <button type="button" class="btn-outline" onclick="restoreModule(${Number(m.id)})"><i data-lucide="rotate-ccw"></i> Tiklash</button>
          </li>`).join('')}
      </ul>
    </div>`;
  refreshIcons();
}

async function restoreModule(id) {
  const res = await fetchAPI('/modules', 'POST', { action: 'restore', id });
  if (!res) return;
  showToast('Modul tiklandi ✅');
  const mods = await fetchAPI('/modules');
  if (mods && Array.isArray(mods)) modulesCache = mods;
  navigate('manage-modules');
}

async function addModule() {
  const order_num = document.getElementById('newModOrder').value;
  const title = document.getElementById('newModTitle').value.trim();
  const description = document.getElementById('newModDesc').value.trim();

  if (!title || !order_num) return showToast("Iltimos, tartib raqami va modul nomini to‘ldiring!");

  const payload = { order_num: Number(order_num), title, description };
  if (editModuleId) payload.id = editModuleId;

  const res = await fetchAPI('/modules', 'POST', payload);
  if (res) {
    showToast(editModuleId ? "Modul muvaffaqiyatli yangilandi!" : "Yangi modul yaratildi!");
    editModuleId = null;
    const mods = await fetchAPI('/modules');
    if (mods && Array.isArray(mods)) modulesCache = mods;
    navigate('manage-modules', 'Modullarni boshqarish');
  }
}

async function deleteModule(id) {
  const m = modulesCache.find(x => Number(x.id) === Number(id));
  const title = m ? m.title : `Modul ${id}`;
  if (!confirm(`Haqiqatan ham "${title}" modulini o‘chirmoqchimisiz?\nModul talabalarga ko‘rinmay qoladi, keyin uni tiklash mumkin.`)) {
    return;
  }
  const res = await fetchAPI(`/modules?id=${id}`, 'DELETE');
  if (res) {
    showToast("Modul o‘chirildi.");
    const mods = await fetchAPI('/modules');
    if (mods && Array.isArray(mods)) modulesCache = mods;
    navigate('manage-modules', 'Modullarni boshqarish');
  }
}

let teacherUploadContext = {};
const FILE_STEP_ACCEPT = { pres: '.pptx', doc: DOCUMENT_ACCEPT, task: DOCUMENT_ACCEPT };
const FILE_STEP_HINT = {
  pres: 'Faqat PowerPoint (.pptx), 30 MB gacha.',
  doc: 'PDF, Word, Excel, PowerPoint, matn yoki rasm, 30 MB gacha.',
  task: 'Ixtiyoriy: topshiriqqa ilova. PDF, Word, Excel, PowerPoint, matn yoki rasm, 30 MB gacha.'
};

function teacherFileFieldHtml(stepType, existingFile) {
  return `
    <div class="form-group">
      <label for="teacherUploadFile">${stepType === 'pres' ? 'Taqdimot fayli (.pptx)' : 'Fayl'}</label>
      ${existingFile ? `
        <div class="current-file" id="currentFileRow">
          ${fileCardHtml(existingFile)}
          ${stepType === 'task' ? `<button type="button" class="btn-danger" onclick="removeTeacherFile()"><i data-lucide="trash-2"></i> Olib tashlash</button>` : ''}
        </div>` : ''}
      <input type="file" id="teacherUploadFile" class="file-input" accept="${FILE_STEP_ACCEPT[stepType]}" aria-describedby="teacherFileHint"/>
      <small id="teacherFileHint" class="field-hint">${FILE_STEP_HINT[stepType]}${existingFile ? ' Yangi fayl tanlasangiz, eskisi almashtiriladi.' : ''}</small>
      ${UPLOAD_PROGRESS_HTML}
    </div>`;
}

function removeTeacherFile() {
  teacherUploadContext.existingFile = null;
  document.getElementById('currentFileRow')?.remove();
}

async function openContentModal(moduleId, stepType) {
  teacherUploadContext = { moduleId, stepType, existingFile: null };
  const stepMeta = STEP_TYPES.find(s => s.id === stepType) || { title: 'Material biriktirish' };
  document.getElementById('modalTitle').textContent = `${stepMeta.title} — Material biriktirish`;

  const body = document.getElementById('modalBody');
  const footer = document.getElementById('modalFooter');
  body.innerHTML = '<div class="spinner"></div>';
  footer.innerHTML = '';
  document.getElementById('stepModal').classList.add('active');

  const rows = await fetchAPI(`/content?module_id=${moduleId}`);
  if (!rows) {
    document.getElementById('stepModal').classList.remove('active');
    return;
  }
  const existing = rows.find(r => r.step_type === stepType)?.content || {};
  teacherUploadContext.existingFile = existing.file || null;
  const existingVal = existing.value || '';
  const existingAns = existing.answer || '';

  if (stepType === 'video') {
    body.innerHTML = `
      <div class="form-group">
        <label for="teacherUploadVal">YouTube video havolasi (URL)</label>
        <input type="url" id="teacherUploadVal" placeholder="https://www.youtube.com/watch?v=..." value="${escapeHTML(existingVal)}"/>
        <small class="field-hint">Masalan: https://youtube.com/watch?v=... yoki https://youtu.be/...</small>
      </div>
    `;
  } else if (stepType === 'diag') {
    body.innerHTML = `
      <div class="form-group">
        <label for="teacherUploadVal">Diagnostika savoli</label>
        <textarea id="teacherUploadVal" rows="3" placeholder="Savol matnini kiriting...">${escapeHTML(existingVal)}</textarea>
      </div>
      <div class="form-group">
        <label for="teacherUploadVal2">To‘g‘ri javob (O‘quvchi tekshiruvi uchun)</label>
        <input type="text" id="teacherUploadVal2" placeholder="To‘g‘ri javob so‘zi yoki jumlasi..." value="${escapeHTML(existingAns)}"/>
        <small class="field-hint">Eslatma: Talaba javobi tekshirilganda katta-kichik harflar farqlanmaydi.</small>
      </div>
    `;
  } else if (stepType === 'pres' || stepType === 'doc') {
    body.innerHTML = `
      ${teacherFileFieldHtml(stepType, teacherUploadContext.existingFile)}
      <div class="form-group">
        <label for="teacherUploadVal">Qisqacha izoh (ixtiyoriy)</label>
        <textarea id="teacherUploadVal" rows="3" maxlength="30000" placeholder="Fayl haqida talabalarga izoh...">${escapeHTML(existingVal)}</textarea>
      </div>
    `;
  } else {
    const placeholder = stepType === 'task'
      ? 'Talaba bajarishi kerak bo‘lgan amaliy topshiriq matni...'
      : 'Refleksiya uchun yo‘naltiruvchi savollar...';
    body.innerHTML = `
      <div class="form-group">
        <label for="teacherUploadVal">Ko‘rsatma matni</label>
        <textarea id="teacherUploadVal" rows="6" placeholder="${placeholder}">${escapeHTML(existingVal)}</textarea>
      </div>
      ${stepType === 'task' ? teacherFileFieldHtml('task', teacherUploadContext.existingFile) : ''}
    `;
  }

  footer.innerHTML = `
    <button class="btn-outline" onclick="document.getElementById('stepModal').classList.remove('active')"><i data-lucide="x"></i> Bekor qilish</button>
    <button class="btn-primary" id="teacherSaveBtn" onclick="saveTeacherContent()"><i data-lucide="save"></i> Saqlash</button>
  `;
  refreshIcons();
}

async function saveTeacherContent() {
  const { moduleId, stepType, existingFile } = teacherUploadContext;
  const val = document.getElementById('teacherUploadVal')?.value.trim() || '';
  const picked = document.getElementById('teacherUploadFile')?.files?.[0] || null;
  const usesFileAsMaterial = stepType === 'pres' || stepType === 'doc';

  if (usesFileAsMaterial && !picked && !existingFile) return showToast('Iltimos, faylni tanlang.', 'warning');
  if (!usesFileAsMaterial && !val) return showToast('Iltimos, material matnini kiriting.', 'warning');

  const content = { value: val };
  if (stepType === 'diag') {
    content.answer = document.getElementById('teacherUploadVal2')?.value.trim() || '';
    if (!content.answer) return showToast('Testning to‘g‘ri javobini kiriting.', 'warning');
  }
  if (stepType === 'video' && !getYouTubeEmbedUrl(val)) {
    return showToast('Noto‘g‘ri YouTube havolasi! Iltimos, to‘g‘ri YouTube URL kiriting.', 'error');
  }

  await runBusy(document.getElementById('teacherSaveBtn'), async () => {
    try {
      if (['pres', 'doc', 'task'].includes(stepType)) {
        const file = picked
          ? await uploadFile(picked, { moduleId, stepType, purpose: 'content' }, setUploadProgress)
          : existingFile;
        content.file_id = file ? file.id : null;
      }
      await requestAPI('/content', 'POST', { module_id: moduleId, step_type: stepType, content });
      showToast("Material muvaffaqiyatli saqlandi! ✅");
      document.getElementById('stepModal').classList.remove('active');
    } catch (error) {
      showToast(error.message, 'error');
    }
  });
}

// ===== SUBMISSIONS VIEW (FOR TEACHER / ADMIN) =====
function renderSubmissions(container) {
  if (!modulesCache.length) {
    container.innerHTML = '<div class="card">Javoblarni ko‘rish uchun avval modullar qo‘shing.</div>';
    refreshIcons();
    return;
  }

  const options = modulesCache.map((module) =>
    `<option value="${Number(module.id)}">${module.order_num}. ${escapeHTML(module.title)}</option>`
  ).join('');

  container.innerHTML = `
    <div class="card">
      <h3 class="card-title"><i data-lucide="clipboard-check"></i> Talaba javoblari va monitoring</h3>
      <div class="form-group">
        <label for="submissionModule">Modulni tanlang</label>
        <select id="submissionModule" onchange="loadSubmissions()">${options}</select>
      </div>
    </div>
    <div id="submissionList" aria-live="polite"></div>
  `;
  loadSubmissions();
  refreshIcons();
}

async function loadSubmissions() {
  const moduleId = document.getElementById('submissionModule')?.value;
  const list = document.getElementById('submissionList');
  if (!moduleId || !list) return;

  list.innerHTML = '<div class="spinner"></div>';
  const rows = await fetchAPI(`/progress?module_id=${encodeURIComponent(moduleId)}`);
  if (!rows) {
    list.innerHTML = '<div class="card">Ma\'lumotlarni yuklab bo‘lmadi.</div>';
    return;
  }

  const responseLabels = {
    task: '5. Amaliy topshiriq',
    refl: '6. Refleksiv hisobot'
  };

  const submissions = [];
  rows.forEach(row => {
    const responses = row.step_responses || {};
    Object.keys(responseLabels).forEach(step => {
      const response = typeof responses[step] === 'string' ? responses[step] : '';
      const file = step === 'task' ? responses.task_file : null;
      if (response || file?.id) submissions.push({ row, step, response, file });
    });
  });

  if (!submissions.length) {
    list.innerHTML = '<div class="card"><p style="color:var(--text-muted)">Ushbu modul bo‘yicha topshirilgan yozma topshiriqlar hozircha yo‘q.</p></div>';
    refreshIcons();
    return;
  }

  list.innerHTML = submissions.map(({ row, step, response, file }) => {
    const reviews = row.step_responses?.reviews || {};
    const existingReview = reviews[step]?.feedback || '';

    return `
      <article class="card submission-card" style="margin-bottom:20px;">
        <div class="submission-heading">
          <div>
            <h3 style="font-size:18px;">${escapeHTML(row.student_name || row.student_login || 'Talaba')}</h3>
            <p>${escapeHTML(row.module_title || '')} &middot; <span class="badge badge-primary">${responseLabels[step]}</span></p>
          </div>
          <time>${escapeHTML(row.updated_at ? new Date(row.updated_at).toLocaleString('uz-UZ') : '')}</time>
        </div>
        <div class="submission-response">
          <strong>Talaba javobi:</strong>
          ${response ? `<p style="margin-top:6px; font-style:italic;">${escapeHTML(response)}</p>` : ''}
          ${fileCardHtml(file)}
        </div>

        <div class="teacher-review-box">
          <h5><i data-lucide="message-square"></i> O‘qituvchi fikri va bahosi</h5>
          ${existingReview ? `
            <p><strong>Tekshirildi:</strong> ${escapeHTML(existingReview)}</p>
          ` : ''}
          <div style="display:flex; gap:10px; margin-top:8px;">
            <input type="text" id="review_input_${row.id}_${step}" aria-label="Fikr-mulohaza" placeholder="Fikr-mulohaza yoki baho yozing..." value="${escapeHTML(existingReview)}" class="review-input"/>
            <button class="btn-primary" style="padding:8px 16px; font-size:11px;" onclick="saveSubmissionReview(${row.id}, '${step}')">
              <i data-lucide="check"></i> Baholash
            </button>
          </div>
        </div>
      </article>
    `;
  }).join('');
  refreshIcons();
}

async function saveSubmissionReview(progressId, step) {
  const input = document.getElementById(`review_input_${progressId}_${step}`);
  const feedback = input ? input.value.trim() : '';
  if (!feedback) return showToast('Iltimos, fikr-mulohazani kiriting.');

  const res = await fetchAPI('/progress', 'POST', {
    action: 'review',
    progress_id: progressId,
    step,
    feedback
  });

  if (res) {
    showToast('Fikr-mulohaza saqlandi! ✅');
    loadSubmissions();
  }
}

// ===== STEP MODAL LOGIC (STUDENT VIEW) =====
let currentStepId = null;
const NO_MATERIAL_HTML = '<p class="muted-text">O‘qituvchi bu qadam uchun hali material qo‘shmagan.</p>';
const CLOSE_STEP_BUTTON = `<button class="btn-outline" onclick="document.getElementById('stepModal').classList.remove('active')"><i data-lucide="x"></i> Yopish</button>`;

function openStep(stepIndex, isPublic = false) {
  const step = STEP_TYPES[stepIndex];
  if (!step) return;
  const { id, type, title } = step;
  currentStepId = id;
  document.getElementById('modalTitle').textContent = title;

  const body = document.getElementById('modalBody');
  const footer = document.getElementById('modalFooter');

  const prog = progressCache[currentModuleId] || { completed_steps: [] };
  const isDone = (prog.completed_steps || []).includes(id);
  const responses = prog.step_responses || {};
  const myResponse = responses[id] || '';
  const myFile = id === 'task' ? responses.task_file : null;
  const myReview = responses.reviews ? responses.reviews[id] : null;
  const customContent = currentStepContents[id] || {};
  const hasMaterial = Boolean(customContent.value || customContent.file?.id);
  const noteHtml = customContent.value ? `<div class="step-text">${escapeHTML(customContent.value)}</div>` : '';

  if (type === 'quiz') {
    body.innerHTML = hasMaterial ? `
      <div class="quiz-question">${escapeHTML(customContent.value)}</div>
      <label for="stepAnswer" class="step-label">Javobingiz</label>
      <input id="stepAnswer" class="step-input" type="text" maxlength="500" placeholder="Javobni shu yerga yozing..." autocomplete="off"/>
    ` : NO_MATERIAL_HTML;
    footer.innerHTML = hasMaterial ? `<button class="btn-primary" onclick="completeStep(${isPublic}, this)"><i data-lucide="check"></i> Javobni yuborish</button>` : CLOSE_STEP_BUTTON;
  } else if (type === 'video') {
    const embed = customContent.value ? getYouTubeEmbedUrl(customContent.value) : null;
    body.innerHTML = embed
      ? `
        <div class="video-container" style="position:relative; padding-bottom:56.25%; height:0; overflow:hidden; background:#000;">
          <iframe title="Video dars" loading="lazy" style="position:absolute; top:0; left:0; width:100%; height:100%; border:0;" src="${embed}" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
        </div>
        <p class="muted-text" style="margin-top:20px;">Videodarsni to‘liq ko‘rib bo‘lgach, quyidagi tugmani bosib qadamni yakunlang.</p>
      `
      : NO_MATERIAL_HTML;
    footer.innerHTML = embed ? `<button class="btn-success" onclick="completeStep(${isPublic}, this)"><i data-lucide="check-circle-2"></i> Ko‘rib bo‘ldim ✅</button>` : CLOSE_STEP_BUTTON;
  } else if (type === 'doc') {
    body.innerHTML = hasMaterial ? `${fileCardHtml(customContent.file)}${noteHtml}` : NO_MATERIAL_HTML;
    footer.innerHTML = hasMaterial ? `<button class="btn-success" onclick="completeStep(${isPublic}, this)"><i data-lucide="check-circle-2"></i> O‘qib chiqdim ✅</button>` : CLOSE_STEP_BUTTON;
  } else if (type === 'upload') {
    body.innerHTML = `
      <div class="step-text">${escapeHTML(customContent.value || 'Amaliy topshiriqni bajaring va javobingizni yozing yoki fayl sifatida yuklang.')}</div>
      ${fileCardHtml(customContent.file)}
      ${isDone ? '' : `
        <label for="stepResponse" class="step-label">Sizning yechimingiz</label>
        <textarea id="stepResponse" class="step-input" rows="6" maxlength="10000" placeholder="Javobni bu yerga yozing...">${escapeHTML(myResponse)}</textarea>
        <label for="stepFile" class="step-label" style="margin-top:16px;">Yoki fayl biriktiring</label>
        <input type="file" id="stepFile" class="file-input" accept="${DOCUMENT_ACCEPT}" aria-describedby="stepFileHint"/>
        <small id="stepFileHint" class="field-hint">PDF, Word, Excel, PowerPoint, matn yoki rasm, 30 MB gacha.</small>
        ${UPLOAD_PROGRESS_HTML}
      `}
    `;
    footer.innerHTML = `<button class="btn-primary" onclick="completeStep(${isPublic}, this)"><i data-lucide="send"></i> Topshirish</button>`;
  } else if (type === 'text') {
    body.innerHTML = `
      <div class="step-text">${escapeHTML(customContent.value || 'Ushbu modul davomida nimalarni o‘rgandingiz va ularni qanday qo‘llashni rejalashtirdingiz?')}</div>
      <label for="stepResponse" class="step-label">Refleksiya hisoboti</label>
      <textarea id="stepResponse" class="step-input" rows="6" maxlength="10000" placeholder="Refleksiyangizni bu yerga yozing...">${escapeHTML(myResponse)}</textarea>
    `;
    footer.innerHTML = `<button class="btn-primary" onclick="completeStep(${isPublic}, this)"><i data-lucide="send"></i> Hisobotni yuborish</button>`;
  }

  if (!currentUser) {
    footer.innerHTML = `<button class="btn-primary" onclick="document.getElementById('stepModal').classList.remove('active'); openAuthModal('login')"><i data-lucide="log-in"></i> Davom etish uchun kiring</button>`;
  } else if (isDone && currentUser.role === 'student') {
    if (myResponse || myFile) {
      const isDiag = id === 'diag';
      const diagBadge = isDiag ? (responses.diag_correct ? '<span class="badge badge-success" style="margin-left:8px;">To‘g‘ri (+15 ball)</span>' : '<span class="badge badge-muted" style="margin-left:8px;">Qabul qilindi (0 ball)</span>') : '';
      body.innerHTML += `
        <div class="submitted-box">
          <strong class="step-label">Siz topshirgan javob: ${diagBadge}</strong>
          ${myResponse ? `<div style="font-size:14px; white-space:pre-wrap;">${escapeHTML(myResponse)}</div>` : ''}
          ${fileCardHtml(myFile)}
        </div>
        ${reviewBoxHtml(myReview)}
      `;
    }
    footer.innerHTML = `<button class="btn-outline" onclick="document.getElementById('stepModal').classList.remove('active')"><i data-lucide="check"></i> Siz bu qadamni bajargansiz &middot; Yopish</button>`;
  } else if (currentUser.role !== 'student') {
    footer.innerHTML = CLOSE_STEP_BUTTON;
  }

  document.getElementById('stepModal').classList.add('active');
  refreshIcons();
}

function reviewBoxHtml(review) {
  if (!review?.feedback) return '';
  return `
    <div class="teacher-review-box">
      <h5><i data-lucide="message-square"></i> O‘qituvchi xulosasi (${escapeHTML(review.teacher_name || 'Ustoz')}):</h5>
      <p>${escapeHTML(review.feedback)}</p>
    </div>`;
}

async function completeStep(isPublic = false, button = null) {
  if (!currentUser) return openAuthModal('login');

  let response = '';
  if (currentStepId === 'diag') {
    response = document.getElementById('stepAnswer')?.value.trim() || '';
    if (!response) return showToast('Iltimos, javobni kiriting.', 'warning');
  }
  if (['task', 'refl'].includes(currentStepId)) {
    response = document.getElementById('stepResponse')?.value.trim() || '';
  }
  const picked = currentStepId === 'task' ? document.getElementById('stepFile')?.files?.[0] || null : null;
  if (currentStepId === 'refl' && !response) return showToast('Iltimos, javob matnini kiriting.', 'warning');
  if (currentStepId === 'task' && !response && !picked) return showToast('Iltimos, javob yozing yoki fayl biriktiring.', 'warning');

  await runBusy(button, async () => {
    try {
      const payload = { module_id: currentModuleId, step_type: currentStepId, response };
      if (picked) {
        const file = await uploadFile(picked, { moduleId: currentModuleId, stepType: 'task', purpose: 'submission' }, setUploadProgress);
        payload.file_id = file.id;
      }
      const res = await requestAPI('/progress', 'POST', payload);
      progressCache[currentModuleId] = res;
      if (currentStepId === 'diag') {
        showToast(res.step_responses?.diag_correct ? 'To‘g‘ri javob! +15 ball ✅' : 'Javobingiz qabul qilindi (0 ball).', res.step_responses?.diag_correct ? 'success' : 'info');
      } else {
        showToast('Qadam muvaffaqiyatli bajarildi! ✅');
      }
      document.getElementById('stepModal').classList.remove('active');
      renderModuleView(document.getElementById(isPublic ? 'publicModuleViewContainer' : 'pageContainer'), isPublic);
    } catch (error) {
      showToast(error.message, 'error');
    }
  });
}

function closeModal(e, id) {
  if (e.target.id === id) e.target.classList.remove('active');
}

function toggleMobileNav(button) {
  const nav = document.getElementById('mainNav');
  const expanded = button.getAttribute('aria-expanded') === 'true';
  button.setAttribute('aria-expanded', String(!expanded));
  button.setAttribute('aria-label', expanded ? 'Menyuni ochish' : 'Menyuni yopish');
  nav.classList.toggle('open', !expanded);
  refreshIcons();
}

function sendContactMessage(event) {
  event.preventDefault();
  const name = document.getElementById('contactName').value.trim();
  const email = document.getElementById('contactEmail').value.trim();
  const message = document.getElementById('contactMessage').value.trim();
  const subject = encodeURIComponent(`Ta'lim Nazariyasi murojaat: ${name}`);
  const body = encodeURIComponent(`${message}\n\nYuboruvchi: ${name}\nEmail: ${email}`);
  window.location.href = `mailto:info@talimnazariyasi.uz?subject=${subject}&body=${body}`;
}

function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  if (!t) return;

  // Xabar mazmuniga qarab avtomatik toifani aniqlash (agar berilmagan bo'lsa)
  if (type === 'info') {
    const lower = String(msg).toLowerCase();
    if (msg.includes('✅') || lower.includes('muvaffaqiyatli') || lower.includes('saqlandi') || lower.includes('yaratildi')) {
      type = 'success';
    } else if (lower.includes('xato') || lower.includes('noto‘g‘ri') || lower.includes('noto‘g‘ri') || lower.includes('o‘chirildi')) {
      type = 'error';
    } else if (lower.includes('iltimos') || lower.includes('diqqat') || lower.includes('talab')) {
      type = 'warning';
    }
  }

  const iconName = type === 'success' ? 'check-circle' : (type === 'error' ? 'alert-triangle' : (type === 'warning' ? 'alert-circle' : 'info'));
  t.className = `toast toast-${type} show`;
  t.innerHTML = `<i data-lucide="${iconName}"></i> <span>${escapeHTML(msg)}</span>`;
  refreshIcons();

  clearTimeout(t._timer);
  t._timer = setTimeout(() => {
    t.classList.remove('show');
  }, 3500);
}

// ===== STUDENT WORK (TEACHER & ADMIN) =====
let currentStudentId = null;

function openStudentDetail(id) {
  currentStudentId = Number(id);
  navigate('student-detail');
}

function studentWorkHtml(rows) {
  const byModule = new Map(rows.map(row => [Number(row.module_id), row]));
  return modulesCache.map(module => {
    const row = byModule.get(Number(module.id));
    if (!row) {
      return `
        <section class="card work-module">
          <div class="work-module-head">
            <h3>Modul ${Number(module.order_num)}. ${escapeHTML(module.title)}</h3>
            <span class="badge badge-muted">Boshlanmagan</span>
          </div>
        </section>`;
    }
    const completed = row.completed_steps || [];
    const responses = row.step_responses || {};
    const steps = STEP_TYPES.map(step => {
      const done = completed.includes(step.id);
      const review = responses.reviews?.[step.id];
      const answer = responses[step.id];
      const file = step.id === 'task' ? responses.task_file : null;
      const verdict = step.id === 'diag' && done
        ? (responses.diag_correct ? '<span class="badge badge-success">To‘g‘ri</span>' : '<span class="badge badge-muted">Noto‘g‘ri</span>')
        : '';
      return `
        <li class="work-step">
          <div class="work-step-head">
            <span>${step.title}</span>
            <span class="work-step-badges">${verdict}<span class="badge ${done ? 'badge-success' : 'badge-muted'}">${done ? 'Bajarilgan' : 'Bajarilmagan'}</span></span>
          </div>
          ${typeof answer === 'string' && answer ? `<div class="submission-response">${escapeHTML(answer)}</div>` : ''}
          ${fileCardHtml(file)}
          ${reviewBoxHtml(review)}
        </li>`;
    }).join('');
    return `
      <section class="card work-module">
        <div class="work-module-head">
          <h3>Modul ${Number(module.order_num)}. ${escapeHTML(module.title)}</h3>
          <span class="badge ${completed.length >= 6 ? 'badge-success' : 'badge-primary'}">${completed.length}/6 qadam &middot; ${Number(row.total_score) || 0} ball</span>
        </div>
        <ul class="work-steps">${steps}</ul>
      </section>`;
  }).join('');
}

async function renderStudentDetail(container) {
  const rows = await fetchAPI(`/progress?user_id=${currentStudentId}`);
  if (!rows) {
    container.innerHTML = '<div class="card">Ma\'lumotlarni yuklab bo‘lmadi.</div>';
    return;
  }
  const name = rows[0]?.student_name || rows[0]?.student_login || 'Talaba';
  document.getElementById('pageTitle').textContent = name;
  container.innerHTML = `
    <button type="button" class="back-btn" onclick="navigate('analytics')"><i data-lucide="arrow-left"></i> Tahlilga qaytish</button>
    <div class="card">
      <h3 class="card-title" style="margin-bottom:6px; border:none; padding:0;">${escapeHTML(name)}</h3>
      <p class="muted-text">${escapeHTML(rows[0]?.student_login || '')} &middot; Modullar kesimida bajarilgan ishlar</p>
    </div>
    ${studentWorkHtml(rows)}
  `;
  refreshIcons();
}

// ===== ADMIN: USERS & PROFILES =====
const usersFilter = { role: 'student', q: '', page: 1 };
let currentProfileId = null;
let usersSearchTimer = null;

function formatDate(value) {
  return value ? new Date(value).toLocaleString('uz-UZ') : '—';
}

function statusBadge(status) {
  return (status || 'active') === 'active'
    ? '<span class="badge badge-success">Faol</span>'
    : '<span class="badge badge-muted">Bloklangan</span>';
}

function openUserProfile(id) {
  currentProfileId = Number(id);
  navigate('user-profile');
}

function setUsersRole(role) {
  usersFilter.role = role;
  usersFilter.page = 1;
  navigate('users');
}

function setUsersPage(page) {
  usersFilter.page = page;
  loadUsersTable();
}

function onUsersSearch(value) {
  clearTimeout(usersSearchTimer);
  usersSearchTimer = setTimeout(() => {
    usersFilter.q = value.trim();
    usersFilter.page = 1;
    loadUsersTable();
  }, 300);
}

function renderUsers(container) {
  container.innerHTML = `
    <div class="card">
      <div class="users-toolbar">
        <div class="segmented" role="group" aria-label="Rol bo‘yicha filtr">
          <button type="button" id="usersTabStudent" aria-pressed="${usersFilter.role === 'student'}" onclick="setUsersRole('student')">Talabalar</button>
          <button type="button" id="usersTabTeacher" aria-pressed="${usersFilter.role === 'teacher'}" onclick="setUsersRole('teacher')">O‘qituvchilar</button>
        </div>
        <div class="users-search">
          <label for="usersSearch" class="visually-hidden">Ism yoki login bo‘yicha qidirish</label>
          <input id="usersSearch" type="search" placeholder="Ism yoki login bo‘yicha qidirish..." value="${escapeHTML(usersFilter.q)}" oninput="onUsersSearch(this.value)"/>
        </div>
      </div>
      <div id="usersTable" aria-live="polite"><div class="spinner"></div></div>
    </div>
  `;
  loadUsersTable();
}

async function loadUsersTable() {
  const target = document.getElementById('usersTable');
  if (!target) return;
  const params = new URLSearchParams({ role: usersFilter.role, page: String(usersFilter.page) });
  if (usersFilter.q) params.set('q', usersFilter.q);
  const data = await fetchAPI(`/users?${params}`);
  if (!document.getElementById('usersTable')) return;
  if (!data) {
    target.innerHTML = '<p class="muted-text">Ma\'lumotlarni yuklab bo‘lmadi.</p>';
    return;
  }

  document.getElementById('usersTabStudent').textContent = `Talabalar (${data.counts.student || 0})`;
  document.getElementById('usersTabTeacher').textContent = `O‘qituvchilar (${data.counts.teacher || 0})`;

  if (!data.items.length) {
    const label = usersFilter.role === 'student' ? 'talabalar' : 'o‘qituvchilar';
    target.innerHTML = `<p class="muted-text empty-text">${usersFilter.q ? 'Qidiruv bo‘yicha hech kim topilmadi.' : `Hozircha ro‘yxatdan o‘tgan ${label} yo‘q.`}</p>`;
    return;
  }

  const isStudent = usersFilter.role === 'student';
  const totalPages = Math.max(1, Math.ceil(data.total / data.page_size));
  target.innerHTML = `
    <div style="overflow-x:auto;">
      <table class="leaderboard-table">
        <thead><tr>
          <th>F.I.Sh</th><th>Login</th>
          ${isStudent ? '<th>Tugatilgan modullar</th><th>Ball</th>' : '<th>Yaratgan modullari</th>'}
          <th>Ro‘yxatdan o‘tgan</th><th>Holat</th>
        </tr></thead>
        <tbody>
          ${data.items.map(user => `
            <tr>
              <td data-label="F.I.Sh"><button type="button" class="link-btn" onclick="openUserProfile(${Number(user.id)})">${escapeHTML(user.name || user.login)}</button></td>
              <td data-label="Login">${escapeHTML(user.login)}</td>
              ${isStudent
                ? `<td data-label="Modullar">${Number(user.modules_finished)} / ${Number(user.modules_started)}</td><td data-label="Ball">${Number(user.total_score)}</td>`
                : `<td data-label="Modullar">${Number(user.modules_created)}</td>`}
              <td data-label="Sana">${escapeHTML(formatDate(user.created_at))}</td>
              <td data-label="Holat">${statusBadge(user.status)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${totalPages > 1 ? `
      <div class="pagination">
        <button type="button" class="btn-outline" ${data.page <= 1 ? 'disabled' : ''} onclick="setUsersPage(${data.page - 1})">Oldingi</button>
        <span>${data.page} / ${totalPages}</span>
        <button type="button" class="btn-outline" ${data.page >= totalPages ? 'disabled' : ''} onclick="setUsersPage(${data.page + 1})">Keyingi</button>
      </div>` : ''}
  `;
  refreshIcons();
}

async function renderUserProfile(container) {
  const profile = await fetchAPI(`/users?id=${currentProfileId}`);
  if (!profile) {
    container.innerHTML = '<div class="card">Foydalanuvchi topilmadi.</div>';
    return;
  }
  document.getElementById('pageTitle').textContent = profile.name || profile.login;
  usersFilter.role = profile.role === 'teacher' ? 'teacher' : 'student';

  let extra = '';
  if (profile.role === 'student') {
    const rows = await fetchAPI(`/progress?user_id=${Number(profile.id)}`);
    extra = rows ? studentWorkHtml(rows) : '<div class="card">Natijalarni yuklab bo‘lmadi.</div>';
  } else {
    extra = `
      <div class="card">
        <h3 class="card-title">Yaratgan modullari</h3>
        ${profile.modules_created.length
          ? `<ul class="plain-list">${profile.modules_created.map(m => `<li>Modul ${Number(m.order_num)}. ${escapeHTML(m.title)}</li>`).join('')}</ul>`
          : '<p class="muted-text">Hozircha modul yaratmagan.</p>'}
      </div>`;
  }

  container.innerHTML = `
    <button type="button" class="back-btn" onclick="navigate('users')"><i data-lucide="arrow-left"></i> Foydalanuvchilar ro‘yxatiga qaytish</button>
    <div class="card">
      <h3 class="card-title">${escapeHTML(profile.name || profile.login)}</h3>
      <dl class="profile-grid">
        <div><dt>Login</dt><dd>${escapeHTML(profile.login)}</dd></div>
        <div><dt>Rol</dt><dd>${escapeHTML(ROLE_LABELS[profile.role] || profile.role)}</dd></div>
        <div><dt>Holat</dt><dd>${statusBadge(profile.status)}</dd></div>
        <div><dt>Ro‘yxatdan o‘tgan</dt><dd>${escapeHTML(formatDate(profile.created_at))}</dd></div>
        <div><dt>Oxirgi kirish</dt><dd>${escapeHTML(formatDate(profile.last_login_at))}</dd></div>
      </dl>
    </div>
    ${extra}
  `;
  refreshIcons();
}

// ===== URL ROUTING (a page refresh keeps the current view) =====
function writeRoute(pageId) {
  const params = { 'module-view': currentModuleId, 'student-detail': currentStudentId, 'user-profile': currentProfileId };
  const suffix = pageId in params ? `/${params[pageId]}` : '';
  history.replaceState(null, '', `#/${pageId}${suffix}`);
}

function restoreRoute() {
  const [, pageId, rawId] = location.hash.match(/^#\/([a-z-]+)(?:\/(\d+))?$/) || [];
  if (!pageId) return false;
  const known = pageId === 'home' || pageId === 'modules' || pageId in PAGE_ROLES || pageId === 'module-view';
  if (!known) return false;
  const needsId = ['module-view', 'student-detail', 'user-profile'].includes(pageId);
  if (needsId && !rawId) return false;
  if (pageId === 'module-view') currentModuleId = Number(rawId);
  if (pageId === 'student-detail') currentStudentId = Number(rawId);
  if (pageId === 'user-profile') currentProfileId = Number(rawId);
  navigate(pageId);
  return true;
}

// ===== ACCESSIBILITY: KEYBOARD & MODAL FOCUS =====
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, iframe, [tabindex="0"]';
const NON_INTERACTIVE_ONCLICK = '.modal-overlay, .auth-card, .modal-box, .sidebar-backdrop';

function makeClickablesFocusable() {
  document.querySelectorAll('div[onclick], span[onclick]').forEach(element => {
    if (element.matches(NON_INTERACTIVE_ONCLICK)) return;
    if (!element.getAttribute('onclick')) return; // locked steps have an empty handler
    element.setAttribute('role', 'button');
    element.setAttribute('tabindex', '0');
  });
}

function activeModal() {
  return document.querySelector('.modal-overlay.active');
}

document.addEventListener('keydown', (event) => {
  const target = event.target;
  if ((event.key === 'Enter' || event.key === ' ') && target.matches?.('[role="button"][tabindex="0"]')) {
    event.preventDefault();
    target.click();
    return;
  }
  if (event.key === 'Tab') {
    const modal = activeModal();
    if (!modal) return;
    const items = [...modal.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});

function watchModalFocus(modal) {
  let returnFocusTo = null;
  new MutationObserver(() => {
    const isOpen = modal.classList.contains('active');
    if (isOpen && !returnFocusTo) {
      returnFocusTo = document.activeElement;
      setTimeout(() => {
        const box = modal.firstElementChild;
        const first = box.querySelector('input:not([type=file]):not([disabled]), textarea') || box.querySelector(FOCUSABLE);
        first?.focus();
      }, 80);
    } else if (!isOpen && returnFocusTo) {
      returnFocusTo.focus?.();
      returnFocusTo = null;
    }
  }).observe(modal, { attributes: true, attributeFilter: ['class'] });
}

function selectRegisterRole(role, element) {
  document.querySelectorAll('#registerForm .role-tab').forEach(tab => {
    tab.classList.toggle('active', tab === element);
    tab.setAttribute('aria-pressed', String(tab === element));
  });
}

window.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.modal-overlay').forEach(watchModalFocus);
});

// INITIALIZATION
window.addEventListener('DOMContentLoaded', initPublicSite);
