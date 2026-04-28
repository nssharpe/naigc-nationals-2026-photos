import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore, doc, onSnapshot, setDoc, serverTimestamp }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

// ── Constants ────────────────────────────────────────────────────────────────

const USERS = [
  { id: 'nate',   label: 'Nate' },
  { id: 'ilana',  label: 'Ilana' },
  { id: 'jules',  label: 'Jules' },
  { id: 'dot',    label: 'Dot' },
  { id: 'olivia', label: 'Olivia' },
];
const LOVE_CAP = 40;

// ── Firebase ─────────────────────────────────────────────────────────────────

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

// ── State ─────────────────────────────────────────────────────────────────────

let manifest = [];         // array of photo IDs (strings)
let currentUser = localStorage.getItem('naigc_user') || '';

// allSelections[userId] = { photoId: 'love'|'like' }
const allSelections = {};
USERS.forEach(u => { allSelections[u.id] = {}; });

// filter state
let filterTier = 'all';           // 'all' | 'love' | 'like' | 'either' | 'unrated'
let filterUsers = new Set();      // which users to check; empty = all users

// modal state
let modalId = null;               // currently open photo ID
let filteredIds = [];             // current visible list (for prev/next)

// ── DOM refs ──────────────────────────────────────────────────────────────────

const identitySelect = document.getElementById('identity-select');
const chipsEl        = document.getElementById('chips');
const gridEl         = document.getElementById('grid');
const loadingEl      = document.getElementById('loading');
const emptyEl        = document.getElementById('empty-msg');
const photoCountEl   = document.getElementById('photo-count');

const modalOverlay   = document.getElementById('modal-overlay');
const modalImg       = document.getElementById('modal-img');
const modalFilename  = document.getElementById('modal-filename');
const modalLikeBtn   = document.getElementById('modal-like-btn');
const modalLoveBtn   = document.getElementById('modal-love-btn');
const modalBadges    = document.getElementById('modal-badges');
const modalPrev      = document.getElementById('modal-prev');
const modalNext      = document.getElementById('modal-next');
const modalClose     = document.getElementById('modal-close');
const filterClear    = document.getElementById('filter-clear');

// ── Identity ──────────────────────────────────────────────────────────────────

identitySelect.value = currentUser;

identitySelect.addEventListener('change', () => {
  currentUser = identitySelect.value;
  localStorage.setItem('naigc_user', currentUser);
  renderGrid();
  renderChips();
  if (modalId) renderModalButtons();
});

// ── Firebase listeners ────────────────────────────────────────────────────────

function listenToUser(userId) {
  const ref = doc(db, 'selections', userId);
  onSnapshot(ref, snap => {
    allSelections[userId] = snap.exists() ? (snap.data().photos || {}) : {};
    renderChips();
    renderGrid();
    if (modalId) renderModalButtons();
  });
}

USERS.forEach(u => listenToUser(u.id));

// ── Write selection ───────────────────────────────────────────────────────────

async function setRating(photoId, tier) {
  if (!currentUser) { alert('Please select your name first.'); return; }
  const existing = allSelections[currentUser][photoId];

  // toggle off if clicking the same tier
  const newTier = existing === tier ? null : tier;

  const photos = { ...allSelections[currentUser] };
  if (newTier) {
    photos[photoId] = newTier;
  } else {
    delete photos[photoId];
  }

  // optimistic update
  allSelections[currentUser] = photos;
  renderChips();
  renderGrid();
  if (modalId) renderModalButtons();

  await setDoc(doc(db, 'selections', currentUser), {
    photos,
    updatedAt: serverTimestamp(),
  });
}

// ── Chips ─────────────────────────────────────────────────────────────────────

function renderChips() {
  chipsEl.innerHTML = '';
  USERS.forEach(u => {
    const picks = allSelections[u.id];
    const loveCount = Object.values(picks).filter(v => v === 'love').length;
    const likeCount = Object.values(picks).filter(v => v === 'like').length;
    const isActive  = filterUsers.has(u.id);
    const overCap   = loveCount > LOVE_CAP;

    const chip = document.createElement('button');
    chip.className = 'chip' + (isActive ? ' active' : '');
    chip.innerHTML = `
      <span class="chip-name">${u.label}</span>
      <span class="chip-love${overCap ? ' over-cap' : ''}" title="${loveCount} loves (cap: ${LOVE_CAP})">★★ ${loveCount}</span>
      <span class="chip-like" title="${likeCount} likes">★ ${likeCount}</span>
    `;
    chip.title = isActive ? `Remove ${u.label} from filter` : `Filter by ${u.label}`;
    chip.addEventListener('click', () => {
      if (filterUsers.has(u.id)) {
        filterUsers.delete(u.id);
      } else {
        filterUsers.add(u.id);
      }
      renderChips();
      renderGrid();
    });
    chipsEl.appendChild(chip);
  });
}

// ── Filter buttons ────────────────────────────────────────────────────────────

document.querySelectorAll('.filter-btn[data-tier]').forEach(btn => {
  btn.addEventListener('click', () => {
    filterTier = btn.dataset.tier;
    document.querySelectorAll('.filter-btn[data-tier]').forEach(b =>
      b.classList.toggle('active', b === btn));
    renderGrid();
  });
});

filterClear.addEventListener('click', () => {
  filterUsers.clear();
  renderChips();
  renderGrid();
});

// ── Filter logic ──────────────────────────────────────────────────────────────

function photoPassesFilter(id) {
  if (filterTier === 'all') return true;

  const targetUsers = filterUsers.size > 0
    ? [...filterUsers]
    : USERS.map(u => u.id);

  if (filterTier === 'unrated') {
    return targetUsers.every(uid => !allSelections[uid][id]);
  }

  return targetUsers.some(uid => {
    const tier = allSelections[uid][id];
    if (filterTier === 'love')   return tier === 'love';
    if (filterTier === 'like')   return tier === 'like';
    if (filterTier === 'either') return tier === 'love' || tier === 'like';
    return false;
  });
}

// ── Grid ──────────────────────────────────────────────────────────────────────

function renderGrid() {
  filteredIds = manifest.filter(id => photoPassesFilter(id));
  photoCountEl.textContent = `${filteredIds.length} / ${manifest.length} photos`;

  emptyEl.style.display = (filteredIds.length === 0 && manifest.length > 0) ? 'block' : 'none';

  // update existing cards; create/remove as needed
  const existingWraps = new Map();
  gridEl.querySelectorAll('.thumb-wrap').forEach(el => {
    existingWraps.set(el.dataset.id, el);
  });

  const newIds = new Set(filteredIds);

  // remove cards no longer in filter
  existingWraps.forEach((el, id) => {
    if (!newIds.has(id)) el.remove();
  });

  // build ordered fragment
  const frag = document.createDocumentFragment();
  filteredIds.forEach(id => {
    let wrap = existingWraps.get(id);
    if (!wrap) {
      wrap = buildCard(id);
    } else {
      updateCard(wrap, id);
    }
    frag.appendChild(wrap);
  });
  gridEl.appendChild(frag);
}

function buildCard(id) {
  const wrap = document.createElement('div');
  wrap.className = 'thumb-wrap';
  wrap.dataset.id = id;

  const img = document.createElement('img');
  img.src = `thumbs/${id}.jpg`;
  img.alt = `Photo ${id}`;
  img.loading = 'lazy';
  img.decoding = 'async';
  wrap.appendChild(img);

  const badges = document.createElement('div');
  badges.className = 'thumb-badges';
  wrap.appendChild(badges);

  const overlay = document.createElement('div');
  overlay.className = 'thumb-overlay';

  const likeBtn = document.createElement('button');
  likeBtn.className = 'rate-btn like-btn';
  likeBtn.title = 'Like (★)';
  likeBtn.textContent = '★';
  likeBtn.addEventListener('click', e => { e.stopPropagation(); setRating(id, 'like'); });

  const loveBtn = document.createElement('button');
  loveBtn.className = 'rate-btn love-btn';
  loveBtn.title = 'Love (★★)';
  loveBtn.textContent = '★★';
  loveBtn.addEventListener('click', e => { e.stopPropagation(); setRating(id, 'love'); });

  overlay.appendChild(likeBtn);
  overlay.appendChild(loveBtn);
  wrap.appendChild(overlay);

  wrap.addEventListener('click', () => openModal(id));

  // touch: first tap shows overlay, second opens modal
  wrap.addEventListener('touchend', e => {
    if (!wrap.classList.contains('touch-open')) {
      e.preventDefault();
      wrap.classList.add('touch-open');
      setTimeout(() => wrap.classList.remove('touch-open'), 3000);
    }
  }, { passive: false });

  updateCard(wrap, id);
  return wrap;
}

function updateCard(wrap, id) {
  const myTier = currentUser ? (allSelections[currentUser]?.[id] || null) : null;

  const likeBtn = wrap.querySelector('.like-btn');
  const loveBtn = wrap.querySelector('.love-btn');
  if (likeBtn) likeBtn.classList.toggle('active', myTier === 'like');
  if (loveBtn) loveBtn.classList.toggle('active', myTier === 'love');

  // badges: other users' picks
  const badges = wrap.querySelector('.thumb-badges');
  badges.innerHTML = '';
  USERS.forEach(u => {
    const tier = allSelections[u.id][id];
    if (!tier) return;
    // skip current user's own badge on the card
    if (u.id === currentUser) return;
    const badge = document.createElement('span');
    badge.className = `badge ${tier}`;
    badge.textContent = u.label[0] + (tier === 'love' ? '★★' : '★');
    badges.appendChild(badge);
  });
}

// ── Modal ─────────────────────────────────────────────────────────────────────

function openModal(id) {
  modalId = id;
  // update hash for back-button friendliness
  history.replaceState(null, '', `#${id}`);
  renderModalImage();
  renderModalButtons();
  modalOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  modalOverlay.classList.remove('open');
  document.body.style.overflow = '';
  history.replaceState(null, '', window.location.pathname + window.location.search);
  modalId = null;
}

function renderModalImage() {
  if (!modalId) return;
  modalImg.src = `photos/${modalId}.jpg`;
  modalFilename.textContent = `#${modalId}`;
  const idx = filteredIds.indexOf(modalId);
  modalPrev.disabled = idx <= 0;
  modalNext.disabled = idx >= filteredIds.length - 1;
}

function renderModalButtons() {
  if (!modalId) return;
  const myTier = currentUser ? (allSelections[currentUser]?.[modalId] || null) : null;
  modalLikeBtn.classList.toggle('active', myTier === 'like');
  modalLoveBtn.classList.toggle('active', myTier === 'love');

  modalBadges.innerHTML = '';
  USERS.forEach(u => {
    const tier = allSelections[u.id][modalId];
    if (!tier) return;
    const badge = document.createElement('span');
    badge.className = `badge ${tier}`;
    badge.textContent = u.label + (tier === 'love' ? ' ★★' : ' ★');
    modalBadges.appendChild(badge);
  });
}

function navigateModal(delta) {
  const idx = filteredIds.indexOf(modalId);
  const next = filteredIds[idx + delta];
  if (next) {
    modalId = next;
    history.replaceState(null, '', `#${next}`);
    renderModalImage();
    renderModalButtons();
  }
}

modalClose.addEventListener('click', closeModal);
modalPrev.addEventListener('click', () => navigateModal(-1));
modalNext.addEventListener('click', () => navigateModal(1));

modalLikeBtn.addEventListener('click', () => setRating(modalId, 'like'));
modalLoveBtn.addEventListener('click', () => setRating(modalId, 'love'));

modalOverlay.addEventListener('click', e => {
  if (e.target === modalOverlay) closeModal();
});

document.addEventListener('keydown', e => {
  if (!modalOverlay.classList.contains('open')) return;
  if (e.key === 'Escape')      closeModal();
  if (e.key === 'ArrowLeft')   navigateModal(-1);
  if (e.key === 'ArrowRight')  navigateModal(1);
  if (e.key === '1')           setRating(modalId, 'like');
  if (e.key === '2')           setRating(modalId, 'love');
});

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const res = await fetch('manifest.json');
  manifest = await res.json();
  loadingEl.style.display = 'none';
  gridEl.style.display = 'grid';
  renderChips();
  renderGrid();

  // open photo from hash if present
  const hashId = window.location.hash.slice(1);
  if (hashId && manifest.includes(hashId)) {
    openModal(hashId);
  }
}

init();
