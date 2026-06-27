// ===== DATA & STATE =====
let currentUser = null; 
let currentModuleId = null;

const MOCK_DB = {
  modules: Array.from({length: 10}, (_, i) => ({
    id: i + 1,
    title: `Modul ${i + 1}: ${['Neyroanatomiya asoslari', 'Miya plastikasi', 'Diqqat va Xotira', 'Emotsiya va O\'rganish', 'Nutq rivojlanishi', 'Harakat va Kognitsiya', 'Uyquning o\'rni', 'Stress va Ta\'lim', 'Neyromiflar', 'Amaliy Neyropedagogika'][i]}`,
    desc: 'O\'qituvchi tomonidan kiritilgan modul ta\'rifi. Ushbu modul orqali neyropedagogikaning asosiy tamoyillarini o\'rganasiz.',
    steps: [
      { id: 'diag', title: '1. Diagnostika testi', type: 'quiz' },
      { id: 'video', title: '2. Video dars', type: 'video' },
      { id: 'pres', title: '3. Prezintatsiya', type: 'doc' },
      { id: 'doc', title: '4. Word/PDF material', type: 'doc' },
      { id: 'task', title: '5. Amaliy topshiriq', type: 'upload' },
      { id: 'refl', title: '6. Refleksiv hisobot', type: 'text' }
    ]
  })),
  progress: {}, 
  news: [
    { id: 1, title: 'Yangi kurs boshlandi', date: '2026-06-20', content: 'Barcha talabalar uchun yangi neyropedagogika kursi ochildi. Modullarni bajarishni boshlashingiz mumkin.' },
    { id: 2, title: 'Amaliy mashg\'ulotlar', date: '2026-06-25', content: 'Kelasi haftadan amaliy mashg\'ulotlar uchun qo\'shimcha materiallar yuklanadi.' }
  ]
};

// ===== PUBLIC WEBSITE LOGIC =====
function initPublicSite() {
  // Populate Public Modules
  const modContainer = document.getElementById('publicModulesList');
  if(modContainer) {
    modContainer.innerHTML = MOCK_DB.modules.slice(0, 6).map(m => `
      <div class="info-card">
        <h3>${m.title}</h3>
        <p>${m.desc}</p>
      </div>
    `).join('') + `<div class="info-card" style="display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--primary);font-weight:bold" onclick="openAuthModal('register')">Barcha 10 ta modulni ko'rish →</div>`;
  }

  // Populate Public News
  const newsContainer = document.getElementById('publicNewsList');
  if(newsContainer) {
    newsContainer.innerHTML = MOCK_DB.news.map(n => `
      <div class="info-card">
        <h3>${n.title}</h3>
        <p style="font-size:12px; color:gray; margin-bottom:10px">${n.date}</p>
        <p>${n.content}</p>
      </div>
    `).join('');
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
function handleLogin(e) {
  e.preventDefault();
  const role = document.querySelector('#loginForm .role-tab.active').dataset.role;
  const login = document.getElementById('loginUser').value;
  const pass = document.getElementById('loginPass').value;
  
  if (pass !== '123') {
    document.getElementById('loginError').textContent = 'Parol noto\'g\'ri! (Demo parol: 123)';
    return;
  }

  startSession(role, login);
}

function handleRegister(e) {
  e.preventDefault();
  const role = document.querySelector('#registerForm .role-tab.active').dataset.regRole;
  const login = document.getElementById('regLogin').value;
  startSession(role, login);
}

function startSession(role, login) {
  let name = '';
  if (role === 'student') name = 'Talaba ' + login;
  if (role === 'teacher') name = 'O\'qituvchi ' + login;
  if (role === 'admin') name = 'Admin ' + login;

  currentUser = { role, name };
  
  // Init progress for student
  MOCK_DB.modules.forEach(m => {
    if(!MOCK_DB.progress[m.id]) MOCK_DB.progress[m.id] = { completedSteps: [], score: null };
  });
  
  document.getElementById('authModal').classList.remove('active');
  document.getElementById('public-website').style.display = 'none';
  document.getElementById('screen-app').classList.add('active');
  
  document.getElementById('sidebarUser').textContent = currentUser.name;
  document.getElementById('topbarUser').textContent = (role === 'student' ? '👨‍🎓' : role === 'teacher' ? '👩‍🏫' : '⚙️') + ' ' + role.toUpperCase();
  
  buildSidebar();
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
    { id: 'modules', title: 'Modullar', icon: '📚' },
    { id: 'news', title: 'Yangiliklar', icon: '📰' },
    { id: 'contact', title: 'Aloqa', icon: '📞' }
  ],
  teacher: [
    { id: 'home', title: 'Bosh sahifa', icon: '🏠' },
    { id: 'manage-modules', title: 'Modullarni tahrirlash', icon: '✏️' },
    { id: 'results', title: 'Talabalar natijalari', icon: '📊' },
    { id: 'news', title: 'Yangiliklar', icon: '📰' }
  ],
  admin: [
    { id: 'home', title: 'Bosh sahifa', icon: '🏠' },
    { id: 'users', title: 'Foydalanuvchilar', icon: '👥' },
    { id: 'system', title: 'Tizim sozlamalari', icon: '⚙️' }
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

  container.innerHTML = '';
  
  switch(pageId) {
    case 'home': renderHome(container); break;
    case 'modules': renderModules(container); break;
    case 'module-view': renderModuleView(container); break;
    case 'news': renderNews(container); break;
    case 'contact': renderContact(container); break;
    case 'manage-modules': renderManageModules(container); break;
    case 'results': renderResults(container); break;
    default: container.innerHTML = '<div class="card">Tez orada ishga tushadi...</div>';
  }
}

// ===== RENDER SYSTEM PAGES =====
function renderHome(container) {
  let html = `<div class="dashboard-grid">`;
  if (currentUser.role === 'student') {
    const completed = Object.values(MOCK_DB.progress).filter(p => p.completedSteps.length === 6).length;
    html += `
      <div class="stat-card"><div class="stat-icon">📚</div><div class="stat-info"><h3>10</h3><p>Jami modullar</p></div></div>
      <div class="stat-card"><div class="stat-icon">✅</div><div class="stat-info"><h3>${completed}</h3><p>Tugatilgan</p></div></div>
      <div class="stat-card"><div class="stat-icon">🏆</div><div class="stat-info"><h3>${completed*10}%</h3><p>Umumiy progress</p></div></div>
    `;
  } else if (currentUser.role === 'teacher') {
    html += `
      <div class="stat-card"><div class="stat-icon">👥</div><div class="stat-info"><h3>45</h3><p>Faol talabalar</p></div></div>
      <div class="stat-card"><div class="stat-icon">📝</div><div class="stat-info"><h3>120</h3><p>Tekshiriladigan ishlar</p></div></div>
    `;
  }
  html += `</div>
  <div class="card">
    <h3 class="card-title">Xush kelibsiz, ${currentUser.name}!</h3>
    <p>Neyropedagogika platformasi orqali miya va ta'lim sirlarini o'rganing.</p>
  </div>`;
  container.innerHTML = html;
}

function renderModules(container) {
  let html = `<div class="modules-grid">`;
  let allDone = true;
  let totalScore = 0;

  MOCK_DB.modules.forEach(m => {
    const prog = MOCK_DB.progress[m.id];
    const isDone = prog.completedSteps.length === 6;
    if(!isDone) allDone = false;
    if(prog.score) totalScore += prog.score;

    html += `
      <div class="module-card" onclick="currentModuleId=${m.id}; navigate('module-view', '${m.title}')">
        <div class="mod-info">
          <h4>${m.title}</h4>
          <p>${prog.completedSteps.length}/6 qadam bajarildi</p>
        </div>
        <div class="mod-status ${isDone ? 'done' : ''}">${isDone ? '✅' : '▶️'}</div>
      </div>
    `;
  });
  html += `</div>`;

  if (allDone) {
    const finalScore = Math.round(totalScore / 10);
    html += `
      <div class="result-box">
        <h3>Tabriklaymiz! Barcha modullarni yakunladingiz.</h3>
        <p>Sizning umumiy natijangiz (Diagnostika + Amaliy + Refleksiya):</p>
        <div class="result-score">${finalScore}%</div>
      </div>
    `;
  }
  container.innerHTML = html;
}

function renderModuleView(container) {
  const m = MOCK_DB.modules.find(x => x.id === currentModuleId);
  const prog = MOCK_DB.progress[m.id];
  
  let html = `
    <div class="back-btn" onclick="navigate('modules')">← Ortga qaytish</div>
    <div class="card">
      <h3 class="card-title">${m.title}</h3>
      <p style="color:var(--text-muted); margin-bottom: 20px;">${m.desc}</p>
      <div class="steps-list">
  `;

  m.steps.forEach((step, idx) => {
    const isCompleted = prog.completedSteps.includes(step.id);
    const isLocked = idx > 0 && !prog.completedSteps.includes(m.steps[idx-1].id);
    
    let icon = '📄';
    if(step.type === 'video') icon = '▶️';
    if(step.type === 'quiz') icon = '❓';
    if(step.type === 'upload') icon = '📤';
    if(step.type === 'text') icon = '✍️';

    html += `
      <div class="step-item ${isCompleted ? 'completed' : ''} ${isLocked ? 'disabled' : ''}" 
           onclick="${isLocked ? '' : `openStep('${step.id}', '${step.type}', '${step.title}')`}">
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

function renderManageModules(container) {
  let html = `<div class="card"><h3 class="card-title">Modullarga material biriktirish</h3>
  <p style="color:gray;margin-bottom:15px">O'qituvchi sifatida barcha elementlarni shu yerdan yuklaysiz.</p>`;
  
  MOCK_DB.modules.forEach(m => {
    html += `
      <div style="border:1px solid #eee; padding: 15px; border-radius: 8px; margin-bottom: 10px;">
        <strong>${m.title}</strong>
        <div style="margin-top: 10px; display:flex; gap: 10px; flex-wrap:wrap">
          <button class="btn btn-outline" style="padding:6px 10px; font-size:12px">Test kiritish</button>
          <button class="btn btn-outline" style="padding:6px 10px; font-size:12px">Video yuklash</button>
          <button class="btn btn-outline" style="padding:6px 10px; font-size:12px">Fayl biriktirish</button>
        </div>
      </div>
    `;
  });
  html += `</div>`;
  container.innerHTML = html;
}

function renderResults(container) {
  container.innerHTML = `
    <div class="card">
      <h3 class="card-title">Talabalar baholari</h3>
      <table class="data-table">
        <tr><th>Talaba</th><th>Tugatgan modullari</th><th>O'rtacha ball</th><th>Harakat</th></tr>
        <tr><td>Talaba Ali</td><td>4/10</td><td>85%</td><td><button class="btn btn-primary" style="padding:4px 8px;font-size:12px">Baholash</button></td></tr>
        <tr><td>Talaba Vali</td><td>10/10</td><td>92%</td><td><button class="btn btn-outline" style="padding:4px 8px;font-size:12px">Ko'rish</button></td></tr>
      </table>
    </div>
  `;
}

function renderNews(container) {
  let html = '';
  MOCK_DB.news.forEach(n => {
    html += `<div class="card">
      <h3 class="card-title">${n.title} <span style="float:right;font-size:12px;color:gray">${n.date}</span></h3>
      <p>${n.content}</p>
    </div>`;
  });
  container.innerHTML = html;
}

function renderContact(container) {
  container.innerHTML = `
    <div class="card" style="max-width: 500px">
      <h3 class="card-title">O'qituvchiga xabar yozish</h3>
      <div class="form-group"><label>Mavzu</label><input type="text"/></div>
      <div class="form-group"><label>Xabar</label><textarea rows="4"></textarea></div>
      <button class="btn btn-primary" onclick="showToast('Xabar yuborildi')">Yuborish</button>
    </div>
  `;
}

// ===== STEP MODAL LOGIC =====
let currentStepId = null;

function openStep(id, type, title) {
  currentStepId = id;
  document.getElementById('modalTitle').textContent = title;
  
  const body = document.getElementById('modalBody');
  const footer = document.getElementById('modalFooter');
  const isDone = MOCK_DB.progress[currentModuleId].completedSteps.includes(id);

  if (type === 'quiz') {
    body.innerHTML = `<div class="quiz-question">1. Neyropedagogika nima?</div>
      <div class="quiz-options">
        <div class="quiz-option" onclick="this.parentElement.querySelectorAll('.quiz-option').forEach(o=>o.classList.remove('selected')); this.classList.add('selected')">A) Faqat psixologiya</div>
        <div class="quiz-option" onclick="this.parentElement.querySelectorAll('.quiz-option').forEach(o=>o.classList.remove('selected')); this.classList.add('selected')">B) Miya ishlashi va ta'lim sintezi</div>
      </div>`;
    footer.innerHTML = `<button class="btn btn-primary" onclick="completeStep()">Javobni tasdiqlash</button>`;
  } else if (type === 'video') {
    body.innerHTML = `<div class="video-container"><iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" frameborder="0" allowfullscreen></iframe></div><p>Videoni to'liq ko'rgach "Bajarildi" tugmasini bosing.</p>`;
    footer.innerHTML = `<button class="btn btn-success" onclick="completeStep()">Ko'rib bo'ldim (Bajarildi)</button>`;
  } else if (type === 'doc') {
    body.innerHTML = `<div style="text-align:center; padding: 40px 0;"><div style="font-size: 40px; margin-bottom: 10px;">📄</div><button class="btn btn-outline">Materialni yuklab olish</button></div>`;
    footer.innerHTML = `<button class="btn btn-success" onclick="completeStep()">O'qib chiqdim (Bajarildi)</button>`;
  } else if (type === 'upload') {
    body.innerHTML = `<p style="margin-bottom:15px">O'qituvchi bergan amaliy topshiriqni shu yerga yuklang:</p><input type="file" style="margin-bottom: 20px" />`;
    footer.innerHTML = `<button class="btn btn-primary" onclick="completeStep()">Yuklash va Topshirish</button>`;
  } else if (type === 'text') {
    body.innerHTML = `<p style="margin-bottom:15px">Ushbu moduldan nimalarni o'rgandingiz? Refleksiv hisobot yozing:</p><textarea rows="6" style="width:100%; padding: 10px; border:1px solid #ccc; border-radius:8px"></textarea>`;
    footer.innerHTML = `<button class="btn btn-primary" onclick="completeStep()">Hisobotni yuborish</button>`;
  }

  if (isDone) footer.innerHTML = `<button class="btn btn-outline" disabled>Siz bu qadamni bajargansiz ✅</button>`;

  document.getElementById('stepModal').classList.add('active');
}

function closeModal(e, id) {
  if (e.target.id === id) e.target.classList.remove('active');
}

function completeStep() {
  const prog = MOCK_DB.progress[currentModuleId];
  if (!prog.completedSteps.includes(currentStepId)) {
    prog.completedSteps.push(currentStepId);
    if (['diag', 'task', 'refl'].includes(currentStepId)) {
      if(!prog.score) prog.score = 0;
      prog.score += Math.floor(Math.random() * 20 + 13);
      if (prog.completedSteps.length === 6 && prog.score > 100) prog.score = 100;
    }
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
