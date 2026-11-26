import { CATALOG } from './catalog';

/**
 * 配饰与特效的视觉层。
 *
 * 商品目录、价格、触发时机都在 Rust 侧（profile.rs::SHOP）作为唯一数据源；
 * 这里只负责「某个 id 长什么样、用什么形状和配色画出来」。
 *
 * 所有配饰都在猫的局部坐标系里绘制：原点 (0,0) 是锚点，
 * +x 向右、+y 向下，尺寸以 226px 的猫高为基准等比缩放。
 */

export interface AccentAnchor {
  /** 锚点（画布逻辑坐标） */
  x: number;
  y: number;
  /** 相对猫高 226px 的缩放 */
  s: number;
  /** 动画时间（秒） */
  t: number;
  /** 猫的朝向：-1 向左、1 向右，用于不对称配饰 */
  dir: number;
}

export interface AccShape {
  shape: string;
  c1: string;
  c2: string;
}

/** 50 件配饰的绘制参数 */
export const ACCESSORY_ART: Record<string, AccShape> = {
  // ---- 头部 ----
  acc_head_baseball: { shape: 'cap', c1: '#2f6fd0', c2: '#1c4a94' },
  acc_head_beanie: { shape: 'beanie', c1: '#c9d6e6', c2: '#8fa4bd' },
  acc_head_witch: { shape: 'coneHat', c1: '#33205c', c2: '#7c4dd6' },
  acc_head_chef: { shape: 'chefHat', c1: '#f4f6fa', c2: '#cfd6e2' },
  acc_head_frog: { shape: 'hood', c1: '#6fbf4a', c2: '#3f8a28' },
  acc_head_catear: { shape: 'earband', c1: '#2a2b31', c2: '#c8f538' },
  acc_head_antler: { shape: 'antler', c1: '#8a5a2b', c2: '#c98b46' },
  acc_head_party: { shape: 'partyHat', c1: '#ff5f9e', c2: '#ffd166' },
  acc_head_crown: { shape: 'crown', c1: '#ffcf3f', c2: '#e39b12' },
  acc_head_nightcap: { shape: 'nightcap', c1: '#5b6ee1', c2: '#aab6ff' },
  acc_head_earmuff: { shape: 'earmuff', c1: '#e2607a', c2: '#f6b7c4' },

  // ---- 面部 ----
  acc_face_round: { shape: 'glassesRound', c1: '#3a3d46', c2: '#9fd0ff' },
  acc_face_heartshades: { shape: 'glassesHeart', c1: '#ff6f9c', c2: '#ffd1e0' },
  acc_face_goggles: { shape: 'goggles', c1: '#23252b', c2: '#7cf0d0' },
  acc_face_eyepatch: { shape: 'eyePatch', c1: '#1e1f24', c2: '#8a8f9c' },
  acc_face_mask: { shape: 'mask', c1: '#dfe8f4', c2: '#a9b8cc' },
  acc_face_blush: { shape: 'blush', c1: '#ff8fae', c2: '#ffd0dd' },
  acc_face_pixelshades: { shape: 'glassesPixel', c1: '#24252a', c2: '#6f7480' },

  // ---- 颈部 ----
  acc_neck_bell: { shape: 'collarBell', c1: '#d23a4a', c2: '#ffd24a' },
  acc_neck_bowtie: { shape: 'bowtie', c1: '#b3324a', c2: '#f2d9dd' },
  acc_neck_plaidscarf: { shape: 'scarf', c1: '#c0453f', c2: '#f0d6b8' },
  acc_neck_tie: { shape: 'tie', c1: '#2b3350', c2: '#6b7bb8' },
  acc_neck_towel: { shape: 'towel', c1: '#4aa9d8', c2: '#eaf6ff' },
  acc_neck_pearl: { shape: 'pearl', c1: '#f6f1e4', c2: '#cfc2a6' },
  acc_neck_raincoat: { shape: 'rainCollar', c1: '#f2c744', c2: '#c99a1d' },
  acc_neck_bandana: { shape: 'bandana', c1: '#4a7bd2', c2: '#9fc0ff' },

  // ---- 背部 ----
  acc_back_angelwings: { shape: 'wingsAngel', c1: '#ffffff', c2: '#d8e4f2' },
  acc_back_devilwings: { shape: 'wingsDevil', c1: '#3a2030', c2: '#b0405f' },
  acc_back_butterfly: { shape: 'wingsButterfly', c1: '#f7a8d8', c2: '#8fd5ff' },
  acc_back_backpack: { shape: 'backpack', c1: '#5a7a4a', c2: '#c8b088' },
  acc_back_cape: { shape: 'cape', c1: '#8f1f2e', c2: '#d94a5c' },
  acc_back_jetpack: { shape: 'jetpack', c1: '#b8bec9', c2: '#ff8a3d' },
  acc_back_shell: { shape: 'shell', c1: '#7a9a5a', c2: '#c7d8a8' },

  // ---- 爪子 ----
  acc_paw_socks: { shape: 'sock', c1: '#f4f6fa', c2: '#d8a0b0' },
  acc_paw_boots: { shape: 'boot', c1: '#e8b23a', c2: '#8a6410' },
  acc_paw_cuff: { shape: 'cuff', c1: '#c8f538', c2: '#7f9c1d' },
  acc_paw_slippers: { shape: 'slipper', c1: '#f0a0c0', c2: '#c86a8f' },

  // ---- 地面 ----
  acc_floor_cushion: { shape: 'cushion', c1: '#4f6ad6', c2: '#8fa4f0' },
  acc_floor_rug: { shape: 'rug', c1: '#b5586a', c2: '#f0c9a0' },
  acc_floor_box: { shape: 'box', c1: '#b98a56', c2: '#8a6238' },
  acc_floor_catttree: { shape: 'treeBase', c1: '#c8a97a', c2: '#8d7350' },
  acc_floor_cabin: { shape: 'cabin', c1: '#9a6b46', c2: '#5f3f28' },
  acc_floor_picnic: { shape: 'mat', c1: '#e05a5a', c2: '#f7f0e0' },
  acc_floor_snow: { shape: 'snowPit', c1: '#eaf4ff', c2: '#bcd6ee' },
  acc_floor_beach: { shape: 'mat', c1: '#f0c96a', c2: '#62b9d8' },

  // ---- 道具 ----
  acc_prop_fishsnack: { shape: 'propFish', c1: '#d8c8a0', c2: '#8f7c55' },
  acc_prop_coffee: { shape: 'propCup', c1: '#f4f6fa', c2: '#6b4a34' },
  acc_prop_book: { shape: 'propBook', c1: '#8f3a4a', c2: '#f0e6d2' },
  acc_prop_yarn: { shape: 'propYarn', c1: '#e98fb0', c2: '#b85c80' },
  acc_prop_umbrella: { shape: 'propUmbrella', c1: '#5aa9d8', c2: '#2f6f96' },
};

export type FxMotion = 'pop' | 'rise' | 'fall' | 'orbit' | 'ring' | 'trail' | 'burst' | 'aura';

export interface FxShape {
  name?: string;
  icon: string;
  motion: FxMotion;
  color: string;
}

/** 50 个特效：用符号 + 运动方式区分，颜色取配置里的主色 */
export const EFFECT_ART: Record<string, FxShape> = {
  fx_star_pop: { icon: '⭐', motion: 'pop', color: '#ffd66b' },
  fx_rainbow_trail: { icon: '🌈', motion: 'trail', color: '#ff7ad9' },
  fx_music_notes: { icon: '🎵', motion: 'rise', color: '#5eead4' },
  fx_heart_bubbles: { icon: '💗', motion: 'rise', color: '#ff8fb1' },
  fx_paw_prints: { icon: '🐾', motion: 'pop', color: '#c8f538' },
  fx_sakura: { icon: '🌸', motion: 'fall', color: '#ffb7d5' },
  fx_autumn_leaves: { icon: '🍁', motion: 'fall', color: '#e8833a' },
  fx_snow: { icon: '❄️', motion: 'fall', color: '#cfe9ff' },
  fx_bubbles: { icon: '🫧', motion: 'rise', color: '#9fe3ff' },
  fx_pixel_rain: { icon: '📄', motion: 'fall', color: '#7de3a0' },
  fx_confetti: { icon: '🎊', motion: 'burst', color: '#ffd166' },
  fx_fireworks: { icon: '🎆', motion: 'burst', color: '#ff9a5a' },
  fx_lightning: { icon: '⚡', motion: 'burst', color: '#ffe066' },
  fx_flames: { icon: '🔥', motion: 'rise', color: '#ff7a3d' },
  fx_ink_splash: { icon: '🖤', motion: 'burst', color: '#5a5f6b' },
  fx_stardust: { icon: '✨', motion: 'pop', color: '#ffe9a8' },
  fx_coins: { icon: '🪙', motion: 'pop', color: '#ffcf3f' },
  fx_fish_bones: { icon: '🐟', motion: 'fall', color: '#cfd8e6' },
  fx_sleep_zs: { icon: '💤', motion: 'rise', color: '#a9b8ff' },
  fx_question_marks: { icon: '❓', motion: 'rise', color: '#9fd0ff' },
  fx_coffee_beans: { icon: '☕', motion: 'rise', color: '#c89a6a' },
  fx_dandelion: { icon: '🌼', motion: 'rise', color: '#ffe9a8' },
  fx_code_symbols: { icon: '💻', motion: 'pop', color: '#7de3a0' },
  fx_constellation: { icon: '🌌', motion: 'orbit', color: '#8f7bff' },
  fx_focus_halo: { icon: '🧘', motion: 'aura', color: '#7cf0d0' },
  fx_breathing_aura: { icon: '◯', motion: 'aura', color: '#8fd5ff' },
  fx_fireflies: { icon: '✨', motion: 'orbit', color: '#d9ff8a' },
  fx_aurora: { icon: '🌈', motion: 'aura', color: '#7ce0c0' },
  fx_rain_curtain: { icon: '🌧️', motion: 'fall', color: '#9fd0ff' },
  fx_steam: { icon: '💨', motion: 'rise', color: '#dfe8f4' },
  fx_neon_pulse: { icon: '🔷', motion: 'aura', color: '#ff5fd0' },
  fx_glitch: { icon: '👾', motion: 'burst', color: '#b06bff' },
  fx_echo_ripple: { icon: '◯', motion: 'ring', color: '#9fd0ff' },
  fx_heartbeat: { icon: '💗', motion: 'ring', color: '#ff6f9c' },
  fx_orbit_stars: { icon: '🌟', motion: 'orbit', color: '#ffe066' },
  fx_halo_shatter: { icon: '💫', motion: 'burst', color: '#cfd8ff' },
  fx_pet_hearts: { icon: '💕', motion: 'rise', color: '#ff8fb1' },
  fx_feed_happy: { icon: '😻', motion: 'pop', color: '#ffb347' },
  fx_levelup_beam: { icon: '🎖️', motion: 'burst', color: '#ffd166' },
  fx_combo_crit: { icon: '💥', motion: 'burst', color: '#ff7a3d' },
  fx_headpat_stars: { icon: '🌟', motion: 'pop', color: '#ffd66b' },
  fx_startle: { icon: '❗', motion: 'pop', color: '#ff5f5f' },
  fx_bath_bubbles: { icon: '🫧', motion: 'rise', color: '#b9f0ff' },
  fx_sleep_cloud: { icon: '💭', motion: 'rise', color: '#b9c6e8' },
  fx_stretch_sparkle: { icon: '✨', motion: 'burst', color: '#ffe9a8' },
  fx_celebrate_ribbons: { icon: '🎗️', motion: 'fall', color: '#ff9ec0' },
  fx_camera_flash: { icon: '📸', motion: 'burst', color: '#ffffff' },
  fx_hi_wave: { icon: '👋', motion: 'pop', color: '#ffd166' },
  fx_morning_sun: { icon: '🌅', motion: 'aura', color: '#ffcf6a' },
  fx_night_lamp: { icon: '🏮', motion: 'aura', color: '#ff9a5a' },
};

/** 特效触发方式（与 Rust 侧的 trigger 文案一一对应） */
export type FxTrigger =
  | { kind: 'always' }
  | { kind: 'everyN'; n: number }
  | { kind: 'typing' }
  | { kind: 'combo' }
  | { kind: 'idle' }
  | { kind: 'streak' }
  | { kind: 'backspace' }
  | { kind: 'click' }
  | { kind: 'feed' }
  | { kind: 'hover' }
  | { kind: 'stretch' }
  | { kind: 'milestone'; n: number };

export const EFFECT_TRIGGER: Record<string, FxTrigger> = {
  fx_star_pop: { kind: 'everyN', n: 5 },
  fx_rainbow_trail: { kind: 'typing' },
  fx_music_notes: { kind: 'combo' },
  fx_heart_bubbles: { kind: 'everyN', n: 8 },
  fx_paw_prints: { kind: 'everyN', n: 10 },
  fx_sakura: { kind: 'everyN', n: 12 },
  fx_autumn_leaves: { kind: 'everyN', n: 12 },
  fx_snow: { kind: 'everyN', n: 12 },
  fx_bubbles: { kind: 'everyN', n: 6 },
  fx_pixel_rain: { kind: 'everyN', n: 15 },
  fx_confetti: { kind: 'everyN', n: 20 },
  fx_fireworks: { kind: 'combo' },
  fx_lightning: { kind: 'combo' },
  fx_flames: { kind: 'streak' },
  fx_ink_splash: { kind: 'backspace' },
  fx_stardust: { kind: 'everyN', n: 4 },
  fx_coins: { kind: 'everyN', n: 10 },
  fx_fish_bones: { kind: 'feed' },
  fx_sleep_zs: { kind: 'idle' },
  fx_question_marks: { kind: 'backspace' },
  fx_coffee_beans: { kind: 'streak' },
  fx_dandelion: { kind: 'everyN', n: 15 },
  fx_code_symbols: { kind: 'everyN', n: 6 },
  fx_constellation: { kind: 'streak' },
  fx_focus_halo: { kind: 'streak' },
  fx_breathing_aura: { kind: 'idle' },
  fx_fireflies: { kind: 'typing' },
  fx_aurora: { kind: 'combo' },
  fx_rain_curtain: { kind: 'typing' },
  fx_steam: { kind: 'feed' },
  fx_neon_pulse: { kind: 'combo' },
  fx_glitch: { kind: 'backspace' },
  fx_echo_ripple: { kind: 'click' },
  fx_heartbeat: { kind: 'click' },
  fx_orbit_stars: { kind: 'combo' },
  fx_halo_shatter: { kind: 'idle' },
  fx_pet_hearts: { kind: 'click' },
  fx_feed_happy: { kind: 'feed' },
  fx_levelup_beam: { kind: 'milestone', n: 500 },
  fx_combo_crit: { kind: 'combo' },
  fx_headpat_stars: { kind: 'hover' },
  fx_startle: { kind: 'click' },
  fx_bath_bubbles: { kind: 'click' },
  fx_sleep_cloud: { kind: 'idle' },
  fx_stretch_sparkle: { kind: 'stretch' },
  fx_celebrate_ribbons: { kind: 'milestone', n: 1000 },
  fx_camera_flash: { kind: 'click' },
  fx_hi_wave: { kind: 'stretch' },
  fx_morning_sun: { kind: 'milestone', n: 100 },
  fx_night_lamp: { kind: 'idle' },
};

function parseFxTrigger(text: string): FxTrigger {
  const t = (text || '').trim();
  if (/常驻|常戴|常亮/.test(t)) return { kind: 'always' };
  const n = t.match(/(\d+)/);
  if (/^每\s*\d+\s*键$/.test(t) && n) return { kind: 'everyN', n: Number(n[1]) };
  if (n && /累计/.test(t)) return { kind: 'milestone', n: Number(n[1]) };
  if (/连击|高速/.test(t)) return { kind: 'combo' };
  if (/^打字|每次按键/.test(t)) return { kind: 'typing' };
  if (/退格/.test(t)) return { kind: 'backspace' };
  if (/点击|触摸|互动/.test(t)) return { kind: 'click' };
  if (/喂|吃/.test(t)) return { kind: 'feed' };
  if (/悬停|停在头上|摸/.test(t)) return { kind: 'hover' };
  if (/睡醒|唤醒|启动/.test(t)) return { kind: 'stretch' };
  if (/挂机|空闲|夜间|放置/.test(t)) return { kind: 'idle' };
  if (/连续打字/.test(t)) return { kind: 'streak' };
  return { kind: 'everyN', n: 10 };
}

for (const entry of CATALOG) {
  if (entry.kind === 'effect') {
    if (!EFFECT_ART[entry.id]) {
      EFFECT_ART[entry.id] = {
        icon: entry.icon || '✨',
        motion: (entry.motion || 'pop') as FxMotion,
        color: entry.c1,
        name: entry.name,
      };
    }
    // 触发一律以目录为准：特效全部改成「常驻 · 按下即显示」，
    // 手写表里旧的「每 N 键 / 连击时」也要被覆盖掉。
    EFFECT_TRIGGER[entry.id] = parseFxTrigger(entry.trigger);
  } else if (!ACCESSORY_ART[entry.id]) {
    ACCESSORY_ART[entry.id] = { shape: entry.shape, c1: entry.c1, c2: entry.c2 };
  }
}

/** 配饰槽位 → 绘制层（地面/背后在猫身后，其余在猫身前） */
export function slotLayer(slot: string): 'behind' | 'body' | 'front' {
  if (slot === 'floor' || slot === 'back') return 'behind';
  if (slot === 'paw' || slot === 'prop') return 'front';
  return 'body';
}

/** 操作型触发条件（配饰显示 / 特效迸发） */
export function accessoryVisible(trigger: string, state: ActivityState): boolean {
  switch (trigger) {
    case '常戴':
      return true;
    case '打字时':
      return state.typingActive;
    case '连击时':
      return state.combo >= 6;
    case '挂机时':
      return state.idleSeconds >= 45;
    case '连续打字 30 秒':
      return state.typingStreak >= 30;
    case '点击切换':
      return state.toggled;
    case '点击猫之后':
    case '点击猫':
      return state.clickPulse;
    case '喂食之后':
      return state.feedPulse;
    case '鼠标停在头上':
      return state.hoverHead;
    case '睡醒时':
      return state.stretchPulse;
    default:
      return state.totalKeys >= Number((trigger.match(/\d+/) || [0])[0] ?? 0);
  }
}

export interface ActivityState {
  typingActive: boolean;
  combo: number;
  idleSeconds: number;
  typingStreak: number;
  toggled: boolean;
  clickPulse: boolean;
  feedPulse: boolean;
  hoverHead: boolean;
  stretchPulse: boolean;
  totalKeys: number;
}
