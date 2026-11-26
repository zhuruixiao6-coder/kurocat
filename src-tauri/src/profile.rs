use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

/// 每敲这么多下，攒到 1 根猫条。
pub const KEYS_PER_FISH: u64 = 50;

/// 一次敲击最多影响多少条鱼干（防御异常入参）。
const MAX_KEYS_PER_CALL: u64 = 64;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    #[serde(default)]
    pub total_keys: u64,
    #[serde(default)]
    pub today_keys: u64,
    #[serde(default)]
    pub today: String,
    #[serde(default)]
    pub fish: u64,
    /// 距离下一条小鱼干还差几下（0..KEYS_PER_FISH-1）
    #[serde(default)]
    pub key_remainder: u64,
    #[serde(default)]
    pub owned: Vec<String>,
    /// slot -> item id，同一个 slot 只能装一件
    #[serde(default)]
    pub equipped: BTreeMap<String, String>,
    #[serde(default = "default_bubble")]
    pub bubble: bool,
}

fn default_bubble() -> bool {
    true
}

impl Default for Profile {
    fn default() -> Self {
        Self {
            total_keys: 0,
            today_keys: 0,
            today: today_string(),
            fish: 0,
            key_remainder: 0,
            owned: Vec::new(),
            equipped: BTreeMap::new(),
            bubble: true,
        }
    }
}

#[derive(Serialize, Clone, Debug)]
pub struct ShopItem {
    pub id: &'static str,
    pub name: &'static str,
    pub desc: &'static str,
    /// equip = 可穿戴，unlock = 解锁某项现有能力
    pub kind: &'static str,
    /// 穿戴类才有：face / neck / head / halo / effect
    pub slot: &'static str,
    /// 操作型触发说明（前端据此决定何时显示/迸发）
    pub trigger: &'static str,
    /// 稀有度（普通 / 稀有 / 史诗 / 传说）
    pub rarity: &'static str,
    /// 上架周序号：0 = 首发已上架，1..N 起按周依次解锁
    pub week: u32,
    pub price: u64,
}

pub use crate::shop_table::SHOP;

/// 内容日历的起点（周一）。第 0 周 = 首发，之后每周一解锁一批。
const CATALOG_EPOCH_DAYS: i64 = 20_760; // 2026-11-24

/// 当前是第几周（相对内容日历起点）。用东八区时间算，避免时区差异。
pub fn current_week() -> u32 {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
        + 8 * 3600;
    let days = (secs / 86_400) as i64;
    let diff = days - CATALOG_EPOCH_DAYS;
    if diff <= 0 {
        0
    } else {
        (diff / 7) as u32
    }
}

pub fn shop_item(id: &str) -> Option<&'static ShopItem> {
    SHOP.iter().find(|item| item.id == id)
}

struct Runtime {
    profile: Profile,
    last_flush: Instant,
    start: Instant,
    /// 每个 vk 上一次计数的时间（毫秒，相对 start），用于合并重复上报
    last_key_ms: [u64; 512],
}

fn state() -> &'static Mutex<Runtime> {
    static RT: OnceLock<Mutex<Runtime>> = OnceLock::new();
    RT.get_or_init(|| {
        let now = Instant::now();
        Mutex::new(Runtime {
            profile: load(),
            last_flush: now,
            start: now,
            last_key_ms: [0; 512],
        })
    })
}

/// 交给后台线程的低频副作用。按键处理线程只做内存累加 + 投递，绝不做 IO，
/// 否则磁盘或 WebView 一慢就会拖住按键队列，表现为「有时候不统计」。
enum Note {
    Update(Profile),
    /// 攒到一根猫条：立即落盘
    Earned(Profile),
    /// 退出前强制落盘
    Flush,
}

fn note_sender(app: &AppHandle) -> &'static mpsc::Sender<Note> {
    NOTE_TX.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<Note>();
        let handle = app.clone();
        std::thread::spawn(move || run_writer(handle, rx));
        tx
    })
}

fn run_writer(app: AppHandle, rx: mpsc::Receiver<Note>) {
    let mut pending: Option<Profile> = None;
    let mut force_save = false;
    let mut last_emit = Instant::now() - Duration::from_secs(1);
    let mut last_save = Instant::now();

    loop {
        match rx.recv_timeout(Duration::from_millis(45)) {
            Ok(Note::Update(p)) => pending = Some(p),
            Ok(Note::Earned(p)) => {
                pending = Some(p);
                force_save = true;
            }
            Ok(Note::Flush) => force_save = true,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }

        let Some(profile) = pending.clone() else {
            continue;
        };
        if last_emit.elapsed() >= Duration::from_millis(70) {
            last_emit = Instant::now();
            let _ = app.emit("kuro-profile", &profile);
        }
        if force_save || last_save.elapsed() >= Duration::from_millis(800) {
            force_save = false;
            last_save = Instant::now();
            pending = None;
            save(&profile);
        }
    }

    if let Some(profile) = pending {
        save(&profile);
    }
}

fn profile_path() -> PathBuf {
    crate::config::app_data_dir().join("profile.json")
}

/// 配色变体已下线：acc_xxx_2 / _3 / _4 / _5 一律并回 _1，
/// 老存档里的变体装备不会变成「查不到的东西」。
fn migrate_variant_id(id: &str) -> String {
    if !id.starts_with("acc_") {
        return id.to_string();
    }
    if let Some(pos) = id.rfind('_') {
        let (head, tail) = id.split_at(pos);
        if let Ok(n) = tail[1..].parse::<u32>() {
            if n >= 2 {
                return format!("{}_1", head);
            }
        }
    }
    id.to_string()
}

fn load() -> Profile {
    let path = profile_path();
    let Ok(raw) = fs::read_to_string(&path) else {
        return Profile::default();
    };
    match serde_json::from_str::<Profile>(&raw) {
        Ok(mut parsed) => {
            let today = today_string();
            if parsed.today != today {
                parsed.today = today;
                parsed.today_keys = 0;
            }
            if parsed.key_remainder >= KEYS_PER_FISH {
                parsed.key_remainder = 0;
            }
            // 变体合并 + 去重
            let mut seen = std::collections::HashSet::new();
            parsed.owned = parsed
                .owned
                .iter()
                .map(|id| migrate_variant_id(id))
                .filter(|id| seen.insert(id.clone()))
                .collect();
            parsed.equipped = parsed
                .equipped
                .iter()
                .map(|(slot, id)| (slot.clone(), migrate_variant_id(id)))
                .collect();
            parsed
        }
        Err(_) => Profile::default(),
    }
}

fn save(profile: &Profile) {
    // 后台写盘线程与命令线程（购买/装备）可能同时触发，串行化避免 tmp 文件互相踩。
    static SAVE_GUARD: Mutex<()> = Mutex::new(());
    let _guard = SAVE_GUARD.lock();
    let path = profile_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let Ok(json) = serde_json::to_string_pretty(profile) else {
        return;
    };
    let tmp = path.with_extension("json.tmp");
    if fs::write(&tmp, json).is_ok() && fs::rename(&tmp, &path).is_err() {
        let _ = fs::remove_file(&tmp);
    }
}

/// 键盘钩子每按下一个「新的」键调用一次（按住产生的连续重复不算）。
///
/// 这里必须保持「纯内存 + 一次 mpsc 投递」：不写盘、不 emit。
/// 之前把落盘和广播留在本函数里，磁盘或 WebView 一慢就会堵住按键处理线程，
/// 表现为「有时候不统计」，所以副作用全部移交后台写盘线程。
pub fn record_keypress(app: &AppHandle, vk: u32) {
    let mut rt = match state().lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    // 只挡「同一物理按键被毫秒级重复上报」，8ms 远短于人手的同键连击极限，
    // 不会吞掉正常打字。
    let now_ms = rt.start.elapsed().as_millis() as u64;
    if vk < 512 {
        let last = rt.last_key_ms[vk as usize];
        if last != 0 && now_ms.saturating_sub(last) < 8 {
            return;
        }
        rt.last_key_ms[vk as usize] = now_ms;
    }

    let today = today_string();
    if rt.profile.today != today {
        rt.profile.today = today;
        rt.profile.today_keys = 0;
    }

    rt.profile.total_keys = rt.profile.total_keys.saturating_add(1);
    rt.profile.today_keys = rt.profile.today_keys.saturating_add(1);
    rt.profile.key_remainder += 1;
    let earned = rt.profile.key_remainder >= KEYS_PER_FISH;
    if earned {
        rt.profile.key_remainder -= KEYS_PER_FISH;
        rt.profile.fish = rt.profile.fish.saturating_add(1);
    }

    let note = if earned {
        Note::Earned(rt.profile.clone())
    } else {
        Note::Update(rt.profile.clone())
    };
    drop(rt);

    let _ = note_sender(app).send(note);
}

pub fn snapshot() -> Profile {
    let rt = match state().lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    rt.profile.clone()
}

fn with_profile<F>(app: Option<&AppHandle>, mutator: F) -> Result<Profile, String>
where
    F: FnOnce(&mut Profile) -> Result<(), String>,
{
    let snapshot = {
        let mut rt = match state().lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        mutator(&mut rt.profile)?;
        rt.last_flush = Instant::now();
        rt.profile.clone()
    };
    save(&snapshot);
    if let Some(app) = app {
        let _ = app.emit("kuro-profile", &snapshot);
    }
    Ok(snapshot)
}

pub fn buy(app: &AppHandle, id: &str) -> Result<Profile, String> {
    let item = shop_item(id).ok_or_else(|| "没有这件商品".to_string())?;
    if item.week > current_week() {
        return Err(format!("这件要到第 {} 周才上架", item.week + 1));
    }
    let id = item.id.to_string();
    with_profile(Some(app), move |profile| {
        if profile.owned.iter().any(|owned| owned == &id) {
            return Err("已经拥有了".to_string());
        }
        if profile.fish < item.price {
            return Err(format!("还差 {} 根猫条", item.price - profile.fish));
        }
        profile.fish -= item.price;
        profile.owned.push(id.clone());
        if item.kind == "equip" || item.kind == "effect" {
            profile.equipped.insert(item.slot.to_string(), id);
        }
        Ok(())
    })
}

pub fn equip(app: &AppHandle, id: &str) -> Result<Profile, String> {
    let item = shop_item(id).ok_or_else(|| "没有这件商品".to_string())?;
    if item.kind != "equip" && item.kind != "effect" {
        return Err("这件不需要装备".to_string());
    }
    let id = item.id.to_string();
    let slot = item.slot.to_string();
    with_profile(Some(app), move |profile| {
        if !profile.owned.iter().any(|owned| owned == &id) {
            return Err("还没有拥有它".to_string());
        }
        let already = profile
            .equipped
            .get(&slot)
            .map(|current| current == &id)
            .unwrap_or(false);
        if already {
            profile.equipped.remove(&slot);
        } else {
            profile.equipped.insert(slot, id);
        }
        Ok(())
    })
}

pub fn unequip(app: &AppHandle, slot: &str) -> Result<Profile, String> {
    let slot = slot.to_string();
    with_profile(Some(app), move |profile| {
        profile.equipped.remove(&slot);
        Ok(())
    })
}

pub fn set_bubble(app: &AppHandle, enabled: bool) -> Profile {
    let result = with_profile(Some(app), move |profile| {
        profile.bubble = enabled;
        Ok(())
    });
    match result {
        Ok(profile) => profile,
        Err(_) => snapshot(),
    }
}

pub fn add_fish(app: &AppHandle, amount: u64) -> Result<Profile, String> {
    let amount = amount.min(MAX_KEYS_PER_CALL);
    with_profile(Some(app), move |profile| {
        profile.fish = profile.fish.saturating_add(amount);
        Ok(())
    })
}

pub fn flush_now() {
    let snapshot = snapshot();
    save(&snapshot);
    if let Some(tx) = NOTE_TX.get() {
        let _ = tx.send(Note::Flush);
    }
}

/// 供 `flush_now` 直接检查 sender 是否已创建（不主动创建）。
static NOTE_TX: OnceLock<mpsc::Sender<Note>> = OnceLock::new();

fn today_string() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
        + 8 * 3600;
    let days = (secs / 86_400) as i64;
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}-{month:02}-{day:02}")
}

/// Howard Hinnant 的 days -> civil 算法，避免为一个日期字符串引入依赖。
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}
