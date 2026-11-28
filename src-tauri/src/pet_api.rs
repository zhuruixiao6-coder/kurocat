//! 宠物控制 API（对标「大肥鱼」的可编程接口）
//!
//! 职责：
//! 1) 保存一份可查询的宠物状态（最近动作、时间、能量、隐私模式）；
//! 2) 把外部 API 调用转成 Tauri 事件 `kuro-pet-command` 派发给桌宠窗口；
//! 3) 给 MCP 工具层提供统一的 dispatch 入口与状态快照。
//!
//! 设计原则：只做"转发 + 记账"，不直接操作渲染层，
//! 这样 stdio / HTTP 两种 MCP 传输、以及将来的 WebSocket 都能复用同一套入口。

use serde_json::{json, Value};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

/// 外部可触发的动作白名单（与前端 catEngine3d 的 PlayKind3D 对齐）
const ACTIONS: &[&str] = &[
    "gentle", "groom", "bunt", "softBlink", "stretch", "yawn", "tailChase", "pounce", "swat",
    "circle",
];

/// 表情白名单
const EXPRESSIONS: &[&str] = &["idle", "happy", "shy", "sleepy", "blink"];

#[derive(Default)]
struct PetApiState {
    last_action: String,
    last_at: u64,
    energy: u8,
    privacy: bool,
}

static APP: OnceLock<AppHandle> = OnceLock::new();
static STATE: OnceLock<Mutex<PetApiState>> = OnceLock::new();

fn state() -> &'static Mutex<PetApiState> {
    STATE.get_or_init(|| Mutex::new(PetApiState { energy: 100, ..Default::default() }))
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 应用启动时登记 AppHandle（只能登记一次，重复调用忽略）
pub fn init(app: AppHandle) {
    let _ = APP.set(app);
}

/// 当前状态快照，供 get_pet_state / 调用回执使用
pub fn snapshot() -> Value {
    let s = state().lock().unwrap();
    json!({
        "lastAction": if s.last_action.is_empty() { Value::Null } else { json!(s.last_action) },
        "lastActionAt": s.last_at,
        "energy": s.energy,
        "privacyMode": s.privacy,
        "windowReady": APP.get().is_some(),
    })
}

/// 动作校验：只允许白名单，避免把任意字符串丢给渲染层
pub fn validate_action(action: &str) -> Result<(), String> {
    if ACTIONS.contains(&action) {
        Ok(())
    } else {
        Err(format!(
            "Unknown action '{}'. Allowed: {}",
            action,
            ACTIONS.join(", ")
        ))
    }
}

pub fn validate_expression(expression: &str) -> Result<(), String> {
    if EXPRESSIONS.contains(&expression) {
        Ok(())
    } else {
        Err(format!(
            "Unknown expression '{}'. Allowed: {}",
            expression,
            EXPRESSIONS.join(", ")
        ))
    }
}

/// 派发一个动作到桌宠窗口
pub fn dispatch_action(action: &str, duration_ms: Option<u64>) -> Result<Value, String> {
    validate_action(action)?;
    let app = APP.get().ok_or_else(|| "Desktop pet window is not ready yet".to_string())?;

    let payload = json!({
        "action": "playAction",
        "kind": action,
        "durationMs": duration_ms.unwrap_or(0),
    });
    app.emit("kuro-pet-command", payload)
        .map_err(|e| format!("Failed to dispatch to pet window: {}", e))?;

    {
        let mut s = state().lock().unwrap();
        s.last_action = action.to_string();
        s.last_at = now_ms();
        // 每次动作消耗一点能量，用于"状态可观察"
        s.energy = s.energy.saturating_sub(3);
    }

    Ok(json!({
        "ok": true,
        "accepted": action,
        "state": snapshot(),
    }))
}

/// 派发表情
pub fn dispatch_expression(expression: &str, duration_ms: u64) -> Result<Value, String> {
    validate_expression(expression)?;
    let app = APP.get().ok_or_else(|| "Desktop pet window is not ready yet".to_string())?;

    let payload = json!({
        "action": "setExpression",
        "expression": expression,
        "durationMs": duration_ms.clamp(200, 60_000),
    });
    app.emit("kuro-pet-command", payload)
        .map_err(|e| format!("Failed to dispatch to pet window: {}", e))?;

    Ok(json!({
        "ok": true,
        "expression": expression,
        "durationMs": duration_ms.clamp(200, 60_000),
        "state": snapshot(),
    }))
}

/// 隐私模式（关眼护隐私，和设置里的开关同源）
pub fn set_privacy(active: bool) -> Result<Value, String> {
    let app = APP.get().ok_or_else(|| "Desktop pet window is not ready yet".to_string())?;
    app.emit("kuro-pet-command", json!({ "action": "setPrivacy", "active": active }))
        .map_err(|e| format!("Failed to dispatch to pet window: {}", e))?;

    {
        let mut s = state().lock().unwrap();
        s.privacy = active;
    }
    Ok(json!({ "ok": true, "privacyMode": active, "state": snapshot() }))
}

/// 能量读写（0-100），用于给外部"投喂/休息"这类玩法留接口
pub fn set_energy(value: u8) -> Value {
    let mut s = state().lock().unwrap();
    s.energy = value.min(100);
    json!({ "ok": true, "energy": s.energy, "state": snapshot() })
}
