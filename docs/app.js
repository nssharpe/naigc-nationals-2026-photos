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
const FILENAME_PREFIX = '2026_04_09_NAIGC Nationals_';

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

// ── Selection mode state ──────────────────────────────────────────────────────

let selectionMode = false;
let finalIds = new Set();          // the ~40 chosen photos
let scoreCache = {};               // { id: { score, loves, likes } }
let tieZoneIds = new Set();        // photos in the tie zone at the cutoff
let selFilter = 'all';             // 'all' | 'love3' | 'love5' | 'selected' | 'unselected'
let finalSelLoaded = false;        // whether Firestore has loaded

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

const selModeBtn   = document.getElementById('sel-mode-btn');
const selbar       = document.getElementById('selbar');
const selCountEl   = document.getElementById('sel-count');
const tieWarnEl    = document.getElementById('tie-warn');
const copyBtn      = document.getElementById('copy-btn');
const autoPickBtn  = document.getElementById('auto-pick-btn');

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
    // recompute scores whenever votes change
    if (manifest.length > 0) {
      computeAllScores();
      computeTieZone();
      renderSelectionBar();
    }
    renderGrid();
    if (modalId) renderModalButtons();
  });
}

USERS.forEach(u => listenToUser(u.id));

// ── Final selection Firestore ─────────────────────────────────────────────────

function listenToFinalSelection() {
  const ref = doc(db, 'final_selections', 'main');
  onSnapshot(ref, snap => {
    if (snap.exists()) {
      finalIds = new Set(snap.data().photoIds || []);
    } else if (manifest.length > 0 && !finalSelLoaded) {
      // First time: auto-populate from scores
      autoPickTop40();
      saveFinalSelection();
    }
    finalSelLoaded = true;
    computeAllScores();
    computeTieZone();
    renderSelectionBar();
    if (selectionMode) renderGrid();
  });
}

async function saveFinalSelection() {
  await setDoc(doc(db, 'final_selections', 'main'), {
    photoIds: [...finalIds],
    updatedAt: serverTimestamp(),
  });
}

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
      if (selectionMode) return; // chips are display-only in selection mode
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

// ── Score computation ─────────────────────────────────────────────────────────

function computeScore(id) {
  let score = 0, loves = 0, likes = 0;
  USERS.forEach(u => {
    const t = allSelections[u.id][id];
    if (t === 'love') { score += 2; loves++; }
    else if (t === 'like') { score += 1; likes++; }
  });
  return { score, loves, likes };
}

function computeAllScores() {
  manifest.forEach(id => { scoreCache[id] = computeScore(id); });
}

function scoreSort(a, b) {
  const sa = scoreCache[a] || { score: 0, loves: 0 };
  const sb = scoreCache[b] || { score: 0, loves: 0 };
  if (sb.score !== sa.score) return sb.score - sa.score;   // higher score first
  if (sb.loves !== sa.loves) return sb.loves - sa.loves;   // more loves break ties
  return a.localeCompare(b);                                // stable alpha as last resort
}

function computeTieZone() {
  tieZoneIds = new Set();
  if (manifest.length <= LOVE_CAP) return;

  const sorted = [...manifest].sort(scoreSort);
  const cutoff = scoreCache[sorted[LOVE_CAP - 1]];  // last inside top-40
  const next   = scoreCache[sorted[LOVE_CAP]];       // first outside top-40

  // A tie exists at the boundary when both have the same score AND same loves
  if (next && cutoff && next.score === cutoff.score && next.loves === cutoff.loves) {
    sorted.forEach(id => {
      const s = scoreCache[id];
      if (s.score === cutoff.score && s.loves === cutoff.loves) {
        tieZoneIds.add(id);
      }
    });
  }
}

function autoPickTop40() {
  computeAllScores();
  const sorted = [...manifest].sort(scoreSort);
  finalIds = new Set(sorted.slice(0, LOVE_CAP));
  computeTieZone();
}

// ── Selection mode filter ─────────────────────────────────────────────────────

function photoPassesSelFilter(id) {
  if (selFilter === 'all')        return true;
  if (selFilter === 'selected')   return finalIds.has(id);
  if (selFilter === 'unselected') return !finalIds.has(id);
  const s = scoreCache[id] || { loves: 0 };
  if (selFilter === 'love3')  return s.loves >= 3;
  if (selFilter === 'love5')  return s.loves >= 5;
  return true;
}

// ── Selection mode toggle ─────────────────────────────────────────────────────

selModeBtn.addEventListener('click', () => {
  selectionMode = !selectionMode;
  selModeBtn.classList.toggle('active', selectionMode);
  selModeBtn.textContent = selectionMode ? '✕ Exit Selection' : '📋 Final Selection';
  selbar.style.display = selectionMode ? 'block' : 'none';
  gridEl.classList.toggle('sel-mode', selectionMode);

  // reset to neutral grid state when exiting
  if (!selectionMode) {
    selFilter = 'all';
    document.querySelectorAll('[data-sel-filter]').forEach(b =>
      b.classList.toggle('active', b.dataset.selFilter === 'all'));
  }
  renderGrid();
  renderSelectionBar();
});

// sel-mode filter buttons
document.querySelectorAll('[data-sel-filter]').forEach(btn => {
  // set initial active state
  if (btn.dataset.selFilter === 'all') btn.classList.add('active');
  btn.addEventListener('click', () => {
    selFilter = btn.dataset.selFilter;
    document.querySelectorAll('[data-sel-filter]').forEach(b =>
      b.classList.toggle('active', b === btn));
    renderGrid();
  });
});

autoPickBtn.addEventListener('click', () => {
  autoPickTop40();
  renderSelectionBar();
  renderGrid();
  saveFinalSelection();
});

// ── Toggle a photo in/out of the final 40 ────────────────────────────────────

async function toggleFinal(id) {
  if (finalIds.has(id)) {
    finalIds.delete(id);
  } else {
    finalIds.add(id);
  }
  renderSelectionBar();
  // update just this card's visual state without full re-render
  const wrap = gridEl.querySelector(`.thumb-wrap[data-id="${id}"]`);
  if (wrap) updateCardSelState(wrap, id);
  await saveFinalSelection();
}

// ── Selection bar ─────────────────────────────────────────────────────────────

function renderSelectionBar() {
  const count = finalIds.size;
  selCountEl.textContent = count;
  selCountEl.className = count === LOVE_CAP ? 'good'
    : count > LOVE_CAP ? 'over'
    : 'under';

  if (tieZoneIds.size > 0) {
    const inFinal  = [...tieZoneIds].filter(id => finalIds.has(id)).length;
    const outFinal = tieZoneIds.size - inFinal;
    tieWarnEl.textContent =
      `⚠️ ${tieZoneIds.size} photos tied at position 40 — ${inFinal} included, ${outFinal} excluded`;
    tieWarnEl.style.display = 'inline-block';
  } else {
    tieWarnEl.style.display = 'none';
  }
}

// ── Copy filenames ────────────────────────────────────────────────────────────

copyBtn.addEventListener('click', () => {
  if (finalIds.size === 0) { alert('No photos selected yet.'); return; }
  const filenames = [...finalIds]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map(id => `${FILENAME_PREFIX}${id}.jpg`)
    .join('\n');
  const blob = new Blob([filenames], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'naigc-nationals-2026-final-40.txt';
  a.click();
  URL.revokeObjectURL(url);
});

// ── Grid ──────────────────────────────────────────────────────────────────────

function renderGrid() {
  let ids;

  if (selectionMode) {
    // show all photos sorted by score, filtered by selFilter
    ids = [...manifest]
      .sort(scoreSort)
      .filter(id => photoPassesSelFilter(id));
  } else {
    ids = manifest.filter(id => photoPassesFilter(id));
  }

  filteredIds = ids;
  photoCountEl.textContent = `${filteredIds.length} / ${manifest.length} photos`;
  emptyEl.style.display = (filteredIds.length === 0 && manifest.length > 0) ? 'block' : 'none';

  // update existing cards; create/remove as needed
  const existingWraps = new Map();
  gridEl.querySelectorAll('.thumb-wrap').forEach(el => {
    existingWraps.set(el.dataset.id, el);
  });

  const newIds = new Set(filteredIds);

  existingWraps.forEach((el, id) => {
    if (!newIds.has(id)) el.remove();
  });

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

  // selection checkmark (visible only in selection mode via CSS)
  const selCheck = document.createElement('div');
  selCheck.className = 'sel-check';
  selCheck.textContent = '✓';
  wrap.appendChild(selCheck);

  // score badge (visible only in selection mode via CSS)
  const scoreBadge = document.createElement('div');
  scoreBadge.className = 'score-badge';
  wrap.appendChild(scoreBadge);

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

  wrap.addEventListener('click', () => {
    if (selectionMode) {
      toggleFinal(id);
    } else {
      openModal(id);
    }
  });

  // touch: first tap shows overlay, second opens modal (normal mode only)
  wrap.addEventListener('touchend', e => {
    if (selectionMode) return;
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

  // teammate badges
  const badges = wrap.querySelector('.thumb-badges');
  badges.innerHTML = '';
  USERS.forEach(u => {
    const tier = allSelections[u.id][id];
    if (!tier) return;
    if (u.id === currentUser) return;
    const badge = document.createElement('span');
    badge.className = `badge ${tier}`;
    badge.textContent = u.label[0] + (tier === 'love' ? '★★' : '★');
    badges.appendChild(badge);
  });

  // score badge
  const scoreBadge = wrap.querySelector('.score-badge');
  if (scoreBadge) {
    const s = scoreCache[id];
    if (s) {
      scoreBadge.textContent = `${s.score}pt${s.score !== 1 ? 's' : ''} · ★★${s.loves} ★${s.likes}`;
    }
  }

  updateCardSelState(wrap, id);
}

function updateCardSelState(wrap, id) {
  wrap.classList.toggle('sel-selected', finalIds.has(id));
  wrap.classList.toggle('sel-tie', tieZoneIds.has(id));
  const selCheck = wrap.querySelector('.sel-check');
  if (selCheck) selCheck.textContent = finalIds.has(id) ? '✓' : '○';
}

// ── Modal ─────────────────────────────────────────────────────────────────────

function openModal(id) {
  modalId = id;
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
  computeAllScores();
  loadingEl.style.display = 'none';
  gridEl.style.display = 'grid';
  renderChips();
  renderGrid();
  listenToFinalSelection();

  // open photo from hash if present
  const hashId = window.location.hash.slice(1);
  if (hashId && manifest.includes(hashId)) {
    openModal(hashId);
  }
}

init();
