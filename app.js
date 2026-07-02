/* ==========================================================================
   우리집 집밥 레시피 — app.js
   순수 바닐라 JS. 데이터는 IndexedDB에 저장(오프라인/무계정).
   ========================================================================== */
'use strict';

/* ---------- 상수 ---------- */
const CATEGORIES = ['한식', '국·찌개', '반찬', '분식', '양식', '중식', '일식', '간식·베이킹', '기타'];
const TAG_SUGGEST = ['가족최애', '간단', '15분', '든든한', '건강식', '매콤', '아이반찬', '술안주', '손님상', '남은재료'];
const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
const SLOTS = [['breakfast', '아침'], ['lunch', '점심'], ['dinner', '저녁']];
const CAT_EMOJI = { '한식': '🍚', '국·찌개': '🍲', '반찬': '🥢', '분식': '🍜', '양식': '🍝', '중식': '🥡', '일식': '🍱', '간식·베이킹': '🧁', '기타': '🍽️' };

/* 가족 아바타 색 링 — 같은 이모지여도 구성원마다 다르게 보이도록 */
const AVATAR_COLORS = [
  { bg: '#e3f0ff', ring: '#5b9bd5' }, // 파랑
  { bg: '#ffe6ef', ring: '#e5739a' }, // 분홍
  { bg: '#efe6ff', ring: '#9b6fd4' }, // 보라
  { bg: '#e2f6ec', ring: '#4caf50' }, // 초록
  { bg: '#fff1de', ring: '#e8952d' }, // 주황
  { bg: '#e4f6f7', ring: '#40b0bd' }  // 청록
];

/* 웹 검색 대상 사이트 (API 키 불필요, 검색어를 넘겨 새 탭으로 열기) */
const WEB_SITES = [
  { name: '만개의레시피', emoji: '🍳', desc: '국내 최대 레시피 커뮤니티', url: (q) => `https://www.10000recipe.com/recipe/list.html?q=${encodeURIComponent(q)}` },
  { name: '우리의식탁', emoji: '🥗', desc: '깔끔한 사진·계량 레시피', url: (q) => `https://wtable.co.kr/search/recipes?keyword=${encodeURIComponent(q)}` },
  { name: '유튜브', emoji: '▶️', desc: '영상으로 따라 만들기', url: (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q + ' 레시피')}` },
  { name: '구글', emoji: '🌐', desc: '전체 웹에서 검색', url: (q) => `https://www.google.com/search?q=${encodeURIComponent(q + ' 레시피')}` }
];

/* ---------- IndexedDB 초경량 래퍼 ---------- */
const DB = (() => {
  const NAME = 'jipbap-db', VER = 1;
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open(NAME, VER);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('recipes')) db.createObjectStore('recipes', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'k' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      const req = fn(s);
      t.oncomplete = () => resolve(req && req.result);
      t.onerror = () => reject(t.error);
    });
  }
  return {
    allRecipes: () => tx('recipes', 'readonly', (s) => s.getAll()),
    getRecipe: (id) => tx('recipes', 'readonly', (s) => s.get(id)),
    putRecipe: (r) => tx('recipes', 'readwrite', (s) => s.put(r)),
    delRecipe: (id) => tx('recipes', 'readwrite', (s) => s.delete(id)),
    getKV: async (k, def) => { const v = await tx('kv', 'readonly', (s) => s.get(k)); return v ? v.v : def; },
    setKV: (k, v) => tx('kv', 'readwrite', (s) => s.put({ k, v })),
    clearAll: async () => { await tx('recipes', 'readwrite', (s) => s.clear()); await tx('kv', 'readwrite', (s) => s.clear()); }
  };
})();

/* ---------- 앱 상태 ---------- */
const state = {
  tab: 'home',
  recipes: [],
  family: [],            // [{name, emoji}]
  plan: {},              // { '월': {breakfast, lunch, dinner: recipeId} , ... }
  filterCat: '전체',
  activeMember: null,    // 가족 필터
  familyEdit: false,     // 가족 편집 모드
  planMeals: ['breakfast', 'dinner'],  // 자동 추천에 포함할 끼니
  detailId: null,
  editing: null,         // 편집 중인 recipe 또는 null(신규)
  planPick: null         // {day, slot} 식단 배정 대기
};

/* ---------- 유틸 ---------- */
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => 'r' + Date.now().toString(36) + Math.floor(Math.random() * 1e5).toString(36);
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
}
function todayDay() { return DAYS[(new Date().getDay() + 6) % 7]; }

/* ---------- 초기화 ---------- */
async function init() {
  await loadState();
  await seedIfEmpty();
  bindChrome();
  render();
  registerSW();
}

async function loadState() {
  state.recipes = (await DB.allRecipes()) || [];
  state.family = await DB.getKV('family', []);
  state.plan = await DB.getKV('plan', {});
}

async function seedIfEmpty() {
  const seeded = await DB.getKV('seeded', false);
  if (seeded || state.recipes.length) return;
  try {
    const res = await fetch('data/seed-recipes.json', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      for (const r of (data.recipes || [])) {
        r.id = r.id || uid();
        r.createdAt = r.createdAt || Date.now();
        await DB.putRecipe(r);
      }
      if (data.family) { state.family = data.family; await DB.setKV('family', data.family); }
    }
  } catch (e) { /* 오프라인 첫 실행 등: 무시하고 빈 상태로 시작 */ }
  await DB.setKV('seeded', true);
  state.recipes = (await DB.allRecipes()) || [];
}

function bindChrome() {
  $$('.tab').forEach((b) => b.addEventListener('click', () => { state.tab = b.dataset.tab; state.detailId = null; render(); }));
  $('#btn-add').addEventListener('click', () => openEditor(null));
  $('#modal-cancel').addEventListener('click', closeModal);
  $('#modal-save').addEventListener('click', saveEditor);
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
}

function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

/* ==========================================================================
   렌더 라우터
   ========================================================================== */
function render() {
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));
  const titles = { home: '우리집 집밥', recipes: '내 레시피', search: '검색 · 추천', more: '더보기' };
  $('#header-title').textContent = state.detailId ? '레시피' : (titles[state.tab] || '우리집 집밥');
  $('#btn-add').style.display = state.detailId ? 'none' : '';
  const view = $('#view');
  if (state.detailId) { view.innerHTML = viewDetail(state.detailId); bindDetail(); return; }
  if (state.tab === 'home') { view.innerHTML = viewHome(); bindHome(); }
  else if (state.tab === 'recipes') { view.innerHTML = viewRecipes(); bindRecipes(); }
  else if (state.tab === 'search') { view.innerHTML = viewSearch(); bindSearch(); }
  else if (state.tab === 'more') { view.innerHTML = viewMore(); bindMore(); }
  view.scrollTop = 0;
}

/* ---------- 레시피 카드 HTML ---------- */
function recipeCardHTML(r) {
  const thumb = r.photo ? `<img src="${r.photo}" alt="">` : (CAT_EMOJI[r.category] || '🍽️');
  const info = [];
  if (r.timeMin) info.push(`⏱ ${esc(r.timeMin)}분`);
  if (r.servings) info.push(`👥 ${esc(r.servings)}인분`);
  const favs = (r.favoriteOf || []).slice(0, 3).map((n) => `<span class="chip fav">💛 ${esc(n)}</span>`).join('');
  const tags = (r.tags || []).slice(0, 2).map((t) => `<span class="chip">#${esc(t)}</span>`).join('');
  return `<div class="recipe-card" data-id="${r.id}">
    <div class="recipe-thumb">${thumb}</div>
    <div class="recipe-meta">
      <h3>${esc(r.title)}</h3>
      <div class="recipe-info"><span class="chip cat">${esc(r.category || '기타')}</span>${info.map((i) => `<span>${i}</span>`).join('')}</div>
      <div class="recipe-tags">${favs}${tags}</div>
    </div>
  </div>`;
}

/* ==========================================================================
   화면 1: 가족 · 식단
   ========================================================================== */
function viewHome() {
  // 가족별 최애 메뉴
  const editing = state.familyEdit;
  const memberStrip = state.family.map((m, i) => {
    const c = AVATAR_COLORS[i % AVATAR_COLORS.length];
    return `<div class="member-chip ${state.activeMember === m.name ? 'active' : ''} ${editing ? 'editing' : ''}" data-member-idx="${i}">
      ${editing ? `<button class="member-del" data-member-del="${i}">✕</button>` : ''}
      <div class="member-avatar" style="background:${c.bg};box-shadow:inset 0 0 0 2.5px ${c.ring}">${esc(m.emoji || '🙂')}</div>
      <div class="m-name">${esc(m.name)}</div>
    </div>`;
  }).join('') +
    `<div class="member-chip add" data-member-add="1"><div class="member-avatar">＋</div><div class="m-name">추가</div></div>`;

  let favList;
  if (state.activeMember) {
    const favs = state.recipes.filter((r) => (r.favoriteOf || []).includes(state.activeMember));
    favList = favs.length ? favs.map(recipeCardHTML).join('')
      : `<div class="empty"><span class="big">💛</span>${esc(state.activeMember)} 님이 좋아하는 메뉴가 아직 없어요.<br>레시피 편집에서 "가족 최애"에 추가해 보세요.</div>`;
  } else {
    const favs = state.recipes.filter((r) => (r.favoriteOf || []).length);
    favList = favs.length ? favs.slice(0, 6).map(recipeCardHTML).join('')
      : `<div class="empty"><span class="big">🍚</span>가족을 추가하고, 좋아하는 메뉴를 표시해 보세요.</div>`;
  }

  // 이번 주 식단
  const today = todayDay();
  const planHTML = DAYS.map((d) => {
    const day = state.plan[d] || {};
    const slots = SLOTS.map(([key, label]) => {
      const v = day[key];
      let text = '＋', cls = 'empty';
      if (typeof v === 'string') { const r = state.recipes.find((x) => x.id === v); if (r) { text = r.title; cls = ''; } }
      else if (v && v.s) { text = '💡 ' + v.s; cls = 'suggest'; }
      return `<div class="plan-slot" data-day="${d}" data-slot="${key}">
        <div class="slot-label">${label}</div>
        <div class="slot-menu ${cls}">${esc(text)}</div>
      </div>`;
    }).join('');
    return `<div class="plan-day ${d === today ? 'today' : ''}">
      <div class="plan-day-head">${d}요일${d === today ? ' · 오늘' : ''}</div>
      <div class="plan-slots">${slots}</div>
    </div>`;
  }).join('');

  const mealPills = SLOTS.map(([key, label]) =>
    `<button class="filter-pill ${state.planMeals.includes(key) ? 'active' : ''}" data-meal="${key}">${label}</button>`).join('');

  return `
    <div class="section-title">👨‍👩‍👧 가족이 좋아하는 메뉴
      <button class="link-btn" id="fam-edit" style="margin-left:auto;font-size:13px">${editing ? '완료' : '편집'}</button>
    </div>
    <div class="family-strip">${memberStrip}</div>
    <div style="margin-top:12px">${favList}</div>

    <div class="section-title" style="margin-top:26px">🗓 이번 주 식단 <span class="section-sub">칸을 눌러 직접 지정</span></div>
    <div class="reco-plan card">
      <div class="reco-plan-row">
        <span class="reco-plan-label">추천 끼니</span>
        <div class="meal-toggles">${mealPills}</div>
      </div>
      <div class="reco-plan-actions">
        <button class="btn small green" id="reco-week">🎲 일주일 자동 추천</button>
        <button class="btn small ghost" id="clear-week">전체 비우기</button>
      </div>
    </div>
    <div class="plan-grid">${planHTML}</div>
  `;
}

function bindHome() {
  $$('[data-member-idx]').forEach((el) => el.addEventListener('click', (e) => {
    if (e.target.closest('[data-member-del]')) return; // 삭제 버튼은 별도 처리
    const i = +el.dataset.memberIdx;
    if (state.familyEdit) { editMember(i); return; }
    const n = state.family[i].name;
    state.activeMember = state.activeMember === n ? null : n;
    render();
  }));
  $$('[data-member-del]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); deleteMember(+b.dataset.memberDel); }));
  const editBtn = $('#fam-edit');
  if (editBtn) editBtn.addEventListener('click', () => { state.familyEdit = !state.familyEdit; render(); });
  const addBtn = $('[data-member-add]');
  if (addBtn) addBtn.addEventListener('click', addMember);
  $$('[data-meal]').forEach((b) => b.addEventListener('click', () => toggleMeal(b.dataset.meal)));
  $('#reco-week').addEventListener('click', recommendWeek);
  $('#clear-week').addEventListener('click', clearWeek);
  $$('.plan-slot').forEach((el) => el.addEventListener('click', () => pickForPlan(el.dataset.day, el.dataset.slot)));
  $$('.recipe-card').forEach((c) => c.addEventListener('click', () => { state.detailId = c.dataset.id; render(); }));
}

function toggleMeal(key) {
  const has = state.planMeals.includes(key);
  if (has && state.planMeals.length === 1) { toast('최소 한 끼니는 선택해 주세요'); return; }
  state.planMeals = has ? state.planMeals.filter((m) => m !== key)
    : SLOTS.map((s) => s[0]).filter((m) => state.planMeals.includes(m) || m === key); // 아침·점심·저녁 순서 유지
  render();
}

/* 배열을 뒤섞기 (Fisher–Yates) */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/* 아침으로 즐겨 먹는 메뉴 키워드 (볶음밥·죽·스파게티·또띠아·주먹밥 등) */
const BREAKFAST_KEYWORDS = ['죽', '볶음밥', '주먹밥', '스파게티', '파스타', '또띠아', '또띠야', '리조또', '토스트', '오믈렛', '계란', '샌드위치', '시리얼', '누룽지', '오트밀'];

/* 내 레시피가 부족할 때 채워 넣을 인기·적합 메뉴 (💡 추천으로 표시) */
const SUGGEST_BREAKFAST = ['김치볶음밥', '참치마요덮밥', '계란죽', '전복죽', '토마토 스파게티', '크림 스파게티', '베이컨 또띠아', '참치주먹밥', '멸치주먹밥', '삼각김밥', '프렌치토스트', '오트밀', '계란토스트', '북엇국', '스팸김치볶음밥'];
const SUGGEST_DINNER = ['된장찌개', '김치찌개', '제육볶음', '소불고기', '고등어구이', '갈치조림', '닭볶음탕', '순두부찌개', '계란찜', '유부초밥', '김밥', '돈까스', '생선구이', '시래기국', '부대찌개', '갈비찜'];
const SUGGEST_LUNCH = ['비빔밥', '잔치국수', '비빔국수', '볶음우동', '오므라이스', '제육덮밥', '김밥', '카레라이스', '치킨마요덮밥', '냉면'];
function suggestFor(meal) { return meal === 'breakfast' ? SUGGEST_BREAKFAST : meal === 'dinner' ? SUGGEST_DINNER : SUGGEST_LUNCH; }
/* 이름 정규화(괄호·공백 제거)로 레시피/추천 간 중복 판정 */
const normName = (s) => (s || '').replace(/\(.*?\)/g, '').replace(/\s+/g, '').trim();

/* 끼니별 후보 레시피 풀 (아침=볶음밥·죽·스파게티·또띠아 등, 저녁=든든함, 점심=전체) */
function poolForMeal(meal) {
  const all = state.recipes;
  const t = (r) => (r.tags || []).join(' ');
  const has = (r, kw) => kw.some((k) => (r.title || '').includes(k) || t(r).includes(k));
  const min = (r) => Number(r.timeMin) || 999;
  if (meal === 'breakfast') {
    let pool = all.filter((r) => has(r, BREAKFAST_KEYWORDS));
    if (pool.length < 1) pool = all.filter((r) => min(r) <= 20 || has(r, ['간단', '15분', '간식']) || ['반찬', '분식', '간식·베이킹', '양식'].includes(r.category));
    return pool.length ? pool : all;
  }
  if (meal === 'dinner') {
    const pool = all.filter((r) => r.category !== '간식·베이킹' && (['국·찌개', '한식', '중식', '일식', '양식'].includes(r.category) || has(r, ['든든한', '손님상', '가족최애'])));
    return pool.length ? pool : all;
  }
  return all;
}

/* 일주일 자동 추천 — 주간 전역 중복 제거. 내 레시피가 부족하면 인기·적합 메뉴(💡)로 채움 */
async function recommendWeek() {
  const meals = state.planMeals;
  const queues = {}, sugQueues = {};
  meals.forEach((m) => { queues[m] = shuffle(poolForMeal(m)); sugQueues[m] = shuffle(suggestFor(m)); });
  const used = new Set();       // 이번 주 사용 메뉴 이름(정규화) — 레시피·추천 통합
  const plan = {};
  let sugCount = 0;
  DAYS.forEach((d) => {
    plan[d] = Object.assign({}, state.plan[d]); // 추천에서 뺀 끼니(예: 점심)는 기존 값 유지
    meals.forEach((m) => {
      // 1) 내 레시피 중 아직 안 쓴 것
      const r = queues[m].find((x) => !used.has(normName(x.title)));
      if (r) { plan[d][m] = r.id; used.add(normName(r.title)); return; }
      // 2) 없으면 인기·적합 메뉴 추천으로 채움
      const sug = sugQueues[m].find((n) => !used.has(normName(n)));
      if (sug) { plan[d][m] = { s: sug }; used.add(normName(sug)); sugCount++; return; }
      delete plan[d][m];
    });
  });
  state.plan = plan;
  await DB.setKV('plan', state.plan);
  render();
  toast(sugCount ? `일주일 식단 추천 완료 🎲 (💡 표시는 추천 메뉴 ${sugCount}개)` : '일주일 식단을 추천했어요 🎲');
}

async function clearWeek() {
  if (!confirm('이번 주 식단을 모두 비울까요?')) return;
  state.plan = {};
  await DB.setKV('plan', state.plan);
  render(); toast('식단을 비웠어요');
}

/* 이모지를 코드포인트 단위로 안전하게 자르기(피부색·합성 이모지 보존) */
function trimEmoji(s) { return [...(s || '').trim()].slice(0, 8).join('') || '🙂'; }

async function addMember() {
  const name = prompt('가족 구성원 이름을 입력하세요 (예: 아빠, 첫째)');
  if (!name || !name.trim()) return;
  const emoji = prompt('이모지 하나로 표시할까요? (예: 👨🏻 👩🏻 👧🏻 👦🏻)', '🙂');
  state.family.push({ name: name.trim(), emoji: trimEmoji(emoji) });
  await DB.setKV('family', state.family);
  render();
}

async function editMember(i) {
  const m = state.family[i];
  if (!m) return;
  const name = prompt('이름 수정', m.name);
  if (name === null) return;
  const emoji = prompt('이모지 수정 (예: 👨🏻 👩🏻 👧🏻 👦🏻)', m.emoji || '🙂');
  const oldName = m.name;
  m.name = (name.trim() || m.name);
  m.emoji = trimEmoji(emoji);
  // 이름이 바뀌면 레시피의 '가족 최애' 표시도 함께 갱신
  if (oldName !== m.name) {
    for (const r of state.recipes) {
      if ((r.favoriteOf || []).includes(oldName)) {
        r.favoriteOf = r.favoriteOf.map((n) => (n === oldName ? m.name : n));
        await DB.putRecipe(r);
      }
    }
    if (state.activeMember === oldName) state.activeMember = m.name;
  }
  await DB.setKV('family', state.family);
  render();
}

async function deleteMember(i) {
  const m = state.family[i];
  if (!m) return;
  if (!confirm(`'${m.name}' 을(를) 가족에서 삭제할까요?`)) return;
  if (state.activeMember === m.name) state.activeMember = null;
  state.family.splice(i, 1);
  await DB.setKV('family', state.family);
  render();
}

async function pickForPlan(day, slot) {
  if (!state.recipes.length) { toast('먼저 레시피를 추가해 주세요'); return; }
  state.planPick = { day, slot };
  openPlanPicker();
}

/* 식단 배정용 간단 선택 시트 (모달 재사용) */
function openPlanPicker() {
  const { day, slot } = state.planPick;
  const label = SLOTS.find((s) => s[0] === slot)[1];
  $('#modal-title').textContent = `${day}요일 ${label} 메뉴`;
  $('#modal-save').style.display = 'none';
  $('#modal-cancel').textContent = '닫기';
  const list = state.recipes.map((r) =>
    `<button class="more-item" data-pick="${r.id}"><span class="mi-icon">${r.photo ? '🍽️' : (CAT_EMOJI[r.category] || '🍽️')}</span>
      <span><b>${esc(r.title)}</b><span class="mi-sub">${esc(r.category || '')}</span></span></button>`).join('');
  $('#modal-body').innerHTML = `
    <button class="more-item" data-pick="__clear__" style="color:#d4380d"><span class="mi-icon">🗑</span><span><b>비우기</b></span></button>
    <div class="more-group" style="margin-top:10px">${list}</div>`;
  $$('[data-pick]', $('#modal-body')).forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.pick;
    state.plan[day] = state.plan[day] || {};
    if (id === '__clear__') delete state.plan[day][slot]; else state.plan[day][slot] = id;
    await DB.setKV('plan', state.plan);
    closeModal(); render(); toast('식단에 반영했어요');
  }));
  showModal();
}

/* ==========================================================================
   화면 2: 레시피 목록
   ========================================================================== */
function viewRecipes() {
  const cats = ['전체', ...CATEGORIES];
  const pills = cats.map((c) => `<button class="filter-pill ${state.filterCat === c ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
  let list = state.recipes.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  if (state.filterCat !== '전체') list = list.filter((r) => r.category === state.filterCat);
  const body = list.length ? list.map(recipeCardHTML).join('')
    : `<div class="empty"><span class="big">📖</span>${state.recipes.length ? '이 분류에 레시피가 없어요.' : '아직 레시피가 없어요.<br>오른쪽 위 ＋ 로 첫 레시피를 정리해 보세요.'}</div>`;
  return `<div class="filter-bar">${pills}</div><div>${body}</div>`;
}

function bindRecipes() {
  $$('.filter-pill').forEach((p) => p.addEventListener('click', () => { state.filterCat = p.dataset.cat; render(); }));
  $$('.recipe-card').forEach((c) => c.addEventListener('click', () => { state.detailId = c.dataset.id; render(); }));
}

/* ==========================================================================
   화면 3: 검색 · 추천
   ========================================================================== */
function viewSearch() {
  return `
    <div class="section-title">🔍 내 레시피에서 찾기 <span class="section-sub">이름·재료·태그</span></div>
    <div class="search-box"><span class="s-icon">🔍</span><input id="mysearch" type="text" placeholder="예: 김치, 아이반찬, 된장찌개" autocomplete="off"></div>
    <div id="mysearch-result"></div>

    <div class="section-title" style="margin-top:26px">🥗 냉장고 재료로 추천 <span class="section-sub">쉼표로 구분</span></div>
    <div class="search-box"><span class="s-icon">🧺</span><input id="fridge" type="text" placeholder="예: 계란, 대파, 감자" autocomplete="off"></div>
    <div style="margin-top:8px"><button class="btn small green" id="reco-btn">이 재료로 만들 수 있는 메뉴</button></div>
    <div id="reco-result" style="margin-top:12px"></div>

    <div class="section-title" style="margin-top:26px">🌐 웹에서 레시피 검색 <span class="section-sub">외부 사이트로 이동</span></div>
    <div class="search-box"><span class="s-icon">🌐</span><input id="websearch" type="text" placeholder="예: 백종원 김치찌개" autocomplete="off"></div>
    <div class="web-links" id="weblinks" style="margin-top:12px"></div>
  `;
}

function bindSearch() {
  const my = $('#mysearch');
  my.addEventListener('input', () => renderMySearch(my.value.trim()));
  renderMySearch('');

  $('#reco-btn').addEventListener('click', () => renderReco($('#fridge').value));
  $('#fridge').addEventListener('keydown', (e) => { if (e.key === 'Enter') renderReco($('#fridge').value); });

  const web = $('#websearch');
  const renderWeb = () => {
    const q = web.value.trim();
    $('#weblinks').innerHTML = WEB_SITES.map((s) => {
      const href = q ? s.url(q) : '#';
      return `<a class="web-link" ${q ? `href="${href}" target="_blank" rel="noopener"` : 'data-empty="1"'}>
        <span class="wl-emoji">${s.emoji}</span>
        <span><span class="wl-name">${s.name}</span><br><span class="wl-desc">${s.desc}</span></span>
        <span class="wl-arrow">↗</span></a>`;
    }).join('');
    $$('#weblinks [data-empty]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); toast('검색어를 입력해 주세요'); }));
  };
  web.addEventListener('input', renderWeb);
  renderWeb();
}

function renderMySearch(q) {
  const box = $('#mysearch-result');
  if (!q) { box.innerHTML = `<div class="empty" style="padding:24px">저장한 레시피 ${state.recipes.length}개에서 검색합니다.</div>`; return; }
  const nq = q.toLowerCase();
  const hits = state.recipes.filter((r) => {
    const hay = [r.title, r.category, (r.tags || []).join(' '), (r.ingredients || []).map((i) => i.name).join(' '), (r.favoriteOf || []).join(' ')].join(' ').toLowerCase();
    return hay.includes(nq);
  });
  box.innerHTML = hits.length ? hits.map(recipeCardHTML).join('')
    : `<div class="empty"><span class="big">🤔</span>"${esc(q)}" 결과가 없어요. 아래 웹 검색을 써보세요.</div>`;
  $$('.recipe-card', box).forEach((c) => c.addEventListener('click', () => { state.detailId = c.dataset.id; render(); }));
}

function renderReco(raw) {
  const box = $('#reco-result');
  const have = raw.split(/[,，\n]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!have.length) { box.innerHTML = `<div class="empty" style="padding:20px">재료를 쉼표로 입력해 주세요.</div>`; return; }
  const scored = state.recipes.map((r) => {
    const ings = (r.ingredients || []).map((i) => (i.name || '').toLowerCase()).filter(Boolean);
    if (!ings.length) return null;
    const matched = ings.filter((ing) => have.some((h) => ing.includes(h) || h.includes(ing)));
    const missing = ings.filter((ing) => !have.some((h) => ing.includes(h) || h.includes(ing)));
    return { r, ratio: matched.length / ings.length, matched: matched.length, total: ings.length, missing };
  }).filter((x) => x && x.matched > 0).sort((a, b) => b.ratio - a.ratio || a.missing.length - b.missing.length);

  if (!scored.length) { box.innerHTML = `<div class="empty"><span class="big">🧺</span>딱 맞는 레시피가 없어요.<br>웹 검색에서 재료로 찾아보세요.</div>`; return; }
  box.innerHTML = scored.slice(0, 12).map(({ r, ratio, missing }) => {
    const pct = Math.round(ratio * 100);
    const full = ratio >= 0.999;
    const miss = missing.length ? `<div class="reco-missing">부족한 재료: <b>${missing.slice(0, 6).map(esc).join(', ')}</b></div>` : `<div class="reco-missing" style="color:var(--green)">가진 재료로 충분해요! 🎉</div>`;
    return `<div class="card reco-card" data-id="${r.id}">
      <div class="reco-head"><h3>${esc(r.title)}</h3><span class="match-badge ${full ? '' : 'partial'}">${pct}% 준비됨</span></div>
      ${miss}
    </div>`;
  }).join('');
  $$('.reco-card', box).forEach((c) => c.addEventListener('click', () => { state.detailId = c.dataset.id; render(); }));
}

/* ==========================================================================
   상세 보기
   ========================================================================== */
function viewDetail(id) {
  const r = state.recipes.find((x) => x.id === id);
  if (!r) return `<div class="empty">레시피를 찾을 수 없어요.</div>`;
  const hero = r.photo ? `<img src="${r.photo}" alt="">` : (CAT_EMOJI[r.category] || '🍽️');
  const info = [];
  if (r.category) info.push(`🍽 ${esc(r.category)}`);
  if (r.timeMin) info.push(`⏱ ${esc(r.timeMin)}분`);
  if (r.servings) info.push(`👥 ${esc(r.servings)}인분`);
  const favs = (r.favoriteOf || []).map((n) => `<span class="chip fav">💛 ${esc(n)}</span>`).join('');
  const tags = (r.tags || []).map((t) => `<span class="chip">#${esc(t)}</span>`).join('');
  const ings = (r.ingredients || []).filter((i) => i.name).map((i) =>
    `<div class="ingredient-row"><span>${esc(i.name)}</span><span class="amt">${esc(i.amount || '')}</span></div>`).join('') || '<div class="section-sub">재료 정보 없음</div>';
  const steps = (r.steps || []).filter(Boolean).map((s, i) =>
    `<div class="step-row"><div class="step-num">${i + 1}</div><p>${esc(s)}</p></div>`).join('') || '<div class="section-sub">조리 순서 없음</div>';
  const memo = r.memo ? `<div class="detail-block"><h4>메모</h4><p style="white-space:pre-wrap;margin:0">${esc(r.memo)}</p></div>` : '';

  return `
    <button class="link-btn" id="back-btn" style="margin:-4px 0 8px">‹ 뒤로</button>
    <div class="detail-hero">${hero}</div>
    <h2 class="detail-title">${esc(r.title)}</h2>
    <div class="recipe-tags" style="margin-bottom:10px">${favs}${tags}</div>
    <div class="detail-info">${info.map((i) => `<span>${i}</span>`).join('')}</div>
    <div class="detail-block"><h4>🧺 재료</h4>${ings}</div>
    <div class="detail-block"><h4>👩‍🍳 만드는 법</h4>${steps}</div>
    ${memo}
    <div class="detail-actions">
      <button class="btn ghost" id="edit-btn">✏️ 수정</button>
      <button class="btn danger" id="del-btn">🗑 삭제</button>
    </div>
  `;
}

function bindDetail() {
  $('#back-btn').addEventListener('click', () => { state.detailId = null; render(); });
  $('#edit-btn').addEventListener('click', () => openEditor(state.recipes.find((x) => x.id === state.detailId)));
  $('#del-btn').addEventListener('click', async () => {
    if (!confirm('이 레시피를 삭제할까요?')) return;
    await DB.delRecipe(state.detailId);
    state.recipes = await DB.allRecipes();
    state.detailId = null; render(); toast('삭제했어요');
  });
}

/* ==========================================================================
   레시피 편집 모달
   ========================================================================== */
function openEditor(recipe) {
  state.editing = recipe ? JSON.parse(JSON.stringify(recipe)) : {
    id: null, title: '', category: '한식', servings: '', timeMin: '',
    ingredients: [{ name: '', amount: '' }], steps: [''], tags: [], favoriteOf: [], memo: '', photo: null
  };
  const r = state.editing;
  $('#modal-title').textContent = recipe ? '레시피 수정' : '레시피 추가';
  $('#modal-save').style.display = '';
  $('#modal-save').textContent = '저장';
  $('#modal-cancel').textContent = '취소';

  const catOpts = CATEGORIES.map((c) => `<option ${r.category === c ? 'selected' : ''}>${c}</option>`).join('');
  const tagBtns = TAG_SUGGEST.map((t) => `<button type="button" data-tag="${t}" class="${(r.tags || []).includes(t) ? 'on' : ''}">#${t}</button>`).join('');
  const famBtns = state.family.length
    ? state.family.map((m) => `<button type="button" data-fav="${esc(m.name)}" class="${(r.favoriteOf || []).includes(m.name) ? 'on' : ''}">${esc(m.emoji)} ${esc(m.name)}</button>`).join('')
    : '<span class="section-sub">가족·식단 탭에서 가족을 먼저 추가하면 여기서 표시돼요.</span>';

  $('#modal-body').innerHTML = `
    <div class="field">
      <label>메뉴 이름</label>
      <input type="text" id="f-title" value="${esc(r.title)}" placeholder="예: 엄마표 김치찌개">
    </div>
    <div class="photo-picker field">
      <div class="photo-preview" id="f-photo-prev">${r.photo ? `<img src="${r.photo}">` : '📷'}</div>
      <div>
        <button type="button" class="btn ghost small" id="f-photo-btn">사진 선택</button>
        ${r.photo ? '<button type="button" class="btn danger small" id="f-photo-clear" style="margin-top:6px">사진 제거</button>' : ''}
        <input type="file" id="f-photo" accept="image/*" style="display:none">
      </div>
    </div>
    <div class="row-2">
      <div class="field"><label>분류</label><select id="f-cat">${catOpts}</select></div>
      <div class="field"><label>인분</label><input type="number" id="f-serv" value="${esc(r.servings)}" placeholder="2" min="0"></div>
      <div class="field"><label>시간(분)</label><input type="number" id="f-time" value="${esc(r.timeMin)}" placeholder="30" min="0"></div>
    </div>
    <div class="field">
      <label>재료 <span class="hint">이름 / 분량</span></label>
      <div class="dyn-list" id="f-ings"></div>
      <button type="button" class="dyn-add" id="add-ing">＋ 재료 추가</button>
    </div>
    <div class="field">
      <label>만드는 법 <span class="hint">순서대로</span></label>
      <div class="dyn-list" id="f-steps"></div>
      <button type="button" class="dyn-add" id="add-step">＋ 순서 추가</button>
    </div>
    <div class="field">
      <label>💛 가족 최애 <span class="hint">이 메뉴를 좋아하는 사람</span></label>
      <div class="tag-suggest" id="f-fav">${famBtns}</div>
    </div>
    <div class="field">
      <label>태그</label>
      <div class="tag-suggest" id="f-tags">${tagBtns}</div>
    </div>
    <div class="field">
      <label>메모 <span class="hint">팁·유래·주의점 등</span></label>
      <textarea id="f-memo" placeholder="예: 신김치일수록 맛있음. 돼지고기는 앞다리살로.">${esc(r.memo || '')}</textarea>
    </div>
  `;
  renderDynIngs(); renderDynSteps();

  // 이벤트
  $('#add-ing').addEventListener('click', () => { r.ingredients.push({ name: '', amount: '' }); renderDynIngs(); });
  $('#add-step').addEventListener('click', () => { r.steps.push(''); renderDynSteps(); });
  $$('#f-tags [data-tag]').forEach((b) => b.addEventListener('click', () => {
    const t = b.dataset.tag; r.tags = r.tags || [];
    if (r.tags.includes(t)) r.tags = r.tags.filter((x) => x !== t); else r.tags.push(t);
    b.classList.toggle('on');
  }));
  $$('#f-fav [data-fav]').forEach((b) => b.addEventListener('click', () => {
    const n = b.dataset.fav; r.favoriteOf = r.favoriteOf || [];
    if (r.favoriteOf.includes(n)) r.favoriteOf = r.favoriteOf.filter((x) => x !== n); else r.favoriteOf.push(n);
    b.classList.toggle('on');
  }));
  $('#f-photo-btn').addEventListener('click', () => $('#f-photo').click());
  $('#f-photo').addEventListener('change', onPhotoPick);
  const clr = $('#f-photo-clear');
  if (clr) clr.addEventListener('click', () => { r.photo = null; openEditor(r); });

  showModal();
  setTimeout(() => $('#f-title').focus(), 100);
}

function renderDynIngs() {
  const r = state.editing;
  $('#f-ings').innerHTML = r.ingredients.map((ing, i) =>
    `<div class="dyn-row">
      <input type="text" data-ing-name="${i}" value="${esc(ing.name)}" placeholder="재료 (예: 김치)">
      <input type="text" class="amt-in" data-ing-amt="${i}" value="${esc(ing.amount)}" placeholder="분량">
      <button type="button" class="dyn-del" data-ing-del="${i}">×</button>
    </div>`).join('');
  $$('#f-ings [data-ing-name]').forEach((el) => el.addEventListener('input', () => r.ingredients[+el.dataset.ingName].name = el.value));
  $$('#f-ings [data-ing-amt]').forEach((el) => el.addEventListener('input', () => r.ingredients[+el.dataset.ingAmt].amount = el.value));
  $$('#f-ings [data-ing-del]').forEach((el) => el.addEventListener('click', () => { r.ingredients.splice(+el.dataset.ingDel, 1); if (!r.ingredients.length) r.ingredients.push({ name: '', amount: '' }); renderDynIngs(); }));
}

function renderDynSteps() {
  const r = state.editing;
  $('#f-steps').innerHTML = r.steps.map((s, i) =>
    `<div class="dyn-row">
      <span class="step-num" style="margin-top:8px">${i + 1}</span>
      <input type="text" data-step="${i}" value="${esc(s)}" placeholder="조리 순서">
      <button type="button" class="dyn-del" data-step-del="${i}">×</button>
    </div>`).join('');
  $$('#f-steps [data-step]').forEach((el) => el.addEventListener('input', () => r.steps[+el.dataset.step] = el.value));
  $$('#f-steps [data-step-del]').forEach((el) => el.addEventListener('click', () => { r.steps.splice(+el.dataset.stepDel, 1); if (!r.steps.length) r.steps.push(''); renderDynSteps(); }));
}

function onPhotoPick(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const img = new Image();
  const reader = new FileReader();
  reader.onload = () => {
    img.onload = () => {
      // 사진을 리사이즈(최대 900px)해 용량 절감
      const max = 900;
      let { width, height } = img;
      if (width > max || height > max) { const s = max / Math.max(width, height); width = Math.round(width * s); height = Math.round(height * s); }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      state.editing.photo = canvas.toDataURL('image/jpeg', 0.8);
      $('#f-photo-prev').innerHTML = `<img src="${state.editing.photo}">`;
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

async function saveEditor() {
  const r = state.editing;
  r.title = $('#f-title').value.trim();
  if (!r.title) { toast('메뉴 이름을 입력해 주세요'); $('#f-title').focus(); return; }
  r.category = $('#f-cat').value;
  r.servings = $('#f-serv').value;
  r.timeMin = $('#f-time').value;
  r.memo = $('#f-memo').value.trim();
  r.ingredients = r.ingredients.filter((i) => (i.name || '').trim());
  r.steps = r.steps.map((s) => s.trim()).filter(Boolean);
  if (!r.id) { r.id = uid(); r.createdAt = Date.now(); }
  r.updatedAt = Date.now();
  await DB.putRecipe(r);
  state.recipes = await DB.allRecipes();
  closeModal();
  toast(r.createdAt === r.updatedAt ? '레시피를 저장했어요' : '수정했어요');
  if (state.detailId) render();
}

/* ==========================================================================
   화면 4: 더보기 (백업/복원/GitHub 안내)
   ========================================================================== */
function viewMore() {
  const n = state.recipes.length;
  return `
    <div class="section-title">💾 데이터 관리</div>
    <div class="more-group">
      <button class="more-item" id="export-btn"><span class="mi-icon">⬇️</span><span><b>백업 파일 내보내기</b><span class="mi-sub">레시피 ${n}개 · 가족 · 식단을 .json 으로 저장</span></span><span class="mi-arrow">›</span></button>
      <button class="more-item" id="import-btn"><span class="mi-icon">⬆️</span><span><b>백업 파일 불러오기</b><span class="mi-sub">다른 폰/PC의 백업을 이 기기로 복원</span></span><span class="mi-arrow">›</span></button>
      <input type="file" id="import-file" accept="application/json,.json" style="display:none">
    </div>

    <div class="section-title">📱 앱으로 설치</div>
    <div class="card" style="padding:16px;font-size:13.5px;color:var(--ink-soft);line-height:1.7">
      <b style="color:var(--ink)">폰에 설치하기</b><br>
      • <b>아이폰(Safari)</b>: 공유 <b>􀈂</b> → "홈 화면에 추가"<br>
      • <b>안드로이드(Chrome)</b>: 메뉴 ⋮ → "앱 설치" / "홈 화면에 추가"<br>
      설치하면 앱처럼 열리고 오프라인에서도 동작해요.
    </div>

    <div class="section-title">☁️ GitHub 배포</div>
    <div class="card" style="padding:16px;font-size:13.5px;color:var(--ink-soft);line-height:1.7">
      이 앱은 서버가 필요 없어 <b style="color:var(--ink)">GitHub Pages</b>로 무료 배포됩니다.<br>
      저장소에 <code>jipbap-app</code> 폴더를 올리고 Pages를 켜면 폰에서 접속할 주소가 생겨요.<br>
      자세한 순서는 폴더 안 <b>README.md</b> 를 참고하세요.
    </div>

    <div class="section-title">⚠️ 데이터 저장 위치</div>
    <div class="card" style="padding:16px;font-size:13px;color:var(--ink-soft);line-height:1.7">
      추가한 레시피는 <b>이 기기 안(브라우저 저장소)</b>에 보관돼요. 기기를 바꾸거나 브라우저 데이터를 지우면 사라질 수 있으니, 가끔 <b>백업 내보내기</b>로 파일을 보관해 두세요.
    </div>
    <div style="height:20px"></div>
  `;
}

function bindMore() {
  $('#export-btn').addEventListener('click', exportData);
  $('#import-btn').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', importData);
}

async function exportData() {
  const data = {
    app: 'jipbap-recipe', version: 1,
    exportedAt: new Date().toISOString(),
    recipes: state.recipes, family: state.family, plan: state.plan
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date().toISOString().slice(0, 10);
  a.href = url; a.download = `집밥백업_${d}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  toast('백업 파일을 저장했어요');
}

function importData(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data.recipes) throw new Error('형식 오류');
      if (!confirm(`백업을 불러오면 현재 데이터와 합쳐집니다.\n레시피 ${data.recipes.length}개를 가져올까요?`)) return;
      for (const r of data.recipes) { r.id = r.id || uid(); await DB.putRecipe(r); }
      if (data.family && data.family.length) { state.family = data.family; await DB.setKV('family', data.family); }
      if (data.plan) { state.plan = Object.assign(state.plan, data.plan); await DB.setKV('plan', state.plan); }
      state.recipes = await DB.allRecipes();
      toast('백업을 불러왔어요'); render();
    } catch (err) { toast('불러오기 실패: 올바른 백업 파일이 아니에요'); }
    e.target.value = '';
  };
  reader.readAsText(file);
}

/* ---------- 모달 헬퍼 ---------- */
function showModal() { const m = $('#modal'); m.classList.remove('hidden'); m.setAttribute('aria-hidden', 'false'); }
function closeModal() { const m = $('#modal'); m.classList.add('hidden'); m.setAttribute('aria-hidden', 'true'); state.editing = null; state.planPick = null; }

/* ---------- 시작 ---------- */
init();
