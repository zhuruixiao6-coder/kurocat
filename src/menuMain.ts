import './style.css';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { DEFAULT_TAIL_KEY_IDS, type KeyboardOrientation, type TailKeyMode } from './catEngine';
import { DEFAULT_BUILTIN_CATS, type CatSkinConfig } from './catSkins';
import type { KeyboardLayoutId } from './keyboardLayout';
import { ACCESSORY_ART, EFFECT_ART } from './collectibles';
import {
  CATALOG,
  RARITY_COLOR,
  SLOT_LABEL,
  currentWeek,
  itemById,
  releasedItems,
  upcomingCount,
  type CatalogItem,
} from './catalog';
import { AccPreview } from './preview3d';

interface AppSettings {
  x: number | null;
  y: number | null;
  scale: number;
  alwaysOnTop: boolean;
  clickThroughLocked: boolean;
  showKeyBubbles: boolean;
  idlePlay?: boolean;
  idlePlaySec?: number;
  soundEnabled: boolean;
  autostart: boolean;
  catBreed: string;
  mcpEnabled: boolean;
  mcpPort: number;
  keyboardLayout: KeyboardLayoutId;
  keyboardPreset?: string;
  kbRgbMode?: number;
  kbRgbBright?: number;
  kbRgbSpeed?: number;
  keyboardOrientation: KeyboardOrientation;
  privacyPasswordGuard: boolean;
  tailKeyMode: TailKeyMode;
  tailKeyIds: string[];
  obsEnabled: boolean;
  obsPort: number;
  obsHidePet: boolean;
  renderMode?: '2d' | '3d';
  collarColor?: 'none' | 'red' | 'blue' | 'pink' | 'green';
  headphoneMode?: 'auto' | 'on' | 'off';
  keySoundEnabled?: boolean;
  keySoundVolume?: number;
  keySoundStyle?: string;
  keySoundPack?: string;
}

interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  releaseUrl: string;
  assetName: string | null;
  downloadUrl: string | null;
  assetSha256: string | null;
  assetSize: number | null;
  installKind: string;
  notesSummary: string;
}

interface UpdateProgressEvent {
  stage: 'checking' | 'available' | 'up_to_date' | 'downloading' | 'verifying' | 'installing' | 'error';
  message: string;
  info?: UpdateInfo | null;
}

type MenuTabId = 'appearance' | 'system' | 'shop' | 'owned';

const isMacPlatform = (): boolean =>
  /Mac/i.test(navigator.platform) || /Macintosh/i.test(navigator.userAgent);

const TAIL_MODE_LABELS: Record<TailKeyMode, string> = {
  smart: '智能第三只手',
  custom: '自定义按键',
  edge: '近尾边缘区',
  off: '仅摆动',
};

let settings: AppSettings = {
  x: null,
  y: null,
  scale: 1,
  alwaysOnTop: true,
  clickThroughLocked: false,
  showKeyBubbles: true,
  idlePlay: true,
  idlePlaySec: 30,
  soundEnabled: true,
  autostart: false,
  catBreed: 'black',
  mcpEnabled: false,
  mcpPort: 27420,
  keyboardLayout: '65',
  keyboardPreset: '',
  kbRgbMode: 1,
  kbRgbBright: 0.85,
  kbRgbSpeed: 1,
  keyboardOrientation: 'cat',
  privacyPasswordGuard: true,
  tailKeyMode: 'smart',
  tailKeyIds: [...DEFAULT_TAIL_KEY_IDS],
  obsEnabled: false,
  obsPort: 27421,
  obsHidePet: false,
  renderMode: '3d',
  collarColor: 'none',
  headphoneMode: 'off',
};

let catList: CatSkinConfig[] = [...DEFAULT_BUILTIN_CATS];
let sliderDragging = false;
let currentAppVersion = '5.1.0';
let cachedUpdateInfo: UpdateInfo | null = null;
let updateBusy = false;
let activeTab: MenuTabId = 'appearance';

const menuEl = document.getElementById('context-menu') as HTMLDivElement;
const tabBodyEl = document.getElementById('menu-tab-body') as HTMLDivElement | null;
const breedPillsEl = document.getElementById('breed-pills') as HTMLDivElement;
const scaleSliderEl = document.getElementById('scale-slider') as HTMLInputElement;
const scaleValueEl = document.getElementById('scale-value') as HTMLButtonElement;
const tailModeBadgeEl = document.getElementById('tail-mode-badge') as HTMLSpanElement;
const tailKeysCountEl = document.getElementById('tail-keys-count') as HTMLSpanElement;
const btnObsHideEl = document.getElementById('btn-obs-hide') as HTMLButtonElement;
const btnContactAuthorEl = document.getElementById('btn-contact-author') as HTMLButtonElement | null;
const keysoundSliderEl = document.getElementById('keysound-slider') as HTMLInputElement | null;
const keysoundValueEl = document.getElementById('keysound-value') as HTMLElement | null;
const keysoundRowEl = document.getElementById('keysound-row') as HTMLDivElement | null;
const keysoundCustomHintEl = document.getElementById('keysound-custom-hint') as HTMLElement | null;
const packSelectEl = document.getElementById('keysound-pack') as HTMLSelectElement | null;
const kbPresetEl = document.getElementById('kb-preset') as HTMLSelectElement | null;
const shopGridEl = document.getElementById('shop-grid') as HTMLDivElement | null;
const shopFishEl = document.getElementById('shop-fish') as HTMLElement | null;
const shopRateEl = document.getElementById('shop-rate') as HTMLElement | null;
const shopWeekEl = document.getElementById('shop-week') as HTMLElement | null;
const ownedGridEl = document.getElementById('owned-grid') as HTMLDivElement | null;
const ownedCountEl = document.getElementById('owned-count') as HTMLElement | null;
const ownedEquippedEl = document.getElementById('owned-equipped') as HTMLElement | null;
const ownedSearchEl = document.getElementById('owned-search') as HTMLInputElement | null;

interface FishProfile {
  totalKeys: number;
  todayKeys: number;
  today: string;
  fish: number;
  keyRemainder: number;
  owned: string[];
  equipped: Record<string, string>;
  bubble: boolean;
}

interface ShopItem {
  id: string;
  name: string;
  desc: string;
  kind: 'equip' | 'unlock' | string;
  slot: string;
  price: number;
}

const KEYS_PER_CAT_STICK = 50;
let shopFilter = 'all';
let shopPreviewAll = false;
let ownedFilter = 'all';
let ownedQuery = '';
let fishProfile: FishProfile | null = null;
let shopFlash = '';
let shopFlashTimer: number | undefined;

/** 商城/已拥有的 1:1 预览（懒创建：只在打开商店时才建 WebGL 上下文） */
let previewer: AccPreview | null = null;
const fxPreviewCache = new Map<string, string>();
let shotQueue: Array<{ el: HTMLElement; item: CatalogItem }> = [];
let shotTimer = 0;

function previewUrl(item: CatalogItem): string {
  if (item.kind === 'effect') {
    const hit = fxPreviewCache.get(item.id);
    if (hit) return hit;
    const canvas = document.createElement('canvas');
    canvas.width = 148;
    canvas.height = 148;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const glow = ctx.createRadialGradient(66, 78, 4, 66, 78, 58);
      glow.addColorStop(0, `${item.c1}cc`);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(66, 78, 58, 0, Math.PI * 2);
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const glyph = item.icon || '✨';
      ctx.font = '44px "Segoe UI Emoji", system-ui, sans-serif';
      ctx.fillText(glyph, 66, 72);
      const spots: Array<[number, number, number]> = [
        [28, 40, 0.9], [104, 46, 0.75], [36, 104, 0.65], [98, 100, 0.8], [66, 26, 0.6],
      ];
      for (const [x, y, a] of spots) {
        ctx.globalAlpha = a;
        ctx.font = '16px "Segoe UI Emoji", system-ui, sans-serif';
        ctx.fillText(glyph, x, y);
      }
      ctx.globalAlpha = 1;
    }
    const url = canvas.toDataURL('image/png');
    fxPreviewCache.set(item.id, url);
    return url;
  }
  if (!previewer) previewer = new AccPreview(148);
  return previewer.render(item);
}

let bigPreviewer: AccPreview | null = null;
const bigFxCache = new Map<string, string>();
let modalItemId = '';

function bigPreviewUrl(item: CatalogItem): string {
  if (item.kind === 'effect') {
    const hit = bigFxCache.get(item.id);
    if (hit) return hit;
    const canvas = document.createElement('canvas');
    canvas.width = 352;
    canvas.height = 352;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const glow = ctx.createRadialGradient(160, 180, 8, 160, 180, 150);
      glow.addColorStop(0, `${item.c1}dd`);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(160, 180, 150, 0, Math.PI * 2);
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const glyph = item.icon || '✨';
      ctx.font = '110px "Segoe UI Emoji", system-ui, sans-serif';
      ctx.fillText(glyph, 160, 170);
      const spots: Array<[number, number, number, number]> = [
        [64, 92, 46, 0.9], [258, 110, 40, 0.75], [86, 258, 34, 0.65], [240, 250, 42, 0.8], [160, 48, 30, 0.6],
      ];
      for (const [x, y, size, alpha] of spots) {
        ctx.globalAlpha = alpha;
        ctx.font = `${size}px "Segoe UI Emoji", system-ui, sans-serif`;
        ctx.fillText(glyph, x, y);
      }
      ctx.globalAlpha = 1;
    }
    const url = canvas.toDataURL('image/png');
    bigFxCache.set(item.id, url);
    return url;
  }
  if (!bigPreviewer) bigPreviewer = new AccPreview(352);
  return bigPreviewer.render(item);
}

function ownedSet(): Set<string> {
  return new Set(fishProfile?.owned ?? []);
}

function equippedSet(): Set<string> {
  return new Set(Object.values(fishProfile?.equipped ?? {}));
}

function openAccModal(id: string): void {
  const item = itemById(id);
  const modal = document.getElementById('acc-modal');
  if (!item || !modal) return;
  modalItemId = id;
  const have = ownedSet().has(id);
  const isEquipped = equippedSet().has(id);
  const locked = item.week > currentWeek();
  const fish = Math.max(0, Math.round(fishProfile?.fish ?? 0));

  // 先把弹层显示出来，再补大图 —— 大图渲染失败也不影响面板可用
  modal.classList.remove('hidden');
  const title = document.getElementById('acc-title');
  if (title) title.textContent = item.name;
  const sub = document.getElementById('acc-sub');
  if (sub) sub.textContent = `${SLOT_LABEL[item.slot] ?? item.slot} · ${item.rarity} · ${item.trigger}`;
  const desc = document.getElementById('acc-desc');
  if (desc) desc.textContent = item.desc || '';

  const act = document.getElementById('acc-act') as HTMLButtonElement | null;
  if (act) {
    act.classList.toggle('owned', have);
    if (locked) {
      act.textContent = `第 ${item.week + 1} 周解锁`;
      act.disabled = true;
    } else if (isEquipped) {
      act.textContent = '取下';
      act.disabled = false;
    } else if (have) {
      act.textContent = '装备';
      act.disabled = false;
    } else if (fish < item.price) {
      act.textContent = `还差 ${item.price - fish} 根猫条`;
      act.disabled = true;
    } else {
      act.textContent = `兑换 · ${item.price} 猫条`;
      act.disabled = false;
    }
  }

  const big = document.getElementById('acc-big');
  if (big) {
    let url = '';
    try {
      url = bigPreviewUrl(item);
    } catch (err) {
      try {
        url = previewUrl(item);
      } catch {
        url = '';
        if (desc) desc.textContent = `预览渲染失败：${String(err).slice(0, 80)}`;
      }
    }
    if (url) big.innerHTML = `<img src="${url}" alt="">`;
  }
}

function closeAccModal(): void {
  document.getElementById('acc-modal')?.classList.add('hidden');
  modalItemId = '';
}

/** 预览图渲染排队：每帧最多 12ms，避免打开商店时卡住 */
function queueShot(el: HTMLElement, item: CatalogItem): void {
  shotQueue.push({ el, item });
  if (!shotTimer) shotTimer = window.setTimeout(drainShots, 0);
}

function drainShots(): void {
  shotTimer = 0;
  const started = performance.now();
  while (shotQueue.length && performance.now() - started < 12) {
    const job = shotQueue.shift();
    if (!job || !job.el.isConnected) continue;
    try {
      job.el.innerHTML = `<img src="${previewUrl(job.item)}" alt="" draggable="false">`;
      job.el.classList.add('ready');
    } catch {
      job.el.classList.add('ready');
    }
  }
  if (shotQueue.length) shotTimer = window.setTimeout(drainShots, 16);
}

function bindShots(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('[data-shot]').forEach((el) => {
    const id = el.dataset.shot;
    if (!id) return;
    const item = itemById(id);
    if (item) queueShot(el, item);
  });
}

const KEY_SOUND_STYLES = [
  'mechanical',
  'blue',
  'thock',
  'soft',
  'typewriter',
  'bubble',
  'woodblock',
  'droplet',
  'coin',
  'meow',
  'custom',
] as const;
type KeySoundStyleId = (typeof KEY_SOUND_STYLES)[number];

function normalizeKeySoundStyle(raw: string | undefined): KeySoundStyleId {
  const id = (raw || '').trim().toLowerCase();
  return (KEY_SOUND_STYLES as readonly string[]).includes(id) ? (id as KeySoundStyleId) : 'mechanical';
}

function currentKeySoundVolume(): number {
  const n = Number(settings.keySoundVolume);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 55;
}

function isKeySoundOn(): boolean {
  return settings.keySoundEnabled !== false;
}

function updateKeySoundSliderVisual(vol: number): void {
  const pctNum = Math.max(0, Math.min(100, Math.round(vol)));
  if (keysoundSliderEl) {
    keysoundSliderEl.value = String(pctNum);
    keysoundSliderEl.style.setProperty('--pct', `${pctNum}%`);
  }
  if (keysoundValueEl) {
    keysoundValueEl.textContent = `${pctNum}%`;
  }
}

interface CustomPackInfo {
  name: string;
  kind: string;
  count: number;
}

let customPacks: CustomPackInfo[] = [];
let customLoaded: { count: number; pack: string } | null = null;

function currentPackName(): string {
  return typeof settings.keySoundPack === 'string' ? settings.keySoundPack : '';
}

function updateCustomSoundHint(): void {
  if (!keysoundCustomHintEl) return;
  const current = currentPackName();
  if (customPacks.length === 0) {
    keysoundCustomHintEl.classList.remove('ok');
    keysoundCustomHintEl.classList.add('warn');
    keysoundCustomHintEl.textContent =
      '还没有音效包：点「打开音效文件夹」，把音效包文件夹放进去';
    return;
  }
  const pack = customPacks.find((p) => p.name === current) ?? customPacks[0];
  const label = pack.name || '散装音效';
  const live = customLoaded && customLoaded.pack === pack.name;
  const count = live ? customLoaded!.count : pack.count;
  keysoundCustomHintEl.classList.toggle('ok', count > 0);
  keysoundCustomHintEl.classList.toggle('warn', count <= 0);
  if (count <= 0) {
    keysoundCustomHintEl.textContent = `「${label}」里没有可用的音频`;
    keysoundCustomHintEl.title = keysoundCustomHintEl.textContent;
    return;
  }
  keysoundCustomHintEl.textContent = live
    ? `正在使用「${label}」·${count} 个按键样本`
    : `已选「${label}」·${count} 个按键样本`;
  keysoundCustomHintEl.title = `音效包：${label}（${count} 个按键样本）`;
}

function renderPackOptions(): void {
  if (!packSelectEl) return;
  const current = currentPackName();
  packSelectEl.innerHTML = '';
  if (customPacks.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '（还没有音效包）';
    packSelectEl.appendChild(opt);
    packSelectEl.disabled = true;
    updateCustomSoundHint();
    return;
  }
  packSelectEl.disabled = false;
  let matched = false;
  for (const pack of customPacks) {
    const opt = document.createElement('option');
    opt.value = pack.name;
    opt.textContent = pack.name || '散装音效';
    if (pack.name === current) {
      opt.selected = true;
      matched = true;
    }
    packSelectEl.appendChild(opt);
  }
  if (!matched) {
    packSelectEl.selectedIndex = 0;
    const first = customPacks[0];
    if (first && first.name !== current) {
      void applySettingsPatch({ keySoundPack: first.name });
    }
  }
  updateCustomSoundHint();
}

async function refreshCustomSoundInfo(): Promise<void> {
  try {
    const packs = await invoke<CustomPackInfo[]>('list_custom_packs');
    customPacks = Array.isArray(packs) ? packs : [];
  } catch {
    customPacks = [];
  }
  renderPackOptions();
}

function syncKeySoundControls(): void {
  const on = isKeySoundOn();
  const style = normalizeKeySoundStyle(settings.keySoundStyle);
  updateKeySoundSliderVisual(currentKeySoundVolume());
  document.querySelectorAll<HTMLButtonElement>('[data-keysoundstyle]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.keysoundstyle === style);
  });
  keysoundRowEl?.classList.toggle('keysound-off', !on);
}

function switchTab(nextTab: MenuTabId): void {
  activeTab = nextTab;
  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((btn) => {
    const isActive = btn.dataset.tab === activeTab;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  document.querySelectorAll<HTMLElement>('[data-tab-panel]').forEach((panel) => {
    panel.classList.toggle('hidden', panel.dataset.tabPanel !== activeTab);
  });
  if (tabBodyEl) {
    tabBodyEl.scrollTop = 0;
  }
  if (activeTab === 'system') {
    void refreshAdminHint();
  }
  if (activeTab === 'shop') {
    renderShop();
    void refreshShop();
  } else if (activeTab === 'owned') {
    renderOwned();
    void refreshShop();
  }
}

const FEEDBACK_URL = 'https://github.com/zhuruixiao6-coder/kurocat/issues';
let contactHintTimer: number | undefined;

/**
 * 「检查更新」入口已经换成「问题反馈」，这里保留一个空实现，
 * 防止旧的更新状态事件把底部按钮的文字改回去。
 */
function renderFooterUpdateState(_customLabel?: string, _ready = false): void {
  if (btnContactAuthorEl) btnContactAuthorEl.classList.remove('update-ready');
}

function legacyCopyText(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

async function openFeedback(): Promise<void> {
  try {
    await invoke('open_release_page', { url: FEEDBACK_URL });
  } catch {
    /* 打不开就算了，不做额外提示 */
  }
  const hint = document.getElementById('contact-hint');
  if (!hint) return;
  hint.textContent = '✓ 已打开反馈页';
  if (contactHintTimer) window.clearTimeout(contactHintTimer);
  contactHintTimer = window.setTimeout(() => {
    hint.textContent = '💬 问题反馈';
  }, 2200);
}

function closeMenu(): void {
  void invoke('close_context_menu');
}

function updateScaleSliderVisual(scaleVal: number): void {
  const pctNum = Math.round(Math.max(20, Math.min(150, scaleVal * 100)));
  if (scaleSliderEl) {
    scaleSliderEl.value = String(pctNum);
    const fillPct = ((pctNum - 20) / (150 - 20)) * 100;
    scaleSliderEl.style.setProperty('--pct', `${fillPct.toFixed(1)}%`);
  }
  if (scaleValueEl) {
    scaleValueEl.textContent = `${pctNum}%`;
  }
}

function renderBreedPills(): void {
  if (!breedPillsEl) return;
  breedPillsEl.innerHTML = '';
  for (const cat of catList) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'breed-pill';
    btn.dataset.breed = cat.id;
    const emoji = cat.emoji ? `${cat.emoji} ` : '🐱 ';
    btn.textContent = `${emoji}${cat.name}`;
    const accent = cat.accentColor || (cat.id === 'ragdoll' ? '#7ac7ff' : '#c8f538');
    btn.style.setProperty('--pill-accent', accent);
    btn.classList.toggle('active', cat.id === settings.catBreed);
    breedPillsEl.appendChild(btn);
  }
}

function shopIcon(id: string): string {
  const s = 'fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round" stroke-linecap="round"';
  const fx = EFFECT_ART[id];
  if (fx) return `<text x="8" y="12.4" text-anchor="middle" font-size="11">${fx.icon}</text>`;
  const acc = ACCESSORY_ART[id];
  const shape = acc?.shape;
  if (shape) {
    switch (shape) {
      case 'cap':
        return `<path d="M2.6 9.4a5.4 5.4 0 0 1 10.8 0z" ${s}/><path d="M1.6 9.4h12.8" ${s}/>`;
      case 'beanie':
        return `<path d="M2.8 10a5.2 5.2 0 0 1 10.4 0z" ${s}/><path d="M2.2 10h11.6" ${s}/><circle cx="8" cy="2.6" r="1.2" ${s}/>`;
      case 'coneHat':
      case 'partyHat':
        return `<path d="M3.6 10.6 8 2l4.4 8.6z" ${s}/><path d="M2.6 10.6h10.8" ${s}/>`;
      case 'chefHat':
        return `<path d="M4 10.4v-2a2.4 2.4 0 0 1 .3-4.4 2.6 2.6 0 0 1 4.9-.6 2.4 2.4 0 0 1 2.2 4.2v2.8z" ${s}/>`;
      case 'hood':
        return `<path d="M3 10.4a5 5 0 0 1 10 0" ${s}/><circle cx="6.2" cy="6.4" r="1.1" ${s}/><circle cx="9.8" cy="6.4" r="1.1" ${s}/>`;
      case 'earband':
        return `<path d="M3 10.4a5 5 0 0 1 10 0" ${s}/><path d="M4.4 5.4 3 2.6 5.6 3.9M11.6 5.4 13 2.6 10.4 3.9" ${s}/>`;
      case 'antler':
        return `<path d="M3 10.4a5 5 0 0 1 10 0" ${s}/><path d="M4.6 6.2 3.4 2.4M11.4 6.2l1.2-3.8" ${s}/>`;
      case 'crown':
        return `<path d="M2.6 10.4V6l2.4 2.4L8 4.4l2.9 4L13 6v4.4z" ${s}/>`;
      case 'nightcap':
        return `<path d="M3.4 10.4c.8-4.2 3.2-6.8 7.2-6.2-1.8 1.4-2 3.2-1 6.2z" ${s}/><path d="M2.8 10.4h7.6" ${s}/>`;
      case 'earmuff':
        return `<path d="M3 9.6a5 5 0 0 1 10 0" ${s}/><rect x="1.6" y="8.4" width="3" height="4" rx="1.4" ${s}/><rect x="11.4" y="8.4" width="3" height="4" rx="1.4" ${s}/>`;
      case 'glassesRound':
      case 'glassesHeart':
      case 'glassesPixel':
      case 'goggles':
        return `<circle cx="4.9" cy="8" r="2.5" ${s}/><circle cx="11.1" cy="8" r="2.5" ${s}/><path d="M7.4 8h1.2" ${s}/>`;
      case 'eyePatch':
        return `<circle cx="10.6" cy="8" r="2.3" ${s}/><path d="M8.4 6.4 2.6 3.8" ${s}/>`;
      case 'mask':
        return `<rect x="3.4" y="5.6" width="9.2" height="5" rx="2.2" ${s}/>`;
      case 'blush':
        return `<ellipse cx="4.6" cy="8.6" rx="2.2" ry="1.4" ${s}/><ellipse cx="11.4" cy="8.6" rx="2.2" ry="1.4" ${s}/>`;
      case 'collarBell':
        return `<path d="M3 6.6a5 3 0 0 0 10 0" ${s}/><circle cx="8" cy="9.6" r="1.6" ${s}/>`;
      case 'bowtie':
        return `<path d="M6.8 8 2.4 5.2v5.6zM9.2 8l4.4-2.8v5.6z" ${s}/><circle cx="8" cy="8" r="1.1" ${s}/>`;
      case 'scarf':
        return `<path d="M3 6.4a5 3.4 0 0 0 10 0" ${s}/><rect x="9.4" y="7.2" width="2.8" height="5.4" rx="1.2" ${s}/>`;
      case 'tie':
        return `<path d="M6.6 2.4h2.8L8 4.4z" ${s}/><path d="M6.9 4.8h2.2L8 12z" ${s}/>`;
      case 'towel':
        return `<path d="M3 6.4a5 3.4 0 0 0 10 0" ${s}/><rect x="9.6" y="6.6" width="2.4" height="4" rx="1" ${s}/>`;
      case 'pearl':
        return `<path d="M3 6.6a5 3 0 0 0 10 0" stroke-dasharray="1.4 1.6" ${s}/>`;
      case 'rainCollar':
        return `<path d="M2.6 6.6a5.4 3.4 0 0 0 10.8 0" ${s}/><rect x="7" y="8.8" width="2" height="2.2" rx="0.6" ${s}/>`;
      case 'bandana':
        return `<path d="M2.8 5.8h10.4L8 12z" ${s}/>`;
      case 'wingsAngel':
      case 'wingsDevil':
      case 'wingsButterfly':
        return `<path d="M8 9.6C5.4 9.6 2.2 7.4 2.6 4.4c2.6.2 4.4 2 5.4 5.2zm0 0c2.6 0 5.8-2.2 5.4-5.2-2.6.2-4.4 2-5.4 5.2z" ${s}/>`;
      case 'backpack':
        return `<rect x="4" y="4" width="8" height="8" rx="2" ${s}/><path d="M6 4V2.8a2 2 0 0 1 4 0V4" ${s}/>`;
      case 'cape':
        return `<path d="M5 2.6 3.4 12.4h9.2L11 2.6z" ${s}/>`;
      case 'jetpack':
        return `<rect x="6.2" y="2.6" width="3.6" height="7" rx="1.6" ${s}/><path d="M6.6 10.4 8 13l1.4-2.6" ${s}/>`;
      case 'shell':
        return `<path d="M3 10.4a5 5 0 0 1 10 0z" ${s}/><path d="M8 6.4v4" ${s}/>`;
      case 'sock':
      case 'boot':
      case 'slipper':
        return `<path d="M5.4 2.6h3.2v5.2l2.6 2.2a1.4 1.4 0 0 1-1 2.4H5.4z" ${s}/>`;
      case 'cuff':
        return `<circle cx="8" cy="8" r="3" ${s}/><circle cx="8" cy="4" r="0.9" ${s}/>`;
      case 'cushion':
        return `<ellipse cx="8" cy="9.4" rx="6" ry="2.4" ${s}/><ellipse cx="8" cy="8.2" rx="5" ry="1.8" ${s}/>`;
      case 'rug':
        return `<ellipse cx="8" cy="9" rx="6.4" ry="2.6" ${s}/><ellipse cx="8" cy="9" rx="4" ry="1.4" ${s}/>`;
      case 'box':
        return `<path d="M2.6 7.4 8 5.2l5.4 2.2v3.4L8 13l-5.4-2.2z" ${s}/><path d="M2.6 7.4 8 9.6l5.4-2.2" ${s}/>`;
      case 'treeBase':
        return `<ellipse cx="8" cy="11" rx="6" ry="2" ${s}/><path d="M6 11V4.4h4V11" ${s}/>`;
      case 'cabin':
        return `<path d="M2.6 10.6V7.2h10.8v3.4z" ${s}/><path d="M1.6 7.2 8 2.6l6.4 4.6" ${s}/>`;
      case 'mat':
        return `<path d="M2 8.6h12l-1.4 3.2H3.4z" ${s}/>`;
      case 'snowPit':
        return `<ellipse cx="8" cy="9" rx="6" ry="2.4" ${s}/><ellipse cx="8" cy="9.4" rx="3.6" ry="1.2" ${s}/>`;
      case 'propFish':
        return `<path d="M3 8c2-2.4 6-2.4 8 0-2 2.4-6 2.4-8 0z" ${s}/><path d="M11 8l2.4-1.8v3.6z" ${s}/>`;
      case 'propCup':
        return `<path d="M4.4 3.6h6v6.4a2 2 0 0 1-2 2H6.4a2 2 0 0 1-2-2z" ${s}/><path d="M10.4 5.2h1.8a1.4 1.4 0 0 1 0 2.8h-1.8" ${s}/>`;
      case 'propBook':
        return `<rect x="3.4" y="3.4" width="9.2" height="9.2" rx="1.2" ${s}/><path d="M8 3.4v9.2" ${s}/>`;
      case 'propYarn':
        return `<circle cx="8" cy="8" r="4.2" ${s}/><path d="M5.4 5.6c2 1 3.4 3 3.6 5.4M10.4 5.8c-2 1-3.2 2.8-3.4 5" ${s}/>`;
      case 'propUmbrella':
        return `<path d="M2.4 8.4a5.6 5.6 0 0 1 11.2 0z" ${s}/><path d="M8 8.4v4.2" ${s}/>`;
      default:
        break;
    }
  }
  switch (id) {
    case 'scarf':
      return `<path d="M3.6 2.6h8.8v2.7l-2.9 1.7v5l-3-1V7L3.6 5.3z" ${s}/>`;
    case 'bowtie':
      return `<path d="M6.8 8 2.4 5.2v5.6zM9.2 8l4.4-2.8v5.6z" ${s}/><circle cx="8" cy="8" r="1.15" ${s}/>`;
    case 'sunglasses':
      return `<rect x="1.3" y="5.1" width="5.5" height="4.3" rx="2.1" ${s}/><rect x="9.2" y="5.1" width="5.5" height="4.3" rx="2.1" ${s}/><path d="M6.8 7.1h2.4" ${s}/>`;
    case 'beret':
      return `<path d="M2.6 10.4c0-3.7 2.5-5.7 5.4-5.7s5.4 2 5.4 5.7z" ${s}/><path d="M8 4.6V3" ${s}/><circle cx="8" cy="2.4" r="0.85" ${s}/>`;
    case 'halo':
      return `<ellipse cx="8" cy="5.6" rx="5.2" ry="1.9" ${s}/><path d="M3.4 9.4 2.6 11M12.6 9.4 13.4 11" ${s}/>`;
    case 'stars':
      return `<path d="M8 1.6l1.25 5.15L14.4 8l-5.15 1.25L8 14.4l-1.25-5.15L1.6 8l5.15-1.25z" ${s}/>`;
    case 'rainbow':
      return `<path d="M1.6 12.4a6.4 6.4 0 0 1 12.8 0" ${s}/><path d="M4.1 12.4a3.9 3.9 0 0 1 7.8 0" ${s}/><path d="M6.6 12.4a1.4 1.4 0 0 1 2.8 0" ${s}/>`;
    case 'collar_red':
    case 'collar_blue':
    case 'collar_pink':
    case 'collar_green':
      return `<path d="M2.4 7.2a5.6 3.1 0 0 0 11.2 0" ${s}/><circle cx="8" cy="10.4" r="1.5" ${s}/>`;
    case 'headphone_on':
    case 'headphone_auto':
      return `<path d="M2.9 9.2V8a5.1 5.1 0 0 1 10.2 0v1.2" ${s}/><rect x="1.6" y="8.6" width="2.9" height="4.2" rx="1.2" ${s}/><rect x="11.5" y="8.6" width="2.9" height="4.2" rx="1.2" ${s}/>`;
    default:
      return `<circle cx="8" cy="8" r="5.4" ${s}/>`;
  }
}

function flashShop(text: string): void {
  shopFlash = text;
  if (shopFlashTimer) window.clearTimeout(shopFlashTimer);
  shopFlashTimer = window.setTimeout(() => {
    shopFlash = '';
    renderShop();
  }, 2200);
}

function updateShopBalance(): void {
  const fish = Math.max(0, Math.round(fishProfile?.fish ?? 0));
  if (shopFishEl) shopFishEl.textContent = fish.toLocaleString('en-US');
  if (shopRateEl && !shopFlash) {
    const remain = Math.max(1, KEYS_PER_CAT_STICK - Math.round(fishProfile?.keyRemainder ?? 0));
    shopRateEl.textContent = `再敲 ${remain} 下 +1`;
    shopRateEl.classList.remove('flash');
  }
}

function cardHtml(
  item: CatalogItem,
  owned: Set<string>,
  equipped: Set<string>,
  fish: number,
  mode: 'shop' | 'owned',
): string {
  const have = owned.has(item.id);
  const isEquipped = equipped.has(item.id);
  const affordable = fish >= item.price;
  const locked = item.week > currentWeek();
  const classes = ['shop-card'];
  if (locked) classes.push('locked');
  if (have) classes.push('owned');
  if (isEquipped) classes.push('equipped');
  if (mode === 'shop' && !have && !affordable) classes.push('poor');

  let status = '可兑换';
  let statusClass = 'shop-status';
  if (locked) {
    status = `第 ${item.week + 1} 周`;
    statusClass += ' locked';
  } else if (isEquipped) {
    status = '装备中';
    statusClass += ' equipped';
  } else if (have) {
    status = '点击装备';
  } else if (!affordable) {
    status = `差 ${item.price - fish}`;
    statusClass += ' poor';
  }

  const priceText = have ? '✓' : locked ? '—' : String(item.price);
  const dot = `<span class="shop-rarity" style="background:${RARITY_COLOR[item.rarity] ?? '#9aa2ad'}"></span>`;
  const tip = `${item.name}｜${SLOT_LABEL[item.slot] ?? item.slot} · ${item.rarity} · ${item.trigger}\n${item.desc}`;
  return `<button class="${classes.join(' ')}" type="button" data-shopitem="${item.id}" title="${tip.replace(/"/g, '&quot;')}">
    <span class="shop-shot" data-shot="${item.id}"><i class="shop-zoom">⤢</i></span>
    <span class="shop-name">${dot}${item.name}</span>
    <span class="shop-meta">
      <span class="shop-price${have ? ' owned' : ''}">${priceText}</span>
      <span class="${statusClass}">${status}</span>
    </span>
  </button>`;
}

function renderShop(): void {
  if (!shopGridEl) return;
  const fish = Math.max(0, Math.round(fishProfile?.fish ?? 0));
  if (shopFishEl) shopFishEl.textContent = fish.toLocaleString('en-US');
  if (shopRateEl) {
    if (shopFlash) {
      shopRateEl.textContent = shopFlash;
      shopRateEl.classList.add('flash');
    } else {
      const remain = Math.max(1, KEYS_PER_CAT_STICK - Math.round(fishProfile?.keyRemainder ?? 0));
      shopRateEl.textContent = `再敲 ${remain} 下 +1`;
      shopRateEl.classList.remove('flash');
    }
  }

  const week = currentWeek();
  const released = releasedItems(week);
  if (shopWeekEl) {
    const fresh = released.filter((item) => item.week === week).length;
    shopWeekEl.textContent =
      `第 ${week + 1} 周 · 已上架 ${released.length} 件` +
      (fresh > 0 ? ` · 本周上新 ${fresh} 件` : '') +
      (upcomingCount(week) > 0 ? ` · 还有 ${upcomingCount(week)} 件按周解锁` : '');
  }

  const owned = new Set(fishProfile?.owned ?? []);
  const equippedIds = new Set(Object.values(fishProfile?.equipped ?? {}));
  const pool = shopPreviewAll
    ? CATALOG.filter((item) => item.slot !== 'fx' || shopFilter === 'fx' || shopFilter === 'all')
    : released;
  const visible = pool.filter((item) => shopFilter === 'all' || item.slot === shopFilter);
  if (visible.length === 0) {
    shopGridEl.innerHTML = '<div class="shop-empty">这里还没有东西，再敲点字攒猫条吧</div>';
    return;
  }
  shopGridEl.innerHTML = visible
    .map((item) => cardHtml(item, owned, equippedIds, fish, 'shop'))
    .join('');
  bindShots(shopGridEl);
}

function renderOwned(): void {
  if (!ownedGridEl) return;
  const ownedList = fishProfile?.owned ?? [];
  const equippedIds = new Set(Object.values(fishProfile?.equipped ?? {}));
  let items = ownedList
    .map((id) => itemById(id))
    .filter((item): item is CatalogItem => Boolean(item));
  if (ownedCountEl) ownedCountEl.textContent = String(items.length);
  if (ownedEquippedEl) ownedEquippedEl.textContent = `装备中 ${equippedIds.size}`;

  if (ownedFilter !== 'all') {
    items = items.filter((item) => item.kind === ownedFilter);
  }
  const q = ownedQuery.trim().toLowerCase();
  if (q) {
    items = items.filter((item) => {
      const hay = `${item.name} ${item.desc} ${SLOT_LABEL[item.slot] ?? ''} ${item.rarity}`.toLowerCase();
      return hay.includes(q);
    });
  }
  items.sort((a, b) => {
    const ea = equippedIds.has(a.id) ? 0 : 1;
    const eb = equippedIds.has(b.id) ? 0 : 1;
    return ea - eb || a.name.localeCompare(b.name, 'zh-Hans-CN');
  });

  if (items.length === 0) {
    ownedGridEl.innerHTML = `<div class="shop-empty">${
      ownedList.length === 0 ? '还没有兑换过东西，先去商店逛逛吧' : '没有匹配的，换个关键词试试'
    }</div>`;
    return;
  }
  const fish = Math.max(0, Math.round(fishProfile?.fish ?? 0));
  ownedGridEl.innerHTML = items
    .map((item) => cardHtml(item, new Set(ownedList), equippedIds, fish, 'owned'))
    .join('');
  bindShots(ownedGridEl);
}

interface ElevationStatus {
  selfElevated: boolean;
  foregroundElevated: boolean;
}

/** 管理员游戏会挡住键盘钩子：检测到就提示一键提权重启 */
async function refreshAdminHint(): Promise<void> {
  const hint = document.getElementById('admin-hint');
  if (!hint) return;
  try {
    const st = await invoke<ElevationStatus>('elevation_status');
    hint.classList.toggle('hidden', !(st.foregroundElevated && !st.selfElevated));
  } catch {
    hint.classList.add('hidden');
  }
}

async function refreshShop(): Promise<void> {
  try {
    fishProfile = await invoke<FishProfile>('get_profile');
  } catch {
    /* 命令不可用时保持现状 */
  }
  renderShop();
  renderOwned();
}

function applyUnlockEffect(item: ShopItem): void {
  switch (item.id) {
    case 'collar_red':
      void applySettingsPatch({ collarColor: 'red' });
      break;
    case 'collar_blue':
      void applySettingsPatch({ collarColor: 'blue' });
      break;
    case 'collar_pink':
      void applySettingsPatch({ collarColor: 'pink' });
      break;
    case 'collar_green':
      void applySettingsPatch({ collarColor: 'green' });
      break;
    case 'headphone_on':
      void applySettingsPatch({ headphoneMode: 'on' });
      break;
    case 'headphone_auto':
      void applySettingsPatch({ headphoneMode: 'auto' });
      break;
    default:
      break;
  }
}

async function handleShopClick(id: string): Promise<void> {
  const item = itemById(id);
  if (!item) return;
  if (item.week > currentWeek()) {
    flashShop(`还没上架，第 ${item.week + 1} 周解锁`);
    return;
  }
  const owned = new Set(fishProfile?.owned ?? []);
  const equippedIds = new Set(Object.values(fishProfile?.equipped ?? {}));
  try {
    if (owned.has(id)) {
      if (equippedIds.has(id)) {
        fishProfile = await invoke<FishProfile>('unequip_shop_slot', { slot: item.slot });
        flashShop('已取下');
      } else {
        fishProfile = await invoke<FishProfile>('equip_shop_item', { id });
        flashShop(`已换上「${item.name}」`);
      }
    } else {
      const fish = Math.round(fishProfile?.fish ?? 0);
      if (fish < item.price) {
        flashShop(`还差 ${item.price - fish} 根猫条`);
        return;
      }
      fishProfile = await invoke<FishProfile>('buy_shop_item', { id });
      applyUnlockEffect(item);
      flashShop(`已兑换「${item.name}」`);
      syncUI();
    }
  } catch (err) {
    flashShop(typeof err === 'string' ? err : '兑换失败');
  }
  renderShop();
  renderOwned();
}

function syncUI(): void {
  const setCheck = (id: string, on: boolean) => {
    const el = document.getElementById(id);
    if (el) el.textContent = on ? '✓' : '';
  };

  setCheck('chk-privacy', settings.privacyPasswordGuard !== false);
  setCheck('chk-bubbles', settings.showKeyBubbles);
  setCheck('chk-idle-play', settings.idlePlay !== false);
  {
    const modeNames = ['关闭', '渐变', '呼吸', '流光'];
    const mEl = document.getElementById('kb-rgb-mode');
    if (mEl) mEl.textContent = modeNames[settings.kbRgbMode ?? 1] ?? '渐变';
    const bEl = document.getElementById('kb-rgb-bright');
    if (bEl) bEl.textContent = (settings.kbRgbBright ?? 0.85) < 0.5 ? '低' : (settings.kbRgbBright ?? 0.85) < 1.0 ? '中' : '高';
    const spEl = document.getElementById('kb-rgb-speed');
    if (spEl) spEl.textContent = (settings.kbRgbSpeed ?? 1) < 0.7 ? '慢' : (settings.kbRgbSpeed ?? 1) > 1.4 ? '快' : '正常';
  }
  const idleValEl = document.getElementById('val-idle-threshold');
  if (idleValEl) idleValEl.textContent = `${settings.idlePlaySec ?? 30} 秒`;
  setCheck('chk-fish-bubble', fishProfile?.bubble !== false);
  setCheck('chk-lock', settings.clickThroughLocked);
  setCheck('chk-sound', settings.soundEnabled);
  setCheck('chk-keysound', settings.keySoundEnabled !== false);
  setCheck('chk-top', settings.alwaysOnTop);
  setCheck('chk-autostart', settings.autostart);
  setCheck('chk-mcp', settings.mcpEnabled);
  setCheck('chk-obs', Boolean(settings.obsEnabled));
  setCheck('chk-obs-hide', Boolean(settings.obsEnabled && settings.obsHidePet));

  if (btnObsHideEl) {
    btnObsHideEl.classList.toggle('hidden', !settings.obsEnabled);
  }
  const obsHint = document.getElementById('obs-copy-hint');
  if (obsHint && !obsHint.classList.contains('copied')) {
    obsHint.textContent = settings.obsEnabled ? `:${settings.obsPort || 27421}` : '免抠像';
  }

  if (!sliderDragging) {
    updateScaleSliderVisual(settings.scale);
  }

  syncKeySoundControls();

  const kbLayout: KeyboardLayoutId =
    settings.keyboardLayout === '108' ? '108' : settings.keyboardLayout === '75' ? '75' : '65';
  const kbOrient: KeyboardOrientation = settings.keyboardOrientation === 'viewer' ? 'viewer' : 'cat';
  document.querySelectorAll<HTMLButtonElement>('[data-kblayout]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.kblayout === kbLayout);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-kborient]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.kborient === kbOrient);
  });

  const tailMode: TailKeyMode =
    settings.tailKeyMode === 'custom' ||
    settings.tailKeyMode === 'edge' ||
    settings.tailKeyMode === 'off'
      ? settings.tailKeyMode
      : 'smart';
  const tailIds = Array.isArray(settings.tailKeyIds) ? settings.tailKeyIds : [...DEFAULT_TAIL_KEY_IDS];
  document.querySelectorAll<HTMLButtonElement>('[data-tailmode]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tailmode === tailMode);
  });
  if (tailModeBadgeEl) {
    tailModeBadgeEl.textContent = TAIL_MODE_LABELS[tailMode];
  }
  if (tailKeysCountEl) {
    tailKeysCountEl.textContent = `${tailIds.length} 键`;
  }

  const activeCat = catList.find((c) => c.id === settings.catBreed) ?? catList[0];
  renderBreedPills();

  const renderMode = '3d' as const;
  const collarColor =
    settings.collarColor === 'red' ||
    settings.collarColor === 'blue' ||
    settings.collarColor === 'pink' ||
    settings.collarColor === 'green'
      ? settings.collarColor
      : 'none';
  document.getElementById('render-mode-row')?.classList.add('hidden');
  document.querySelectorAll<HTMLButtonElement>('[data-collar]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.collar === collarColor);
  });
  const collarRowEl = document.getElementById('collar-row');
  if (collarRowEl) {
    collarRowEl.classList.toggle('hidden', settings.catBreed === 'dafeiyu');
  }

  const headphoneMode =
    settings.headphoneMode === 'auto' || settings.headphoneMode === 'on'
      ? settings.headphoneMode
      : 'off';
  document.querySelectorAll<HTMLButtonElement>('[data-headphonemode]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.headphonemode === headphoneMode);
  });
  const headphoneRowEl = document.getElementById('headphone-row');
  if (headphoneRowEl) {
    headphoneRowEl.classList.toggle('hidden', settings.catBreed === 'dafeiyu');
  }

  const headerEl = document.getElementById('menu-header');
  if (headerEl && activeCat) {
    const emoji = activeCat.emoji || '🐱';
    headerEl.textContent = `${emoji} KuroCat ${activeCat.name}`;
    headerEl.style.color = activeCat.accentColor || '#c8f538';
  }
}

async function applySettingsPatch(patch: Partial<AppSettings>): Promise<void> {
  settings = { ...settings, ...patch };
  syncUI();
  settings = await invoke<AppSettings>('update_settings', { patch: settings });
  syncUI();
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

async function copyMcpConfig(): Promise<void> {
  const hint = document.getElementById('mcp-copy-hint');
  try {
    const jsonText = await invoke<string>('get_mcp_config');
    await copyText(jsonText);
    if (hint) {
      hint.textContent = '✓ 已复制';
      hint.classList.add('copied');
      setTimeout(() => {
        hint.textContent = 'AI 捏猫';
        hint.classList.remove('copied');
      }, 1800);
    }
  } catch (err) {
    console.error('Failed to copy MCP config:', err);
  }
}

async function copyObsUrl(): Promise<void> {
  const hint = document.getElementById('obs-copy-hint');
  try {
    if (!settings.obsEnabled) {
      await applySettingsPatch({ obsEnabled: true });
    }
    const url = await invoke<string>('get_obs_url');
    await copyText(url);
    if (hint) {
      hint.textContent = '✓ 已复制';
      hint.classList.add('copied');
      setTimeout(() => {
        hint.classList.remove('copied');
        hint.textContent = settings.obsEnabled ? `:${settings.obsPort || 27421}` : '免抠像';
      }, 2000);
    }
  } catch (err) {
    console.error('Failed to copy OBS url:', err);
  }
}

async function createDesktopShortcut(): Promise<void> {
  const hint = document.getElementById('shortcut-hint');
  try {
    await invoke<string>('create_desktop_shortcut');
    if (hint) {
      hint.textContent = '✓ 已创建';
      hint.classList.add('copied');
      setTimeout(() => {
        hint.textContent = 'KuroCat';
        hint.classList.remove('copied');
      }, 1800);
    }
  } catch (err) {
    console.error('Failed to create shortcut:', err);
    if (hint) {
      hint.textContent = '失败';
      setTimeout(() => {
        hint.textContent = 'KuroCat';
      }, 1800);
    }
  }
}

async function triggerManualUpdateCheck(): Promise<void> {
  if (updateBusy) return;
  // If we already know an update is available, clicking immediately installs (or opens release page).
  if (cachedUpdateInfo?.hasUpdate) {
    if (cachedUpdateInfo.downloadUrl) {
      updateBusy = true;
      renderFooterUpdateState(`下载 v${cachedUpdateInfo.latestVersion}...`, true);
      closeMenu();
      try {
        await invoke('install_update', { info: cachedUpdateInfo });
      } catch {
        updateBusy = false;
        renderFooterUpdateState();
      }
      return;
    }
    if (cachedUpdateInfo.releaseUrl) {
      void invoke('open_release_page', { url: cachedUpdateInfo.releaseUrl });
      closeMenu();
      return;
    }
  }

  updateBusy = true;
  renderFooterUpdateState('检查更新中…', false);
  try {
    const info = await invoke<UpdateInfo>('check_for_update');
    updateBusy = false;
    if (info.hasUpdate) {
      cachedUpdateInfo = info;
      renderFooterUpdateState(`⬆ 点击更新 v${info.latestVersion}`, true);
    } else {
      cachedUpdateInfo = info;
      renderFooterUpdateState(`✓ 最新 v${info.currentVersion}`, false);
      setTimeout(() => {
        renderFooterUpdateState();
      }, 2200);
    }
  } catch {
    updateBusy = false;
    renderFooterUpdateState('检查失败，点此重试', false);
    setTimeout(() => {
      renderFooterUpdateState();
    }, 2200);
  }
}

async function bootstrap(): Promise<void> {
  if (isMacPlatform()) {
    const shortcutBtn = document.getElementById('btn-desktop-shortcut');
    if (shortcutBtn) shortcutBtn.classList.add('hidden');
    const lockLbl = document.getElementById('lbl-toggle-lock');
    if (lockLbl) lockLbl.textContent = '锁定鼠标穿透（Option 解锁）';
    const lockBtn = document.getElementById('btn-toggle-lock');
    if (lockBtn) lockBtn.title = '开启后重启保持锁定，按住 Option 或在菜单栏可随时解锁';
  }

  try {
    const [loadedSettings, loadedCats, ver, cachedUpd] = await Promise.all([
      invoke<AppSettings>('get_settings'),
      invoke<CatSkinConfig[]>('get_cats'),
      invoke<string>('get_app_version'),
      invoke<UpdateInfo | null>('get_cached_update_info').catch(() => null),
    ]);
    settings = loadedSettings;
    if (Array.isArray(loadedCats) && loadedCats.length > 0) {
      catList = loadedCats;
    }
    if (ver) {
      currentAppVersion = ver;
    }
    if (cachedUpd) {
      cachedUpdateInfo = cachedUpd;
    }
  } catch (err) {
    console.error('Failed to load menu state:', err);
  }
  syncUI();
  renderFooterUpdateState();
  switchTab('appearance');
  void refreshCustomSoundInfo();

  const isWin7 = await invoke<boolean>('is_win7_ulw_mode').catch(() => false);
  if (isWin7) {
    document.documentElement.classList.add('win7-ulw-mode');
  }

  document.getElementById('btn-close-menu')?.addEventListener('click', () => closeMenu());

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });

  const modalEl = document.getElementById('acc-modal');
  if (modalEl) {
    modalEl.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('#acc-close')) {
        closeAccModal();
        return;
      }
      if (target.closest('#acc-act') && modalItemId) {
        const id = modalItemId;
        void handleShopClick(id).then(() => {
          if (modalItemId === id) openAccModal(id);
        });
        return;
      }
      if (!target.closest('.acc-card')) closeAccModal();
    });
  }

  if (ownedSearchEl) {
    ownedSearchEl.addEventListener('input', () => {
      ownedQuery = ownedSearchEl.value;
      renderOwned();
    });
  }

  if (scaleSliderEl) {
    scaleSliderEl.addEventListener('pointerdown', () => {
      sliderDragging = true;
    });
    scaleSliderEl.addEventListener('input', () => {
      sliderDragging = true;
      const nextScale = Math.max(0.2, Math.min(1.5, Number(scaleSliderEl.value) / 100));
      updateScaleSliderVisual(nextScale);
      void invoke('preview_scale', { scale: nextScale });
    });
    const commitSliderScale = () => {
      sliderDragging = false;
      const nextScale = Math.max(0.2, Math.min(1.5, Number(scaleSliderEl.value) / 100));
      void applySettingsPatch({ scale: nextScale });
    };
    scaleSliderEl.addEventListener('change', commitSliderScale);
    scaleSliderEl.addEventListener('pointerup', () => {
      sliderDragging = false;
    });
  }

  if (scaleValueEl) {
    scaleValueEl.addEventListener('click', (e) => {
      e.stopPropagation();
      sliderDragging = false;
      updateScaleSliderVisual(1.0);
      void applySettingsPatch({ scale: 1.0 });
    });
  }

  if (packSelectEl) {
    packSelectEl.addEventListener('change', () => {
      const name = packSelectEl.value;
      customLoaded = null;
      void applySettingsPatch({
        keySoundPack: name,
        keySoundStyle: 'custom',
        keySoundEnabled: true,
      });
      updateCustomSoundHint();
      window.setTimeout(() => {
        void invoke('preview_key_sound', { style: 'custom' }).catch(() => {});
      }, 420);
    });
  }

  if (keysoundSliderEl) {
    keysoundSliderEl.addEventListener('input', () => {
      const v = Math.max(0, Math.min(100, Number(keysoundSliderEl.value)));
      updateKeySoundSliderVisual(v);
      void invoke('preview_key_sound', {
        style: normalizeKeySoundStyle(settings.keySoundStyle),
      }).catch(() => {});
    });
    keysoundSliderEl.addEventListener('change', () => {
      const v = Math.max(0, Math.min(100, Number(keysoundSliderEl.value)));
      updateKeySoundSliderVisual(v);
      void applySettingsPatch({ keySoundVolume: v, keySoundEnabled: true });
    });
  }

  menuEl.addEventListener('click', (e) => {
    const filterBtn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-shopf]');
    if (filterBtn) {
      shopFilter = filterBtn.dataset.shopf || 'all';
      document.querySelectorAll<HTMLElement>('[data-shopf]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.shopf === shopFilter);
      });
      renderShop();
      return;
    }

    const shotEl = (e.target as HTMLElement).closest<HTMLElement>('[data-shot]');
    if (shotEl && shotEl.dataset.shot) {
      openAccModal(shotEl.dataset.shot);
      return;
    }

    if ((e.target as HTMLElement).closest('#admin-hint')) {
      void invoke('restart_as_admin');
      return;
    }

    const previewAllBtn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-shopall]');
    if (previewAllBtn) {
      shopPreviewAll = !shopPreviewAll;
      previewAllBtn.classList.toggle('active', shopPreviewAll);
      renderShop();
      return;
    }

    const ownedFilterBtn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-ownedf]');
    if (ownedFilterBtn) {
      ownedFilter = ownedFilterBtn.dataset.ownedf || 'all';
      document.querySelectorAll<HTMLElement>('[data-ownedf]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.ownedf === ownedFilter);
      });
      renderOwned();
      return;
    }

    const tabBtn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-tab]');
    if (tabBtn) {
      const t = tabBtn.dataset.tab;
      if (t === 'appearance' || t === 'system' || t === 'shop' || t === 'owned') {
        switchTab(t);
      }
      return;
    }

    const target = (e.target as HTMLElement).closest<HTMLElement>(
      '[data-action], [data-breed], [data-shopitem], [data-rendermode], [data-collar], [data-headphonemode], [data-kblayout], [data-kborient], [data-tailmode], [data-keysoundstyle]',
    );
    if (!target) return;

    const keySoundStyleAttr = target.dataset.keysoundstyle;
    if (keySoundStyleAttr) {
      const style = normalizeKeySoundStyle(keySoundStyleAttr);
      void applySettingsPatch({ keySoundStyle: style, keySoundEnabled: true });
      void invoke('preview_key_sound', { style }).catch(() => {});
      if (style === 'custom') void refreshCustomSoundInfo();
      return;
    }

    const headphoneAttr = target.dataset.headphonemode;
    if (headphoneAttr === 'auto' || headphoneAttr === 'on' || headphoneAttr === 'off') {
      void applySettingsPatch({ headphoneMode: headphoneAttr });
      return;
    }

    const renderModeAttr = target.dataset.rendermode;
    if (renderModeAttr === '3d') {
      void applySettingsPatch({ renderMode: '3d' });
      return;
    }

    const collarAttr = target.dataset.collar;
    if (
      collarAttr === 'none' ||
      collarAttr === 'red' ||
      collarAttr === 'blue' ||
      collarAttr === 'pink' ||
      collarAttr === 'green'
    ) {
      void applySettingsPatch({ collarColor: collarAttr });
      return;
    }

    const kbLayoutAttr = target.dataset.kblayout;
    if (kbLayoutAttr === '65' || kbLayoutAttr === '75' || kbLayoutAttr === '108') {
      void applySettingsPatch({ keyboardLayout: kbLayoutAttr });
      return;
    }

    const kbOrientAttr = target.dataset.kborient;
    if (kbOrientAttr === 'cat' || kbOrientAttr === 'viewer') {
      void applySettingsPatch({ keyboardOrientation: kbOrientAttr });
      return;
    }

    const tailModeAttr = target.dataset.tailmode;
    if (
      tailModeAttr === 'smart' ||
      tailModeAttr === 'custom' ||
      tailModeAttr === 'edge' ||
      tailModeAttr === 'off'
    ) {
      void applySettingsPatch({ tailKeyMode: tailModeAttr });
      return;
    }

    const breedAttr = target.dataset.breed;
    if (breedAttr) {
      void applySettingsPatch({ catBreed: breedAttr });
      return;
    }

    const shopItemId = target.dataset.shopitem;
    if (shopItemId) {
      void handleShopClick(shopItemId);
      return;
    }

    switch (target.dataset.action) {
      case 'toggle-privacy':
        void applySettingsPatch({ privacyPasswordGuard: !(settings.privacyPasswordGuard !== false) });
        break;
      case 'toggle-bubbles':
        void applySettingsPatch({ showKeyBubbles: !settings.showKeyBubbles });
        break;
      case 'cycle-kb-rgb-mode': {
        const next = ((settings.kbRgbMode ?? 1) + 1) % 4;
        void applySettingsPatch({ kbRgbMode: next });
        break;
      }
      case 'cycle-kb-rgb-bright': {
        const cur = settings.kbRgbBright ?? 0.85;
        const next = cur < 0.5 ? 0.85 : cur < 1.0 ? 1.25 : 0.35;
        void applySettingsPatch({ kbRgbBright: next });
        break;
      }
      case 'cycle-kb-rgb-speed': {
        const cur = settings.kbRgbSpeed ?? 1;
        const next = cur < 0.7 ? 1 : cur > 1.4 ? 0.45 : 1.9;
        void applySettingsPatch({ kbRgbSpeed: next });
        break;
      }
      case 'gentle-demo':
        void invoke('trigger_gentle_demo');
        break;
      case 'toggle-idle-play':
        void applySettingsPatch({ idlePlay: settings.idlePlay === false });
        break;
      case 'cycle-idle-threshold': {
        const steps = [15, 30, 60, 120];
        const cur = settings.idlePlaySec ?? 30;
        const next = steps[(steps.indexOf(cur) + 1) % steps.length] ?? 30;
        void applySettingsPatch({ idlePlaySec: next });
        break;
      }
      case 'toggle-fish-bubble':
        void invoke<FishProfile>('set_bubble_enabled', {
          enabled: !(fishProfile?.bubble !== false),
        })
          .then((profile) => {
            fishProfile = profile;
            syncUI();
          })
          .catch(() => {});
        break;
      case 'toggle-lock':
        void applySettingsPatch({ clickThroughLocked: !settings.clickThroughLocked });
        closeMenu();
        break;
      case 'toggle-sound':
        void applySettingsPatch({ soundEnabled: !settings.soundEnabled });
        break;
      case 'toggle-keysound':
        void applySettingsPatch({ keySoundEnabled: !isKeySoundOn() });
        break;
      case 'preview-keysound':
        void invoke('preview_key_sound', {
          style: normalizeKeySoundStyle(settings.keySoundStyle),
        }).catch(() => {});
        break;
      case 'open-keyboard-folder':
        void invoke('open_keyboard_folder')
          .then(() => {
            window.setTimeout(() => void refreshKbPresets(), 900);
          })
          .catch(() => {});
        break;
      case 'open-keysound-folder':
        void invoke('open_custom_sound_dir')
          .then(() => {
            window.setTimeout(() => void refreshCustomSoundInfo(), 900);
          })
          .catch(() => {});
        break;
      case 'rescan-keysound':
        void invoke<number>('rescan_custom_sounds')
          .then(() => refreshCustomSoundInfo())
          .catch(() => {});
        break;
      case 'toggle-top':
        void applySettingsPatch({ alwaysOnTop: !settings.alwaysOnTop });
        break;
      case 'toggle-autostart':
        void applySettingsPatch({ autostart: !settings.autostart });
        break;
      case 'toggle-obs': {
        const nextObs = !settings.obsEnabled;
        void applySettingsPatch({
          obsEnabled: nextObs,
          obsHidePet: nextObs ? settings.obsHidePet : false,
        });
        break;
      }
      case 'copy-obs':
        void copyObsUrl();
        break;
      case 'toggle-obs-hide':
        void applySettingsPatch({ obsHidePet: !settings.obsHidePet });
        if (!settings.obsHidePet) {
          closeMenu();
        }
        break;
      case 'toggle-mcp': {
        if (settings.mcpEnabled) {
          void applySettingsPatch({ mcpEnabled: false });
          break;
        }
        // 启用前明确告知：会在本机 127.0.0.1 上开一个端口给 AI 客户端用
        const ok = window.confirm(
          `开启 MCP 服务会在本机 127.0.0.1:${settings.mcpPort} 上监听一个本地端口，\n` +
            '供 Claude / Cursor 等 AI 客户端调用（仅本机可访问，不对外网开放）。\n\n' +
            '确定开启吗？',
        );
        if (ok) void applySettingsPatch({ mcpEnabled: true });
        break;
      }
      case 'copy-mcp':
        void copyMcpConfig();
        break;
      case 'open-tail-picker':
        void invoke('open_tail_picker_from_menu');
        break;
      case 'desktop-shortcut':
        void createDesktopShortcut();
        break;
      case 'reset-pos':
        void invoke('reset_position');
        closeMenu();
        break;
      case 'contact-author':
        void openFeedback();
        break;
      case 'quit':
        void invoke('quit_app');
        break;
    }
  });

  await listen<AppSettings>('kuro-settings', (ev) => {
    settings = ev.payload;
    syncUI();
  });

  await listen<CatSkinConfig[]>('kuro-cats', (ev) => {
    if (Array.isArray(ev.payload) && ev.payload.length > 0) {
      catList = ev.payload;
      syncUI();
    }
  });

  await listen<FishProfile>('kuro-profile', (ev) => {
    if (!ev.payload) return;
    fishProfile = ev.payload;
    if (activeTab === 'shop') renderShop();
    else updateShopBalance();
  });

  await listen<UpdateProgressEvent>('kuro-update-status', (ev) => {
    if (ev.payload.info) {
      cachedUpdateInfo = ev.payload.info;
    }
    if (ev.payload.stage === 'available' && cachedUpdateInfo?.hasUpdate) {
      updateBusy = false;
      renderFooterUpdateState();
    } else if (ev.payload.stage === 'downloading' || ev.payload.stage === 'verifying' || ev.payload.stage === 'installing') {
      updateBusy = true;
      renderFooterUpdateState('更新中...', true);
    } else if (ev.payload.stage === 'up_to_date' || ev.payload.stage === 'error') {
      updateBusy = false;
      renderFooterUpdateState();
    }
  });

  await listen<{ count: number; pack: string }>('kuro-custom-sounds-loaded', (ev) => {
    const payload = ev.payload;
    const count = Number(payload?.count);
    if (!Number.isFinite(count)) return;
    customLoaded = { count, pack: typeof payload?.pack === 'string' ? payload.pack : '' };
    updateCustomSoundHint();
  });

  await listen('kuro-menu-opened', async () => {
    void refreshAdminHint();
  });
}

void bootstrap();


async function refreshKbPresets(): Promise<void> {
  if (!kbPresetEl) return;
  const list = await invoke<Array<{ id?: string; name?: string }>>('list_keyboard_presets').catch(() => []);
  const current = settings.keyboardPreset ?? '';
  kbPresetEl.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = '原版（奶油白）';
  kbPresetEl.appendChild(none);
  for (const p of list) {
    if (!p.id) continue;
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name || p.id;
    kbPresetEl.appendChild(opt);
  }
  kbPresetEl.value = current;
}

kbPresetEl?.addEventListener('change', () => {
  void applySettingsPatch({ keyboardPreset: kbPresetEl.value });
});

void refreshKbPresets();
