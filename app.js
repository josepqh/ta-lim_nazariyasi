// ===== STATE =====
let currentUser = null; 
let currentModuleId = null;
let modulesCache = [];
let progressCache = {};

const API_BASE = '/api';

// ===== API HELPER =====
async function fetchAPI(endpoint, method = 'GET', body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (body) options.body = JSON.stringify(body);
  try {
    const res = await fetch(`${API_BASE}${endpoint}`, options);
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Server xatosi');
    }
    return await res.json();
  } catch (error) {
    showToast(error.message);
    return null;
  }
}

// ===== PUBLIC WEBSITE LOGIC =====
async function initPublicSite() {
  const res = await fetchAPI('/modules');
  if (res) {
    modulesCache = res;
    const modContainer = document.getElementById('publicModulesList');
    if(modContainer && modulesCache.length > 0) {
      modContainer.innerHTML = modulesCache.slice(0, 6).map(m => `
        <div class="info-card">
          <h3>${m.title}</h3>
          <p>${m.description || 'Neyropedagogika moduli'}</p>
        </div>
      `).join('') + `<div class="info-card" style="display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--primary);font-weight:bold" onclick="openAuthModal('register')">Barcha modullarni ko'rish →</div>`;
    }
  }
}

function showPublicSection(sectionId) {
  document.querySelectorAll('.public-section').forEach(s => s.classList.remove('active'));
  document.getElementById(sectionId).classList.add('active');
  window.scrollTo(0,0);
}

// ===== AUTH MODAL LOGIC =====
function openAuthModal(type) {
  document.getElementById('authModal').classList.add('active');
  switchAuth(type);
}

function closeAuthModal(e) {
  if(e.target.id === 'authModal') e.target.classList.remove('active');
}

function switchAuth(type) {
  document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
  if (type === 'login') {
    document.getElementById('authTitle').textContent = 'Tizimga Kirish';
    document.getElementById('authSubtitle').textContent = "Platformadan foydalanish uchun rolingizni tanlang";
    document.getElementById('loginForm').classList.add('active');
  } else {
    document.getElementById('authTitle').textContent = "Ro'yxatdan o'tish";
    document.getElementById('authSubtitle').textContent = "Yangi hisob yarating";
    document.getElementById('registerForm').classList.add('active');
  }
}

function selectRole(role, btn) {
  document.querySelectorAll('#loginForm .role-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function selectRegRole(role, btn) {
  document.querySelectorAll('#registerForm .role-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

// ===== LOGIN & REGISTER HANDLING =====
async function handleLogin(e) {
  e.preventDefault();
  const role = document.querySelector('#loginForm .role-tab.active').dataset.role;
  const login = document.getElementById('loginUser').value;
  const pass = document.getElementById('loginPass').value;
  
  const user = await fetchAPI('/auth', 'POST', { action: 'login', login, password: pass });
  if (user) {
    if(user.role !== role) {
       document.getElementById('loginError').textContent = 'Sizning rolingiz mos kelmadi.';
       return;
    }
    startSession(user);
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const role = document.getElementById('regRole').value;
  const login = document.getElementById('regLogin').value;
  const pass = document.getElementById('regPass').value; 
  const name = document.getElementById('regName').value;
  
  const user = await fetchAPI('/auth', 'POST', { action: 'register', login, password: pass, role, name });
  if (user) startSession(user);
}

async function startSession(user) {
  currentUser = user;
  
  document.getElementById('authModal').classList.remove('active');
  document.getElementById('public-website').style.display = 'none';
  document.getElementById('screen-app').classList.add('active');
  
  document.getElementById('sidebarUser').textContent = currentUser.name || currentUser.login;
  let icon = currentUser.role === 'student' ? '👨‍🎓' : currentUser.role === 'teacher' ? '👩‍🏫' : '⚙️';
  document.getElementById('topbarUser').textContent = icon + ' ' + currentUser.role.toUpperCase();
  
  buildSidebar();
  
  // Preload modules
  const mods = await fetchAPI('/modules');
  if (mods) modulesCache = mods;

  // Load progress for student
  if (currentUser.role === 'student') {
    const prog = await fetchAPI(`/progress?user_id=${currentUser.id}`);
    if (prog) {
       progressCache = {};
       prog.forEach(p => {
         progressCache[p.module_id] = p;
       });
    }
  }
  
  navigate('home');
}

function logout() {
  currentUser = null;
  document.getElementById('screen-app').classList.remove('active');
  document.getElementById('public-website').style.display = 'block';
  document.getElementById('loginForm').reset();
  document.getElementById('registerForm').reset();
  document.getElementById('loginError').textContent = '';
  showPublicSection('home');
}

function returnToWebsite() {
  document.getElementById('screen-app').classList.remove('active');
  document.getElementById('public-website').style.display = 'block';
  showPublicSection('home');
}

// ===== PRIVATE SYSTEM NAVIGATION =====
const NAV_MENU = {
  student: [
    { id: 'home', title: 'Bosh sahifa', icon: '🏠' },
    { id: 'modules', title: 'Modullar', icon: '📚' }
  ],
  teacher: [
    { id: 'home', title: 'Bosh sahifa', icon: '🏠' },
    { id: 'manage-modules', title: 'Modullarni boshqarish', icon: '✏️' }
  ],
  admin: [
    { id: 'home', title: 'Bosh sahifa', icon: '🏠' }
  ]
};

function buildSidebar() {
  const nav = document.getElementById('sidebarNav');
  nav.innerHTML = '';
  NAV_MENU[currentUser.role].forEach(item => {
    const div = document.createElement('div');
    div.className = 'nav-item';
    div.id = 'nav-' + item.id;
    div.innerHTML = `<span>${item.icon}</span> <span>${item.title}</span>`;
    div.onclick = () => {
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      div.classList.add('active');
      navigate(item.id, item.title);
      if(window.innerWidth <= 768) toggleSidebar();
    };
    nav.appendChild(div);
  });
}

function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); }

function navigate(pageId, title = 'Bosh sahifa') {
  document.getElementById('pageTitle').textContent = title;
  const container = document.getElementById('pageContainer');
  
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const activeNav = document.getElementById('nav-' + (pageId === 'module-view' ? 'modules' : pageId));
  if(activeNav) activeNav.classList.add('active');

  container.innerHTML = '<div style="padding: 40px; text-align: center;">Yuklanmoqda...</div>';
  
  switch(pageId) {
    case 'home': renderHome(container); break;
    case 'modules': renderModules(container); break;
    case 'module-view': renderModuleView(container); break;
    case 'manage-modules': renderManageModules(container); break;
    default: container.innerHTML = '<div class="card">Tez orada ishga tushadi...</div>';
  }
}

// ===== RENDER SYSTEM PAGES =====
function renderHome(container) {
  let html = `<div class="dashboard-grid">`;
  if (currentUser.role === 'student') {
    const completed = Object.values(progressCache).filter(p => p.completed_steps && p.completed_steps.length >= 6).length;
    html += `
      <div class="stat-card"><div class="stat-icon">📚</div><div class="stat-info"><h3>${modulesCache.length}</h3><p>Jami modullar</p></div></div>
      <div class="stat-card"><div class="stat-icon">✅</div><div class="stat-info"><h3>${completed}</h3><p>Tugatilgan</p></div></div>
    `;
  } else if (currentUser.role === 'teacher') {
    html += `
      <div class="stat-card"><div class="stat-icon">📚</div><div class="stat-info"><h3>${modulesCache.length}</h3><p>Yaratilgan modullar</p></div></div>
    `;
  }
  html += `</div>
  <div class="card">
    <h3 class="card-title">Xush kelibsiz, ${currentUser.name || currentUser.login}!</h3>
    <p>Neyropedagogika platformasi orqali miya va ta'lim sirlarini o'rganing.</p>
  </div>`;
  container.innerHTML = html;
}

async function renderModules(container) {
  if(!modulesCache.length) {
    container.innerHTML = '<div class="card">Hali modullar qo\'shilmagan.</div>';
    return;
  }
  let html = `<div class="modules-grid">`;

  modulesCache.forEach(m => {
    const prog = progressCache[m.id] || { completed_steps: [] };
    const stepCount = prog.completed_steps ? prog.completed_steps.length : 0;
    const isDone = stepCount >= 6;

    html += `
      <div class="module-card" onclick="currentModuleId=${m.id}; navigate('module-view', '${m.title}')">
        <div class="mod-info">
          <h4>${m.title}</h4>
          <p>${stepCount}/6 qadam bajarildi</p>
        </div>
        <div class="mod-status ${isDone ? 'done' : ''}">${isDone ? '✅' : '▶️'}</div>
      </div>
    `;
  });
  html += `</div>`;
  container.innerHTML = html;
}

const STEP_TYPES = [
  { id: 'diag', title: '1. Diagnostika testi', type: 'quiz' },
  { id: 'video', title: '2. Video dars', type: 'video' },
  { id: 'pres', title: '3. Prezintatsiya', type: 'doc' },
  { id: 'doc', title: '4. Qo\'shimcha material', type: 'doc' },
  { id: 'task', title: '5. Amaliy topshiriq', type: 'upload' },
  { id: 'refl', title: '6. Refleksiv hisobot', type: 'text' }
];

async function renderModuleView(container) {
  const m = modulesCache.find(x => x.id === currentModuleId);
  const prog = progressCache[m.id] || { completed_steps: [] };
  const completed = prog.completed_steps || [];
  
  // Fetch specific content uploaded by teacher
  const contentRows = await fetchAPI(`/content?module_id=${m.id}`);
  
  let html = `
    <div class="back-btn" onclick="navigate('modules')">← Ortga qaytish</div>
    <div class="card">
      <h3 class="card-title">${m.title}</h3>
      <p style="color:var(--text-muted); margin-bottom: 20px;">${m.description}</p>
      <div class="steps-list">
  `;

  STEP_TYPES.forEach((step, idx) => {
    const isCompleted = completed.includes(step.id);
    const isLocked = idx > 0 && !completed.includes(STEP_TYPES[idx-1].id);
    const customContent = contentRows ? contentRows.find(c => c.step_type === step.id) : null;
    
    let icon = '📄';
    if(step.type === 'video') icon = '▶️';
    if(step.type === 'quiz') icon = '❓';
    if(step.type === 'upload') icon = '📤';
    if(step.type === 'text') icon = '✍️';

    // Store custom content in a global obj or data attribute for the modal
    const contentStr = customContent ? JSON.stringify(customContent.content).replace(/'/g, "&apos;") : '{}';

    html += `
      <div class="step-item ${isCompleted ? 'completed' : ''} ${isLocked ? 'disabled' : ''}" 
           onclick="${isLocked ? '' : `openStep('${step.id}', '${step.type}', '${step.title}', '${contentStr}')`}">
        <div class="step-info">
          <span class="step-icon">${isLocked ? '🔒' : icon}</span>
          <span>${step.title}</span>
        </div>
        <div class="step-check">✅</div>
      </div>
    `;
  });

  html += `</div></div>`;
  container.innerHTML = html;
}

// ===== TEACHER MANAGEMENT =====
async function renderManageModules(container) {
  let html = `
    <div class="card">
      <h3 class="card-title">Yangi modul qo'shish</h3>
      <div class="form-group"><label>Modul tartib raqami (masalan: 1)</label><input type="number" id="newModOrder" value="${modulesCache.length + 1}"/></div>
      <div class="form-group"><label>Modul sarlavhasi</label><input type="text" id="newModTitle" placeholder="Masalan: Miya anatomiyasi"/></div>
      <div class="form-group"><label>Ta'rif</label><input type="text" id="newModDesc" /></div>
      <button class="btn-primary" onclick="addModule()">Saqlash</button>
    </div>
    
    <div class="card"><h3 class="card-title">Modullarga material biriktirish</h3>
  `;
  
  if(!modulesCache.length) {
     html += `<p>Avval modul qo'shing.</p>`;
  } else {
    modulesCache.forEach(m => {
      html += `
        <div style="border:1px solid #eee; padding: 15px; border-radius: 8px; margin-bottom: 10px;">
          <strong>${m.order_num}. ${m.title}</strong>
          <div style="margin-top: 10px; display:flex; gap: 10px; flex-wrap:wrap">
            <button class="btn btn-outline" style="padding:6px 10px; font-size:12px" onclick="openContentModal(${m.id}, 'video')">Video (URL) kiritish</button>
            <button class="btn btn-outline" style="padding:6px 10px; font-size:12px" onclick="openContentModal(${m.id}, 'diag')">Test savoli</button>
            <button class="btn btn-outline" style="padding:6px 10px; font-size:12px" onclick="openContentModal(${m.id}, 'doc')">Matn/Ssilka</button>
          </div>
        </div>
      `;
    });
  }
  html += `</div>`;
  container.innerHTML = html;
}

async function addModule() {
  const order_num = document.getElementById('newModOrder').value;
  const title = document.getElementById('newModTitle').value;
  const description = document.getElementById('newModDesc').value;
  
  if(!title || !order_num) return showToast("Iltimos, maydonlarni to'ldiring");
  
  const res = await fetchAPI('/modules', 'POST', { order_num, title, description, created_by: currentUser.id });
  if(res) {
    showToast("Modul saqlandi!");
    const mods = await fetchAPI('/modules');
    if(mods) modulesCache = mods;
    navigate('manage-modules', 'Modullarni boshqarish');
  }
}

// Upload Content Modal for Teacher
let teacherUploadContext = {};
function openContentModal(moduleId, stepType) {
  teacherUploadContext = { moduleId, stepType };
  document.getElementById('modalTitle').textContent = "Material biriktirish";
  
  const body = document.getElementById('modalBody');
  const footer = document.getElementById('modalFooter');
  
  if (stepType === 'video') {
    body.innerHTML = `<p>YouTube video ssilkasini kiriting:</p><input type="text" id="teacherUploadVal" class="form-group" style="width:100%" placeholder="https://youtube.com/..."/>`;
  } else if (stepType === 'diag') {
    body.innerHTML = `<p>Test savoli:</p><input type="text" id="teacherUploadVal" style="width:100%;margin-bottom:10px" placeholder="Savol..."/><p>To'g'ri javob:</p><input type="text" id="teacherUploadVal2" style="width:100%" placeholder="Javob..."/>`;
  } else {
    body.innerHTML = `<p>Ma'lumot matni yoki ssilka:</p><textarea id="teacherUploadVal" rows="4" style="width:100%"></textarea>`;
  }
  
  footer.innerHTML = `<button class="btn btn-primary" onclick="saveTeacherContent()">Saqlash</button>`;
  document.getElementById('stepModal').classList.add('active');
}

async function saveTeacherContent() {
  const val = document.getElementById('teacherUploadVal').value;
  let content = { value: val };
  
  if(teacherUploadContext.stepType === 'diag') {
    content.answer = document.getElementById('teacherUploadVal2').value;
  }
  
  const res = await fetchAPI('/content', 'POST', { 
    module_id: teacherUploadContext.moduleId,
    step_type: teacherUploadContext.stepType,
    content,
    updated_by: currentUser.id
  });
  
  if(res) {
    showToast("Material muvaffaqiyatli saqlandi!");
    document.getElementById('stepModal').classList.remove('active');
  }
}

// ===== STEP MODAL LOGIC (Student) =====
let currentStepId = null;

function openStep(id, type, title, customContentStr) {
  currentStepId = id;
  document.getElementById('modalTitle').textContent = title;
  
  const body = document.getElementById('modalBody');
  const footer = document.getElementById('modalFooter');
  
  const prog = progressCache[currentModuleId] || { completed_steps: [] };
  const isDone = (prog.completed_steps || []).includes(id);

  let customContent = {};
  try { customContent = JSON.parse(customContentStr); } catch(e){}

  if (type === 'quiz') {
    const q = customContent.value || "O'qituvchi hali savol kiritmagan.";
    body.innerHTML = `<div class="quiz-question">${q}</div>
      <p style="font-size:12px; color:gray">Javobni o'ylab ko'ring va tasdiqlang.</p>`;
    footer.innerHTML = `<button class="btn btn-primary" onclick="completeStep()">Bajarildi</button>`;
  } else if (type === 'video') {
    const vid = customContent.value || "https://www.youtube.com/embed/dQw4w9WgXcQ";
    let embed = vid;
    if(vid.includes('watch?v=')) embed = vid.replace('watch?v=', 'embed/');
    
    body.innerHTML = `<div class="video-container" style="position:relative; padding-bottom:56.25%; height:0; overflow:hidden;">
        <iframe style="position:absolute; top:0; left:0; width:100%; height:100%; border:0;" src="${embed}" allowfullscreen></iframe>
      </div><p style="margin-top:20px">Videoni to'liq ko'rgach "Bajarildi" tugmasini bosing.</p>`;
    footer.innerHTML = `<button class="btn btn-success" onclick="completeStep()">Ko'rib bo'ldim</button>`;
  } else if (type === 'doc') {
    const doc = customContent.value || "Hozircha material yuklanmagan.";
    body.innerHTML = `<div style="padding: 20px 0;">${doc}</div>`;
    footer.innerHTML = `<button class="btn btn-success" onclick="completeStep()">O'qib chiqdim</button>`;
  } else if (type === 'upload') {
    body.innerHTML = `<p style="margin-bottom:15px">O'qituvchi bergan amaliy topshiriqni bajaring:</p>
      <textarea rows="4" style="width:100%; padding:10px" placeholder="Javobingizni shu yerga yozing..."></textarea>`;
    footer.innerHTML = `<button class="btn btn-primary" onclick="completeStep()">Topshirish</button>`;
  } else if (type === 'text') {
    body.innerHTML = `<p style="margin-bottom:15px">Ushbu moduldan nimalarni o'rgandingiz? Refleksiv hisobot yozing:</p><textarea rows="6" style="width:100%; padding: 10px; border:1px solid #ccc;"></textarea>`;
    footer.innerHTML = `<button class="btn btn-primary" onclick="completeStep()">Hisobotni yuborish</button>`;
  }

  if (isDone) footer.innerHTML = `<button class="btn btn-outline" disabled>Siz bu qadamni bajargansiz ✅</button>`;

  document.getElementById('stepModal').classList.add('active');
}

function closeModal(e, id) {
  if (e.target.id === id) e.target.classList.remove('active');
}

async function completeStep() {
  const score = ['diag', 'task', 'refl'].includes(currentStepId) ? 15 : 0;
  
  const res = await fetchAPI('/progress', 'POST', {
    user_id: currentUser.id,
    module_id: currentModuleId,
    step_type: currentStepId,
    score
  });

  if(res) {
    progressCache[currentModuleId] = res;
    showToast('Qadam bajarildi! ✅');
  }
  
  document.getElementById('stepModal').classList.remove('active');
  renderModuleView(document.getElementById('pageContainer'));
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// INITIALIZATION
window.onload = initPublicSite;
