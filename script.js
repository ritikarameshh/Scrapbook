// ---------- Tiny screen router ----------
const screens = document.querySelectorAll('.screen');
const history = ['splash'];

function show(name) {
  const target = document.querySelector(`.screen[data-screen="${name}"]`);
  if (!target) return;
  const prev = document.querySelector('.screen.active');
  screens.forEach(s => s.classList.remove('active'));
  target.classList.add('active');
  // scroll body to top
  const body = target.querySelector('.screen-body');
  if (body) body.scrollTop = 0;

  // camera lifecycle — only run when the active screen needs it
  if (target.hasAttribute('data-needs-camera')) {
    startCamera(target);
  } else if (prev && prev.hasAttribute('data-needs-camera')) {
    stopCamera();
  }
}

function go(name) {
  if (history[history.length - 1] !== name) history.push(name);
  show(name);
}

function back() {
  if (history.length > 1) {
    history.pop();
    show(history[history.length - 1]);
  }
}

document.addEventListener('click', (e) => {
  const goBtn   = e.target.closest('[data-go]');
  const backBtn = e.target.closest('[data-back]');
  if (goBtn)   { go(goBtn.dataset.go); return; }
  if (backBtn) { back(); return; }
});

// ---------- Onboarding chip-pick (max 2) ----------
document.querySelectorAll('[data-pick-grid]').forEach(grid => {
  const max = parseInt(grid.dataset.max || '2', 10);
  grid.addEventListener('click', (e) => {
    const chip = e.target.closest('.pick-chip');
    if (!chip) return;
    const picked = grid.querySelectorAll('.pick-chip.picked');
    if (chip.classList.contains('picked')) {
      chip.classList.remove('picked');
    } else if (picked.length < max) {
      chip.classList.add('picked');
    } else {
      // replace the oldest pick
      picked[0].classList.remove('picked');
      chip.classList.add('picked');
    }
  });
});

// ---------- Mode card pick (single) ----------
document.querySelectorAll('[data-mode-pick]').forEach(group => {
  group.addEventListener('click', (e) => {
    const card = e.target.closest('.mode-card');
    if (!card) return;
    group.querySelectorAll('.mode-card').forEach(c => c.classList.toggle('active', c === card));
  });
});

// ---------- City row pick ----------
document.querySelectorAll('.city-list').forEach(list => {
  list.addEventListener('click', (e) => {
    const row = e.target.closest('.city-row');
    if (!row) return;
    list.querySelectorAll('.city-row').forEach(r => r.classList.toggle('active', r === row));
  });
});

// ---------- Mode toggle (Trendy/Local) — sync across screens ----------
let currentMode = 'local';
function setMode(mode) {
  currentMode = mode;
  document.querySelectorAll('[data-mode-toggle] .mode-toggle-opt').forEach(opt => {
    opt.classList.toggle('active', opt.dataset.mode === mode);
  });
}
document.addEventListener('click', (e) => {
  const opt = e.target.closest('[data-mode-toggle] .mode-toggle-opt');
  if (!opt) return;
  setMode(opt.dataset.mode);
});

// ---------- Nearby add toggle ----------
document.querySelectorAll('.nearby-list .add-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const added = btn.classList.toggle('added');
    btn.textContent = added ? '✓' : '+';
  });
});

// ---------- Tab bar — non-functional tabs do nothing; the wired ones use data-go ----------

// ---------- Camera (markerless AR — live back-camera feed) ----------
let cameraStream = null;

async function startCamera(screenEl) {
  const video = screenEl.querySelector('.ar-feed');
  const perm  = screenEl.querySelector('.ar-perm');
  if (!video) return;

  // Reuse existing stream if we already have one — just attach it.
  if (cameraStream && cameraStream.active) {
    video.srcObject = cameraStream;
    if (perm) perm.hidden = true;
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    if (perm) perm.hidden = false;
    return;
  }

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    // attach to every video tag in case the user moves between AR screens
    document.querySelectorAll('.ar-feed').forEach(v => { v.srcObject = cameraStream; });
    document.querySelectorAll('.ar-perm').forEach(p => { p.hidden = true; });
  } catch (err) {
    console.warn('Camera unavailable:', err);
    if (perm) perm.hidden = false;
  }
}

function stopCamera() {
  if (!cameraStream) return;
  cameraStream.getTracks().forEach(t => t.stop());
  cameraStream = null;
  document.querySelectorAll('.ar-feed').forEach(v => { v.srcObject = null; });
}

document.addEventListener('click', (e) => {
  const retry = e.target.closest('[data-cam-retry]');
  if (!retry) return;
  const screen = retry.closest('.screen');
  if (screen) startCamera(screen);
});

// Stop the camera when the tab is hidden, restart when it returns
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopCamera();
  } else {
    const active = document.querySelector('.screen.active');
    if (active && active.hasAttribute('data-needs-camera')) startCamera(active);
  }
});

// ---------- Boot ----------
show('splash');
