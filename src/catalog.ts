/**
 * 商品目录（1100 件）+ 内容日历。
 *
 * `src/shop.json` 由 `scripts/gen_catalog.py` 从《全量配置 + 全量排序》生成，
 * 同一份数据也编译进了 Rust（`shop_table.rs`，用于校验价格与上架周），
 * 这里只负责前端展示与预览渲染。
 */
import raw from './shop.json';

export interface CatalogItem {
  id: string;
  name: string;
  kind: 'equip' | 'effect';
  slot: string;
  shape: string;
  c1: string;
  c2: string;
  price: number;
  rarity: string;
  trigger: string;
  /** 上架周：0 = 首发，之后每周一解锁一批 */
  week: number;
  desc: string;
  icon: string;
  motion: string;
}

interface CatalogFile {
  version: number;
  epoch: string;
  weeks: number;
  items: CatalogItem[];
}

const file = raw as unknown as CatalogFile;

export const CATALOG: CatalogItem[] = file.items;
export const CATALOG_EPOCH = file.epoch;
export const CATALOG_WEEKS = file.weeks;

const EPOCH_MS = new Date(`${CATALOG_EPOCH}T00:00:00+08:00`).getTime();

/** 当前是内容日历的第几周（与 Rust 侧 current_week 同一算法） */
export function currentWeek(): number {
  const days = Math.floor((Date.now() - EPOCH_MS) / 86_400_000);
  return days <= 0 ? 0 : Math.floor(days / 7);
}

export const BY_ID = new Map<string, CatalogItem>(CATALOG.map((item) => [item.id, item]));

export function itemById(id: string): CatalogItem | undefined {
  return BY_ID.get(id);
}

/** 已上架（本周及之前）的商品 */
export function releasedItems(week = currentWeek()): CatalogItem[] {
  return CATALOG.filter((item) => item.week <= week);
}

export function upcomingCount(week = currentWeek()): number {
  return CATALOG.filter((item) => item.week > week).length;
}

export const SLOT_LABEL: Record<string, string> = {
  head: '头部',
  face: '面部',
  neck: '颈部',
  back: '背部',
  paw: '爪部',
  floor: '地面',
  prop: '道具',
  fx: '特效',
};

export const RARITY_COLOR: Record<string, string> = {
  普通: '#9aa2ad',
  稀有: '#63b3ed',
  史诗: '#b794f6',
  传说: '#f6c453',
};
