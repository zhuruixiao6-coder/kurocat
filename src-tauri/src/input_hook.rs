use serde::Serialize;
#[cfg(windows)]
use std::sync::atomic::{AtomicI32, AtomicU32};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum InputEvent {
    KeyDown {
        vk: u32,
        scan: u32,
        repeat: bool,
    },
    KeyUp {
        vk: u32,
        scan: u32,
    },
    MouseDown {
        button: String,
    },
    MouseUp {
        button: String,
    },
    MouseWheel {
        delta: i16,
    },
    MouseMove {
        x: i32,
        y: i32,
        nx: f64,
        ny: f64,
    },
    PrivacyTyping,
}

#[allow(dead_code)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
#[repr(u8)]
enum KeySource {
    Primary = 0, // Windows WH_KEYBOARD_LL or macOS CGEventTap
    Hid = 1,     // macOS IOHIDManager (Karabiner VirtualHIDKeyboard / Secure Input resilient)
}

enum RawHookMsg {
    KeyDown {
        vk: u32,
        scan: u32,
        source: KeySource,
    },
    KeyUp {
        vk: u32,
        scan: u32,
        source: KeySource,
    },
    MouseDown(&'static str),
    MouseUp(&'static str),
    MouseWheel(i16),
    MouseMove {
        x: i32,
        y: i32,
    },
}

static HOOK_TX: OnceLock<mpsc::Sender<RawHookMsg>> = OnceLock::new();
static KEY_EVENTS_RECEIVED: AtomicU64 = AtomicU64::new(0);
static ALT_HELD: AtomicBool = AtomicBool::new(false);
static HOOKS_PAUSED: AtomicBool = AtomicBool::new(false);
static PASSWORD_PRIVACY_ACTIVE: AtomicBool = AtomicBool::new(false);

pub fn set_password_privacy_active(active: bool) {
    PASSWORD_PRIVACY_ACTIVE.store(active, Ordering::SeqCst);
}
#[cfg(windows)]
static WIN_HOOK_TID: AtomicU32 = AtomicU32::new(0);
#[cfg(windows)]
static LAST_HOOK_MOUSE_MS: AtomicU32 = AtomicU32::new(0);
#[cfg(windows)]
static LAST_HOOK_MOUSE_X: AtomicI32 = AtomicI32::new(i32::MIN);
#[cfg(windows)]
static LAST_HOOK_MOUSE_Y: AtomicI32 = AtomicI32::new(i32::MIN);
#[cfg(windows)]
const WM_KURO_PAUSE_TOGGLE: u32 = 0x8007; // WM_APP + 7
/// 看门狗发现钩子掉了（系统静默卸载 / 超时被回收）时投递，让钩子线程重装
const WM_KURO_REHOOK: u32 = 0x8008; // WM_APP + 8

fn is_alt_vk(vk: u32) -> bool {
    matches!(vk, 0x12 | 0xA4 | 0xA5)
}

pub fn is_alt_pressed() -> bool {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_MENU};
        let async_down = unsafe { (GetAsyncKeyState(VK_MENU as i32) as u16 & 0x8000) != 0 };
        if async_down {
            return true;
        }
    }
    #[cfg(target_os = "macos")]
    {
        if macos_hook::is_alt_pressed() {
            return true;
        }
    }
    #[cfg(target_os = "linux")]
    {
        if linux_hook::is_alt_pressed() {
            return true;
        }
    }
    ALT_HELD.load(Ordering::Relaxed)
}

pub fn set_hooks_paused(paused: bool) {
    HOOKS_PAUSED.store(paused, Ordering::SeqCst);
    if paused {
        ALT_HELD.store(false, Ordering::Relaxed);
    }
    #[cfg(windows)]
    {
        let tid = WIN_HOOK_TID.load(Ordering::SeqCst);
        if tid != 0 {
            unsafe {
                windows_sys::Win32::UI::WindowsAndMessaging::PostThreadMessageW(
                    tid,
                    WM_KURO_PAUSE_TOGGLE,
                    paused as usize,
                    0,
                );
            }
        }
    }
}

/// Deduplicates held key repeats AND cross-source duplicates when macOS CGEventTap
/// and IOHIDManager both report the same physical or Karabiner-synthesized keystroke.
struct KeyDeduplicator {
    logical_pressed: [bool; 512],
    last_down: [Option<(Instant, KeySource)>; 512],
}

impl KeyDeduplicator {
    fn new() -> Self {
        Self {
            logical_pressed: [false; 512],
            last_down: [None; 512],
        }
    }

    /// Returns `Some(repeat)` if a `KeyDown` should be emitted, or `None` if suppressed
    /// as a cross-source duplicate.
    fn on_key_down(&mut self, vk: u32, source: KeySource, now: Instant) -> Option<bool> {
        let idx = vk as usize;
        if idx >= 512 {
            return Some(false);
        }
        if self.logical_pressed[idx] {
            if let Some((_, prev_src)) = self.last_down[idx] {
                if prev_src != source {
                    // Shadow event from the parallel capture channel while key is already held.
                    return None;
                }
            }
            // 真正按住不放：系统自动重复（不管快慢）统一算重复，绝不加计数。
            // 丢了 KeyUp 的“假按住”由 sweep_released() 按物理键位清掉，不靠时间猜。
            return Some(true);
        }
        // Guard against micro-tap race: channel A delivered Down+Up, then channel B delivers
        // the same keystroke's Down a few ms later.
        if let Some((prev_at, prev_src)) = self.last_down[idx] {
            if prev_src != source && now.duration_since(prev_at) < Duration::from_millis(40) {
                return None;
            }
        }
        self.logical_pressed[idx] = true;
        self.last_down[idx] = Some((now, source));
        Some(false)
    }

    /// 周期性对账：键其实已经松开、但我们没收到 KeyUp 时，清掉“按住”标记，
    /// 避免一个丢了 KeyUp 的键从此再也不计数。
    fn sweep_released(&mut self) {
        #[cfg(windows)]
        {
            for i in 0..512usize {
                if !self.logical_pressed[i] {
                    continue;
                }
                let down = unsafe {
                    (windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState(i as i32) as u16
                        & 0x8000)
                        != 0
                };
                // VK 0x10..0x12（Shift/Ctrl/Alt）用通用码查不准，跳过
                if !down && !(0x10..=0x12).contains(&i) {
                    self.logical_pressed[i] = false;
                }
            }
        }
    }

    /// Returns `true` if a `KeyUp` should be emitted.
    fn on_key_up(&mut self, vk: u32, _source: KeySource) -> bool {
        let idx = vk as usize;
        if idx >= 512 {
            return true;
        }
        if !self.logical_pressed[idx] {
            return false;
        }
        self.logical_pressed[idx] = false;
        true
    }
}

/// Maps USB HID Usage ID (Usage Page 0x07: Keyboard/Keypad) to Windows VK codes
/// used by the KuroCat frontend keyboard layout.
#[allow(dead_code)]
pub fn hid_usage_to_vk(usage: u32) -> Option<u32> {
    let vk = match usage {
        // Letters A..Z (0x04..=0x1D)
        0x04..=0x1D => 0x41 + (usage - 0x04),
        // Digits 1..9 (0x1E..=0x26), 0 (0x27)
        0x1E..=0x26 => 0x31 + (usage - 0x1E),
        0x27 => 0x30,
        // Control & editing
        0x28 => 0x0D, // Return / Enter
        0x29 => 0x1B, // Escape
        0x2A => 0x08, // Backspace (Delete)
        0x2B => 0x09, // Tab
        0x2C => 0x20, // Space
        // Punctuation
        0x2D => 0xBD, // -
        0x2E => 0xBB, // =
        0x2F => 0xDB, // [
        0x30 => 0xDD, // ]
        0x31 | 0x32 => 0xDC, // \ and Non-US #
        0x33 => 0xBA, // ;
        0x34 => 0xDE, // '
        0x35 => 0xC0, // `
        0x36 => 0xBC, // ,
        0x37 => 0xBE, // .
        0x38 => 0xBF, // /
        0x39 => 0x14, // CapsLock
        // Function keys F1..F12 (0x3A..=0x45)
        0x3A..=0x45 => 0x70 + (usage - 0x3A),
        // Navigation
        0x49 => 0x2D, // Insert
        0x4A => 0x24, // Home
        0x4B => 0x21, // PageUp
        0x4C => 0x2E, // Forward Delete
        0x4D => 0x23, // End
        0x4E => 0x22, // PageDown
        0x4F => 0x27, // Right
        0x50 => 0x25, // Left
        0x51 => 0x28, // Down
        0x52 => 0x26, // Up
        // Numpad
        0x53 => 0x90,  // NumLock / Clear
        0x54 => 0x6F,  // Numpad /
        0x55 => 0x6A,  // Numpad *
        0x56 => 0x6D,  // Numpad -
        0x57 => 0x6B,  // Numpad +
        0x58 => 0x10D, // Numpad Enter
        0x59..=0x61 => 0x61 + (usage - 0x59), // Numpad 1..9
        0x62 => 0x60,  // Numpad 0
        0x63 => 0x6E,  // Numpad .
        // Modifiers
        0xE0 => 0xA2, // Left Control
        0xE1 => 0xA0, // Left Shift
        0xE2 => 0xA4, // Left Option / Alt
        0xE3 => 0x5B, // Left Command / GUI
        0xE4 => 0xA3, // Right Control
        0xE5 => 0xA1, // Right Shift
        0xE6 => 0xA5, // Right Option / Alt
        0xE7 => 0x5C, // Right Command / GUI
        _ => return None,
    };
    Some(vk)
}

/// Maps Linux evdev keycodes (`<linux/input-event-codes.h>`, also X11 evdev keycode - 8)
/// to Windows VK codes used by the KuroCat frontend keyboard layout.
#[allow(dead_code)]
pub fn linux_evdev_to_vk(code: u16) -> Option<u32> {
    let vk = match code {
        1 => 0x1B,   // KEY_ESC
        2..=10 => 0x31 + (code as u32 - 2), // KEY_1..KEY_9
        11 => 0x30,  // KEY_0
        12 => 0xBD,  // KEY_MINUS
        13 => 0xBB,  // KEY_EQUAL
        14 => 0x08,  // KEY_BACKSPACE
        15 => 0x09,  // KEY_TAB
        16 => 0x51,  // Q
        17 => 0x57,  // W
        18 => 0x45,  // E
        19 => 0x52,  // R
        20 => 0x54,  // T
        21 => 0x59,  // Y
        22 => 0x55,  // U
        23 => 0x49,  // I
        24 => 0x4F,  // O
        25 => 0x50,  // P
        26 => 0xDB,  // KEY_LEFTBRACE [
        27 => 0xDD,  // KEY_RIGHTBRACE ]
        28 => 0x0D,  // KEY_ENTER
        29 => 0xA2,  // KEY_LEFTCTRL
        30 => 0x41,  // A
        31 => 0x53,  // S
        32 => 0x44,  // D
        33 => 0x46,  // F
        34 => 0x47,  // G
        35 => 0x48,  // H
        36 => 0x4A,  // J
        37 => 0x4B,  // K
        38 => 0x4C,  // L
        39 => 0xBA,  // KEY_SEMICOLON ;
        40 => 0xDE,  // KEY_APOSTROPHE '
        41 => 0xC0,  // KEY_GRAVE `
        42 => 0xA0,  // KEY_LEFTSHIFT
        43 => 0xDC,  // KEY_BACKSLASH \
        44 => 0x5A,  // Z
        45 => 0x58,  // X
        46 => 0x43,  // C
        47 => 0x56,  // V
        48 => 0x42,  // B
        49 => 0x4E,  // N
        50 => 0x4D,  // M
        51 => 0xBC,  // KEY_COMMA ,
        52 => 0xBE,  // KEY_DOT .
        53 => 0xBF,  // KEY_SLASH /
        54 => 0xA1,  // KEY_RIGHTSHIFT
        55 => 0x6A,  // KEY_KPASTERISK
        56 => 0xA4,  // KEY_LEFTALT
        57 => 0x20,  // KEY_SPACE
        58 => 0x14,  // KEY_CAPSLOCK
        59..=68 => 0x70 + (code as u32 - 59), // KEY_F1..KEY_F10
        69 => 0x90,  // KEY_NUMLOCK
        70 => 0x91,  // KEY_SCROLLLOCK
        71 => 0x67,  // KEY_KP7
        72 => 0x68,  // KEY_KP8
        73 => 0x69,  // KEY_KP9
        74 => 0x6D,  // KEY_KPMINUS
        75 => 0x64,  // KEY_KP4
        76 => 0x65,  // KEY_KP5
        77 => 0x66,  // KEY_KP6
        78 => 0x6B,  // KEY_KPPLUS
        79 => 0x61,  // KEY_KP1
        80 => 0x62,  // KEY_KP2
        81 => 0x63,  // KEY_KP3
        82 => 0x60,  // KEY_KP0
        83 => 0x6E,  // KEY_KPDOT
        87 => 0x7A,  // KEY_F11
        88 => 0x7B,  // KEY_F12
        96 => 0x10D, // KEY_KPENTER (distinguished Numpad Enter)
        97 => 0xA3,  // KEY_RIGHTCTRL
        98 => 0x6F,  // KEY_KPSLASH
        99 => 0x2C,  // KEY_SYSRQ (PrintScreen)
        100 => 0xA5, // KEY_RIGHTALT
        102 => 0x24, // KEY_HOME
        103 => 0x26, // KEY_UP
        104 => 0x21, // KEY_PAGEUP
        105 => 0x25, // KEY_LEFT
        106 => 0x27, // KEY_RIGHT
        107 => 0x23, // KEY_END
        108 => 0x28, // KEY_DOWN
        109 => 0x22, // KEY_PAGEDOWN
        110 => 0x2D, // KEY_INSERT
        111 => 0x2E, // KEY_DELETE
        119 => 0x13, // KEY_PAUSE
        125 => 0x5B, // KEY_LEFTMETA (Super/Win)
        126 => 0x5C, // KEY_RIGHTMETA
        127 => 0x5D, // KEY_COMPOSE (Menu)
        _ => return None,
    };
    Some(vk)
}

pub fn start_global_hooks(app: AppHandle) {
    let (tx, rx) = mpsc::channel::<RawHookMsg>();
    let _ = HOOK_TX.set(tx);

    // Dispatcher thread: deduplicates held key repeats & dual-channel macOS events,
    // throttles mouse moves to ~60Hz, and reconciles lost KeyUp/MouseUp events (Fixes #3 & #4).
    std::thread::spawn(move || {
        let mut dedup = KeyDeduplicator::new();
        let mut last_mouse_emit = Instant::now() - Duration::from_secs(1);
        let mut last_mouse_xy: Option<(i32, i32)> = None;
        let mut mouse_down = [false; 3]; // 0: left, 1: right, 2: middle
        let mut last_reconcile = Instant::now();

        let btn_index = |btn: &str| -> Option<usize> {
            match btn {
                "left" => Some(0),
                "right" => Some(1),
                "middle" => Some(2),
                _ => None,
            }
        };

        let emit_input = |app: &AppHandle, ev: InputEvent| {
            crate::obs::broadcast_input(&ev);
            let _ = app.emit("kuro-input", ev);
        };

        let release_all_held =
            |app: &AppHandle, dedup: &mut KeyDeduplicator, mouse_down: &mut [bool; 3]| {
                for (i, name) in [(0usize, "left"), (1, "right"), (2, "middle")] {
                    if mouse_down[i] {
                        mouse_down[i] = false;
                        emit_input(
                            app,
                            InputEvent::MouseUp {
                                button: name.to_string(),
                            },
                        );
                    }
                }
                for vk in 0..dedup.logical_pressed.len() {
                    if dedup.logical_pressed[vk] {
                        dedup.logical_pressed[vk] = false;
                        emit_input(
                            app,
                            InputEvent::KeyUp {
                                vk: vk as u32,
                                scan: 0,
                            },
                        );
                    }
                }
            };

        #[cfg(windows)]
        let reconcile_windows_held_state =
            |app: &AppHandle, dedup: &mut KeyDeduplicator, mouse_down: &mut [bool; 3]| {
                use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
                    GetAsyncKeyState, VK_LBUTTON, VK_MBUTTON, VK_RBUTTON,
                };
                use windows_sys::Win32::UI::WindowsAndMessaging::{
                    GetSystemMetrics, SM_SWAPBUTTON,
                };

                let swapped = unsafe { GetSystemMetrics(SM_SWAPBUTTON) != 0 };
                let (left_vk, right_vk) = if swapped {
                    (VK_RBUTTON as i32, VK_LBUTTON as i32)
                } else {
                    (VK_LBUTTON as i32, VK_RBUTTON as i32)
                };
                let checks = [
                    (0usize, left_vk, "left"),
                    (1usize, right_vk, "right"),
                    (2usize, VK_MBUTTON as i32, "middle"),
                ];
                for (idx, os_vk, name) in checks {
                    if mouse_down[idx] {
                        let physically_down =
                            unsafe { (GetAsyncKeyState(os_vk) as u16 & 0x8000) != 0 };
                        if !physically_down {
                            mouse_down[idx] = false;
                            emit_input(
                                app,
                                InputEvent::MouseUp {
                                    button: name.to_string(),
                                },
                            );
                        }
                    }
                }

                for vk in 1..dedup.logical_pressed.len() {
                    if !dedup.logical_pressed[vk] {
                        continue;
                    }
                    let os_vk = if vk == 0x10D {
                        0x0D // Numpad Enter maps to VK_RETURN in GetAsyncKeyState
                    } else if vk < 256 {
                        vk as i32
                    } else {
                        continue;
                    };
                    let physically_down =
                        unsafe { (GetAsyncKeyState(os_vk) as u16 & 0x8000) != 0 };
                    if !physically_down {
                        dedup.logical_pressed[vk] = false;
                        if is_alt_vk(vk as u32) {
                            ALT_HELD.store(false, Ordering::Relaxed);
                        }
                        emit_input(
                            app,
                            InputEvent::KeyUp {
                                vk: vk as u32,
                                scan: 0,
                            },
                        );
                    }
                }
            };

        let mut last_sweep = Instant::now();
        loop {
            let msg = match rx.recv_timeout(Duration::from_millis(120)) {
                Ok(m) => Some(m),
                Err(mpsc::RecvTimeoutError::Timeout) => None,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            };

            // 不管有没有事件，每 150ms 对账一次：
            // 把“其实已经松开、但 KeyUp 丢了”的键复位（长按时这些键物理上仍是按下，不会被误清）。
            if last_sweep.elapsed() >= Duration::from_millis(150) {
                dedup.sweep_released();
                last_sweep = Instant::now();
            }

            if HOOKS_PAUSED.load(Ordering::Relaxed) {
                release_all_held(&app, &mut dedup, &mut mouse_down);
                continue;
            }

            if let Some(msg) = msg {
                match msg {
                    RawHookMsg::KeyDown { vk, scan, source } => {
                        if is_alt_vk(vk) {
                            ALT_HELD.store(true, Ordering::Relaxed);
                        }
                        if PASSWORD_PRIVACY_ACTIVE.load(Ordering::Relaxed) {
                            // Zero password keystrokes leave Rust — only emit a content-less privacy pulse!
                            if let Some(repeat) = dedup.on_key_down(vk, source, Instant::now()) {
                                if !repeat {
                                    emit_input(&app, InputEvent::PrivacyTyping);
                                }
                            }
                            continue;
                        }
                        if let Some(repeat) = dedup.on_key_down(vk, source, Instant::now()) {
                            if !repeat {
                                KEY_EVENTS_RECEIVED.fetch_add(1, Ordering::Relaxed);
                                crate::profile::record_keypress(&app, vk);
                            }
                            emit_input(&app, InputEvent::KeyDown { vk, scan, repeat });
                        }
                    }
                    RawHookMsg::KeyUp { vk, scan, source } => {
                        if is_alt_vk(vk) {
                            ALT_HELD.store(false, Ordering::Relaxed);
                        }
                        if PASSWORD_PRIVACY_ACTIVE.load(Ordering::Relaxed) {
                            let _ = dedup.on_key_up(vk, source);
                            continue;
                        }
                        if dedup.on_key_up(vk, source) {
                            emit_input(&app, InputEvent::KeyUp { vk, scan });
                        }
                    }
                    RawHookMsg::MouseDown(btn) => {
                        if let Some(i) = btn_index(btn) {
                            mouse_down[i] = true;
                        }
                        emit_input(
                            &app,
                            InputEvent::MouseDown {
                                button: btn.to_string(),
                            },
                        );
                    }
                    RawHookMsg::MouseUp(btn) => {
                        if let Some(i) = btn_index(btn) {
                            mouse_down[i] = false;
                        }
                        emit_input(
                            &app,
                            InputEvent::MouseUp {
                                button: btn.to_string(),
                            },
                        );
                    }
                    RawHookMsg::MouseWheel(delta) => {
                        emit_input(&app, InputEvent::MouseWheel { delta });
                    }
                    RawHookMsg::MouseMove { x, y } => {
                        // Drop synthetic 0px repeats and 1px optical sensor desk vibration so sleeping cats are never falsely woken!
                        if let Some((lx, ly)) = last_mouse_xy {
                            if (x - lx).abs() <= 1 && (y - ly).abs() <= 1 {
                                continue;
                            }
                        }
                        let now = Instant::now();
                        // Cat eye-tracking & mouse springs smoothly interpolate 30Hz (20Hz in PC games),
                        // cutting 1000Hz-8000Hz gaming mouse IPC/JSON storms dramatically.
                        let min_gap = if crate::game_detect::is_game_active() {
                            Duration::from_millis(50)
                        } else {
                            Duration::from_millis(33)
                        };
                        if now.duration_since(last_mouse_emit) >= min_gap {
                            last_mouse_emit = now;
                            last_mouse_xy = Some((x, y));
                            let (nx, ny) = normalize_screen_point(x, y);
                            emit_input(&app, InputEvent::MouseMove { x, y, nx, ny });
                        }
                    }
                }
            }

            #[cfg(windows)]
            {
                let now = Instant::now();
                if now.duration_since(last_reconcile) >= Duration::from_millis(450) {
                    last_reconcile = now;
                    reconcile_windows_held_state(&app, &mut dedup, &mut mouse_down);
                }
            }
            #[cfg(not(windows))]
            let _ = &mut last_reconcile;
        }
    });

    #[cfg(windows)]
    std::thread::spawn(|| {
        run_windows_hook_loop();
    });

    // 看门狗：Windows 在低级钩子回调超时（LowLevelHooksTimeout）时会静默摘掉钩子，
    // 表现就是「宠物还在置顶显示，但敲键盘毫无反应」。这里对比「系统有输入」与
    // 「我们收到了输入」，不一致就通知钩子线程重装。
    #[cfg(windows)]
    std::thread::spawn(|| {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
        let mut last_tick: u32 = 0;
        let mut last_events = KEY_EVENTS_RECEIVED.load(Ordering::Relaxed);
        let mut last_mouse = LAST_HOOK_MOUSE_MS.load(Ordering::Relaxed);
        let mut last_rehook = Instant::now() - Duration::from_secs(60);
        loop {
            std::thread::sleep(Duration::from_secs(3));
            if HOOKS_PAUSED.load(Ordering::SeqCst) {
                last_tick = 0;
                continue;
            }
            let mut info = LASTINPUTINFO {
                cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
                dwTime: 0,
            };
            let ok = unsafe { GetLastInputInfo(&mut info) };
            if ok == 0 {
                continue;
            }
            let events = KEY_EVENTS_RECEIVED.load(Ordering::Relaxed);
            let mouse = LAST_HOOK_MOUSE_MS.load(Ordering::Relaxed);
            let system_moved = last_tick != 0 && info.dwTime.wrapping_sub(last_tick) >= 400;
            let we_moved = events != last_events || mouse != last_mouse;
            if system_moved && !we_moved && last_rehook.elapsed() >= Duration::from_secs(20) {
                last_rehook = Instant::now();
                let tid = WIN_HOOK_TID.load(Ordering::SeqCst);
                if tid != 0 {
                    unsafe {
                        windows_sys::Win32::UI::WindowsAndMessaging::PostThreadMessageW(
                            tid,
                            WM_KURO_REHOOK,
                            0,
                            0,
                        );
                    }
                }
            }
            last_tick = info.dwTime;
            last_events = events;
            last_mouse = mouse;
        }
    });

    #[cfg(target_os = "macos")]
    std::thread::spawn(|| {
        macos_hook::run_macos_hook_loop();
    });

    #[cfg(target_os = "linux")]
    std::thread::spawn(|| {
        linux_hook::run_linux_hook_loop();
    });
}

#[cfg(windows)]
fn normalize_screen_point(x: i32, y: i32) -> (f64, f64) {
    use std::cell::Cell;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN,
        SM_YVIRTUALSCREEN,
    };

    thread_local! {
        static CACHE: Cell<(Instant, f64, f64, f64, f64)> =
            Cell::new((Instant::now() - Duration::from_secs(10), 0.0, 0.0, 1920.0, 1080.0));
    }

    let (vx, vy, vw, vh) = CACHE.with(|c| {
        let (ts, vx, vy, vw, vh) = c.get();
        if ts.elapsed() >= Duration::from_secs(2) {
            let (nvx, nvy, nvw, nvh) = unsafe {
                (
                    GetSystemMetrics(SM_XVIRTUALSCREEN) as f64,
                    GetSystemMetrics(SM_YVIRTUALSCREEN) as f64,
                    GetSystemMetrics(SM_CXVIRTUALSCREEN).max(1) as f64,
                    GetSystemMetrics(SM_CYVIRTUALSCREEN).max(1) as f64,
                )
            };
            c.set((Instant::now(), nvx, nvy, nvw, nvh));
            (nvx, nvy, nvw, nvh)
        } else {
            (vx, vy, vw, vh)
        }
    });

    let nx = ((x as f64 - vx) / vw).clamp(0.0, 1.0);
    let ny = ((y as f64 - vy) / vh).clamp(0.0, 1.0);
    (nx, ny)
}

#[cfg(target_os = "macos")]
fn normalize_screen_point(x: i32, y: i32) -> (f64, f64) {
    let (w, h) = macos_hook::main_display_size();
    let nx = (x as f64 / w.max(1.0)).clamp(0.0, 1.0);
    let ny = (y as f64 / h.max(1.0)).clamp(0.0, 1.0);
    (nx, ny)
}

#[cfg(target_os = "linux")]
fn normalize_screen_point(x: i32, y: i32) -> (f64, f64) {
    let (w, h) = linux_hook::primary_screen_size();
    let nx = (x as f64 / (w.max(1) as f64)).clamp(0.0, 1.0);
    let ny = (y as f64 / (h.max(1) as f64)).clamp(0.0, 1.0);
    (nx, ny)
}

#[cfg(all(not(windows), not(target_os = "macos"), not(target_os = "linux")))]
fn normalize_screen_point(_x: i32, _y: i32) -> (f64, f64) {
    (0.5, 0.5)
}

#[cfg(windows)]
unsafe extern "system" fn keyboard_hook_proc(code: i32, wparam: usize, lparam: isize) -> isize {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, KBDLLHOOKSTRUCT, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
    };

    if code >= 0 {
        let kb = &*(lparam as *const KBDLLHOOKSTRUCT);
        let msg = wparam as u32;
        // Distinguish Numpad Enter (VK_RETURN with LLKHF_EXTENDED=0x01) from main Enter for 108-key layouts
        let mapped_vk = if kb.vkCode == 0x0d && (kb.flags & 0x01) != 0 {
            0x10d
        } else {
            kb.vkCode
        };
        if let Some(tx) = HOOK_TX.get() {
            match msg {
                WM_KEYDOWN | WM_SYSKEYDOWN => {
                    let _ = tx.send(RawHookMsg::KeyDown {
                        vk: mapped_vk,
                        scan: kb.scanCode,
                        source: KeySource::Primary,
                    });
                }
                WM_KEYUP | WM_SYSKEYUP => {
                    let _ = tx.send(RawHookMsg::KeyUp {
                        vk: mapped_vk,
                        scan: kb.scanCode,
                        source: KeySource::Primary,
                    });
                }
                _ => {}
            }
        }
    }
    CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
}

#[cfg(windows)]
unsafe extern "system" fn mouse_hook_proc(code: i32, wparam: usize, lparam: isize) -> isize {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, MSLLHOOKSTRUCT, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MBUTTONDOWN,
        WM_MBUTTONUP, WM_MOUSEMOVE, WM_MOUSEWHEEL, WM_RBUTTONDOWN, WM_RBUTTONUP,
    };

    if code >= 0 {
        let ms = &*(lparam as *const MSLLHOOKSTRUCT);
        let msg = wparam as u32;
        if let Some(tx) = HOOK_TX.get() {
            match msg {
                WM_MOUSEMOVE => {
                    // Ultra-fast in-hook pre-filter (zero syscalls!) so 1000Hz-8000Hz gaming mice
                    // never flood the Rust channel or stall WH_MOUSE_LL!
                    let px = ms.pt.x;
                    let py = ms.pt.y;
                    let lx = LAST_HOOK_MOUSE_X.load(Ordering::Relaxed);
                    let ly = LAST_HOOK_MOUSE_Y.load(Ordering::Relaxed);
                    let now_ms = ms.time;
                    let prev_ms = LAST_HOOK_MOUSE_MS.load(Ordering::Relaxed);
                    if ((px - lx).abs() > 1 || (py - ly).abs() > 1)
                        && (lx == i32::MIN || now_ms.wrapping_sub(prev_ms) >= 24)
                    {
                        LAST_HOOK_MOUSE_X.store(px, Ordering::Relaxed);
                        LAST_HOOK_MOUSE_Y.store(py, Ordering::Relaxed);
                        LAST_HOOK_MOUSE_MS.store(now_ms, Ordering::Relaxed);
                        let _ = tx.send(RawHookMsg::MouseMove { x: px, y: py });
                    }
                }
                WM_LBUTTONDOWN => {
                    let _ = tx.send(RawHookMsg::MouseDown("left"));
                }
                WM_LBUTTONUP => {
                    let _ = tx.send(RawHookMsg::MouseUp("left"));
                }
                WM_RBUTTONDOWN => {
                    let _ = tx.send(RawHookMsg::MouseDown("right"));
                }
                WM_RBUTTONUP => {
                    let _ = tx.send(RawHookMsg::MouseUp("right"));
                }
                WM_MBUTTONDOWN => {
                    let _ = tx.send(RawHookMsg::MouseDown("middle"));
                }
                WM_MBUTTONUP => {
                    let _ = tx.send(RawHookMsg::MouseUp("middle"));
                }
                WM_MOUSEWHEEL => {
                    let delta = ((ms.mouseData >> 16) & 0xffff) as i16;
                    let _ = tx.send(RawHookMsg::MouseWheel(delta));
                }
                _ => {}
            }
        }
    }
    CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
}

#[cfg(windows)]
fn run_windows_hook_loop() {
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::System::Threading::GetCurrentThreadId;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetMessageW, PeekMessageW, SetWindowsHookExW, UnhookWindowsHookEx, MSG, PM_NOREMOVE,
        WH_KEYBOARD_LL, WH_MOUSE_LL,
    };

    unsafe {
        // Ensure the thread message queue exists before publishing WIN_HOOK_TID
        let mut init_msg: MSG = std::mem::zeroed();
        PeekMessageW(&mut init_msg, std::ptr::null_mut(), 0, 0, PM_NOREMOVE);
        WIN_HOOK_TID.store(GetCurrentThreadId(), Ordering::SeqCst);

        let hmod = GetModuleHandleW(std::ptr::null());
        let mut kb_hook = if HOOKS_PAUSED.load(Ordering::SeqCst) {
            std::ptr::null_mut()
        } else {
            SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook_proc), hmod, 0)
        };
        let mut ms_hook = if HOOKS_PAUSED.load(Ordering::SeqCst) {
            std::ptr::null_mut()
        } else {
            SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook_proc), hmod, 0)
        };

        let mut msg: MSG = std::mem::zeroed();
        while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
            if msg.message == WM_KURO_REHOOK {
                // 重装前先摘掉，避免重复挂同一个 proc
                if !kb_hook.is_null() {
                    UnhookWindowsHookEx(kb_hook);
                    kb_hook = std::ptr::null_mut();
                }
                if !ms_hook.is_null() {
                    UnhookWindowsHookEx(ms_hook);
                    ms_hook = std::ptr::null_mut();
                }
                if !HOOKS_PAUSED.load(Ordering::SeqCst) {
                    kb_hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook_proc), hmod, 0);
                    ms_hook = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook_proc), hmod, 0);
                }
                continue;
            }
            if msg.message == WM_KURO_PAUSE_TOGGLE {
                let pause = msg.wParam != 0;
                if pause {
                    if !kb_hook.is_null() {
                        UnhookWindowsHookEx(kb_hook);
                        kb_hook = std::ptr::null_mut();
                    }
                    if !ms_hook.is_null() {
                        UnhookWindowsHookEx(ms_hook);
                        ms_hook = std::ptr::null_mut();
                    }
                } else {
                    if kb_hook.is_null() {
                        kb_hook =
                            SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook_proc), hmod, 0);
                    }
                    if ms_hook.is_null() {
                        ms_hook = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook_proc), hmod, 0);
                    }
                }
            }
        }

        if !kb_hook.is_null() {
            UnhookWindowsHookEx(kb_hook);
        }
        if !ms_hook.is_null() {
            UnhookWindowsHookEx(ms_hook);
        }
    }
}

#[cfg(target_os = "macos")]
pub mod macos_hook {
    use super::{hid_usage_to_vk, KeySource, RawHookMsg, HOOK_TX, KEY_EVENTS_RECEIVED};
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicBool, AtomicPtr, AtomicU64, Ordering};
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    type CGEventTapProxy = *mut c_void;
    type CGEventRef = *mut c_void;
    type CFMachPortRef = *mut c_void;
    type CFRunLoopSourceRef = *mut c_void;
    type CFRunLoopTimerRef = *mut c_void;
    type CFRunLoopRef = *mut c_void;
    type CFStringRef = *const c_void;
    type CFDictionaryRef = *const c_void;
    type CFArrayRef = *const c_void;
    type CFAllocatorRef = *const c_void;
    type CFBooleanRef = *const c_void;
    type CGEventType = u32;
    type CGEventMask = u64;
    type CGDirectDisplayID = u32;

    type IOHIDManagerRef = *mut c_void;
    type IOHIDValueRef = *mut c_void;
    type IOHIDElementRef = *mut c_void;
    type IOReturn = i32;
    type IOOptionBits = u32;

    #[repr(C)]
    #[derive(Copy, Clone, Debug)]
    struct CGPoint {
        x: f64,
        y: f64,
    }

    #[repr(C)]
    #[derive(Copy, Clone, Debug)]
    struct CGSize {
        width: f64,
        height: f64,
    }

    #[repr(C)]
    #[derive(Copy, Clone, Debug)]
    struct CGRect {
        origin: CGPoint,
        size: CGSize,
    }

    const K_CG_EVENT_LEFT_MOUSE_DOWN: u32 = 1;
    const K_CG_EVENT_LEFT_MOUSE_UP: u32 = 2;
    const K_CG_EVENT_RIGHT_MOUSE_DOWN: u32 = 3;
    const K_CG_EVENT_RIGHT_MOUSE_UP: u32 = 4;
    const K_CG_EVENT_MOUSE_MOVED: u32 = 5;
    const K_CG_EVENT_LEFT_MOUSE_DRAGGED: u32 = 6;
    const K_CG_EVENT_RIGHT_MOUSE_DRAGGED: u32 = 7;
    const K_CG_EVENT_KEY_DOWN: u32 = 10;
    const K_CG_EVENT_KEY_UP: u32 = 11;
    const K_CG_EVENT_FLAGS_CHANGED: u32 = 12;
    const K_CG_EVENT_SCROLL_WHEEL: u32 = 22;
    const K_CG_EVENT_OTHER_MOUSE_DOWN: u32 = 25;
    const K_CG_EVENT_OTHER_MOUSE_UP: u32 = 26;
    const K_CG_EVENT_TAP_DISABLED_BY_TIMEOUT: u32 = 0xFFFFFFFE;
    const K_CG_EVENT_TAP_DISABLED_BY_USER_INPUT: u32 = 0xFFFFFFFF;

    const K_CG_KEYBOARD_EVENT_KEYCODE: u32 = 9;
    const K_CG_SCROLL_WHEEL_EVENT_DELTA_AXIS_1: u32 = 11;

    const K_CG_SESSION_EVENT_TAP: u32 = 1;
    const K_CG_HEAD_INSERT_EVENT_TAP: u32 = 0;
    const K_CG_EVENT_TAP_OPTION_DEFAULT: u32 = 0;
    const K_CG_EVENT_TAP_OPTION_LISTEN_ONLY: u32 = 1;

    const K_CF_STRING_ENCODING_UTF8: u32 = 0x08000100;
    const K_CF_NUMBER_SINT32_TYPE: isize = 3;

    const K_IO_HID_OPTIONS_TYPE_NONE: IOOptionBits = 0;
    const K_IO_RETURN_SUCCESS: IOReturn = 0;
    const K_HID_PAGE_GENERIC_DESKTOP: i32 = 0x01;
    const K_HID_USAGE_GD_KEYBOARD: i32 = 0x06;
    const K_HID_USAGE_GD_KEYPAD: i32 = 0x07;
    const K_HID_PAGE_KEYBOARD_OR_KEYPAD: u32 = 0x07;

    // CGEventFlags modifier masks
    const FLAG_CAPS_LOCK: u64 = 0x00010000;
    const FLAG_SHIFT: u64 = 0x00020000;
    const FLAG_CONTROL: u64 = 0x00040000;
    const FLAG_OPTION: u64 = 0x00080000;
    const FLAG_COMMAND: u64 = 0x00100000;

    type CGEventTapCallBack = extern "C" fn(
        proxy: CGEventTapProxy,
        event_type: CGEventType,
        event: CGEventRef,
        user_info: *mut c_void,
    ) -> CGEventRef;

    type CFRunLoopTimerCallBack = extern "C" fn(timer: CFRunLoopTimerRef, info: *mut c_void);

    type IOHIDValueCallback = extern "C" fn(
        context: *mut c_void,
        result: IOReturn,
        sender: *mut c_void,
        value: IOHIDValueRef,
    );

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGPreflightListenEventAccess() -> bool;
        fn CGRequestListenEventAccess() -> bool;
        fn CGEventSourceFlagsState(state_id: i32) -> u64;
        fn CGEventTapCreate(
            tap: u32,
            place: u32,
            options: u32,
            events_of_interest: CGEventMask,
            callback: CGEventTapCallBack,
            user_info: *mut c_void,
        ) -> CFMachPortRef;
        fn CGEventTapEnable(tap: CFMachPortRef, enable: bool);
        fn CGEventTapIsEnabled(tap: CFMachPortRef) -> bool;
        fn CGEventGetLocation(event: CGEventRef) -> CGPoint;
        fn CGEventGetIntegerValueField(event: CGEventRef, field: u32) -> i64;
        fn CGEventGetFlags(event: CGEventRef) -> u64;
        fn CGMainDisplayID() -> CGDirectDisplayID;
        fn CGDisplayBounds(display: CGDirectDisplayID) -> CGRect;
        fn CGEventCreate(source: *const c_void) -> CGEventRef;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        static kCFRunLoopCommonModes: CFStringRef;
        static kCFBooleanTrue: CFBooleanRef;
        static kCFTypeDictionaryKeyCallBacks: u8;
        static kCFTypeDictionaryValueCallBacks: u8;
        static kCFTypeArrayCallBacks: u8;

        fn CFStringCreateWithBytes(
            alloc: CFAllocatorRef,
            bytes: *const u8,
            num_bytes: isize,
            encoding: u32,
            is_external_representation: u8,
        ) -> CFStringRef;
        fn CFNumberCreate(
            allocator: CFAllocatorRef,
            the_type: isize,
            value_ptr: *const c_void,
        ) -> *const c_void;
        fn CFArrayCreate(
            allocator: CFAllocatorRef,
            values: *const *const c_void,
            num_values: isize,
            call_backs: *const c_void,
        ) -> CFArrayRef;
        fn CFDictionaryCreate(
            allocator: CFAllocatorRef,
            keys: *const *const c_void,
            values: *const *const c_void,
            num_values: isize,
            key_callbacks: *const c_void,
            value_callbacks: *const c_void,
        ) -> CFDictionaryRef;
        fn CFMachPortCreateRunLoopSource(
            allocator: CFAllocatorRef,
            port: CFMachPortRef,
            order: isize,
        ) -> CFRunLoopSourceRef;
        fn CFMachPortInvalidate(port: CFMachPortRef);
        fn CFRunLoopGetCurrent() -> CFRunLoopRef;
        fn CFRunLoopAddSource(rl: CFRunLoopRef, source: CFRunLoopSourceRef, mode: CFStringRef);
        fn CFRunLoopRemoveSource(rl: CFRunLoopRef, source: CFRunLoopSourceRef, mode: CFStringRef);
        fn CFRunLoopRun();
        fn CFRunLoopStop(rl: CFRunLoopRef);
        fn CFAbsoluteTimeGetCurrent() -> f64;
        fn CFRunLoopTimerCreate(
            allocator: CFAllocatorRef,
            fire_date: f64,
            interval: f64,
            flags: usize,
            order: isize,
            callout: CFRunLoopTimerCallBack,
            context: *mut c_void,
        ) -> CFRunLoopTimerRef;
        fn CFRunLoopAddTimer(rl: CFRunLoopRef, timer: CFRunLoopTimerRef, mode: CFStringRef);
        fn CFRunLoopTimerInvalidate(timer: CFRunLoopTimerRef);
        fn CFRelease(cf: *const c_void);
    }

    #[link(name = "IOKit", kind = "framework")]
    extern "C" {
        fn IOHIDManagerCreate(allocator: CFAllocatorRef, options: IOOptionBits) -> IOHIDManagerRef;
        fn IOHIDManagerSetDeviceMatchingMultiple(manager: IOHIDManagerRef, multiple: CFArrayRef);
        fn IOHIDManagerRegisterInputValueCallback(
            manager: IOHIDManagerRef,
            callback: Option<IOHIDValueCallback>,
            context: *mut c_void,
        );
        fn IOHIDManagerScheduleWithRunLoop(
            manager: IOHIDManagerRef,
            run_loop: CFRunLoopRef,
            run_loop_mode: CFStringRef,
        );
        fn IOHIDManagerUnscheduleFromRunLoop(
            manager: IOHIDManagerRef,
            run_loop: CFRunLoopRef,
            run_loop_mode: CFStringRef,
        );
        fn IOHIDManagerOpen(manager: IOHIDManagerRef, options: IOOptionBits) -> IOReturn;
        fn IOHIDManagerClose(manager: IOHIDManagerRef, options: IOOptionBits) -> IOReturn;
        fn IOHIDValueGetElement(value: IOHIDValueRef) -> IOHIDElementRef;
        fn IOHIDValueGetIntegerValue(value: IOHIDValueRef) -> isize;
        fn IOHIDElementGetUsagePage(element: IOHIDElementRef) -> u32;
        fn IOHIDElementGetUsage(element: IOHIDElementRef) -> u32;
    }

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        static kAXTrustedCheckOptionPrompt: CFStringRef;
        fn AXIsProcessTrusted() -> bool;
        fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> bool;
    }

    static TAP_PORT: AtomicPtr<c_void> = AtomicPtr::new(std::ptr::null_mut());
    static TAP_HAS_KEYBOARD: AtomicBool = AtomicBool::new(false);
    static HID_ACTIVE: AtomicBool = AtomicBool::new(false);
    static SNAPSHOT_AX: AtomicBool = AtomicBool::new(false);
    static SNAPSHOT_LISTEN: AtomicBool = AtomicBool::new(false);
    static RECONNECT_REQUESTED: AtomicBool = AtomicBool::new(false);
    static LAST_TICK_WALL_MS: AtomicU64 = AtomicU64::new(0);
    static LAST_HID_RETRY_WALL_MS: AtomicU64 = AtomicU64::new(0);

    #[derive(Debug, Clone)]
    pub struct MacInputStatus {
        pub accessibility: bool,
        pub input_monitoring: bool,
        pub tap_active: bool,
        pub tap_has_keyboard: bool,
        pub hid_active: bool,
        pub key_events_received: u64,
    }

    fn wall_clock_ms() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }

    pub fn get_macos_input_status() -> MacInputStatus {
        let tap = TAP_PORT.load(Ordering::Acquire);
        let tap_active = !tap.is_null() && unsafe { CGEventTapIsEnabled(tap) };
        MacInputStatus {
            accessibility: unsafe { AXIsProcessTrusted() },
            input_monitoring: unsafe { CGPreflightListenEventAccess() },
            tap_active,
            tap_has_keyboard: TAP_HAS_KEYBOARD.load(Ordering::Acquire),
            hid_active: HID_ACTIVE.load(Ordering::Acquire),
            key_events_received: KEY_EVENTS_RECEIVED.load(Ordering::Relaxed),
        }
    }

    pub fn trigger_macos_reconnect() {
        unsafe {
            if !CGPreflightListenEventAccess() {
                let _ = CGRequestListenEventAccess();
            }
        }
        RECONNECT_REQUESTED.store(true, Ordering::Release);
    }

    pub fn open_macos_privacy_pane(pane: &str) {
        let url = match pane {
            "input_monitoring" => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent"
            }
            _ => "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
        };
        let _ = std::process::Command::new("open").arg(url).spawn();
    }

    pub fn show_macos_diagnostics_dialog() {
        let st = get_macos_input_status();
        let ax_txt = if st.accessibility {
            "已授权"
        } else {
            "未生效"
        };
        let listen_txt = if st.input_monitoring {
            "已授权"
        } else {
            "未生效"
        };
        let tap_txt = if st.tap_active && st.tap_has_keyboard {
            "运行中（键鼠）"
        } else if st.tap_active {
            "仅鼠标（缺少键盘权限）"
        } else {
            "未运行"
        };
        let hid_txt = if st.hid_active {
            "运行中（兼容 Karabiner）"
        } else {
            "未运行（需输入监控权限）"
        };
        let tip = if !st.accessibility || !st.input_monitoring {
            "若系统设置里开关亮着但这里显示「未生效」，说明更新版本后系统缓存过期：请在「辅助功能」和「输入监控」中选中 KuroCat 点左下角「-」号删除，再点「+」号重新添加并重启。"
        } else if st.key_events_received == 0 {
            "权限均已生效！请先随便敲几下键盘测试；若使用 Karabiner-Elements 仍无响应，可点击托盘「重新连接键盘监听」。"
        } else {
            "键盘监听工作正常！"
        };

        let msg = format!(
            "辅助功能权限：{}\n输入监控权限：{}\nCGEventTap 通道：{}\nIOHIDManager 通道：{}\n已收到全局按键：{} 次\n\n{}",
            ax_txt, listen_txt, tap_txt, hid_txt, st.key_events_received, tip
        );
        let escaped = msg
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\n', "\\n");
        let script = format!(
            "display dialog \"{}\" with title \"KuroCat 键盘监听诊断\" buttons {{\"确定\"}} default button \"确定\"",
            escaped
        );
        let _ = std::process::Command::new("osascript")
            .args(["-e", &script])
            .spawn();
    }

    pub fn main_display_size() -> (f64, f64) {
        unsafe {
            let bounds = CGDisplayBounds(CGMainDisplayID());
            (bounds.size.width.max(1.0), bounds.size.height.max(1.0))
        }
    }

    pub fn cursor_pos_points() -> Option<(f64, f64)> {
        unsafe {
            let ev = CGEventCreate(std::ptr::null());
            if ev.is_null() {
                return None;
            }
            let pt = CGEventGetLocation(ev);
            CFRelease(ev as *const c_void);
            Some((pt.x, pt.y))
        }
    }

    fn request_permissions_once() {
        unsafe {
            if !AXIsProcessTrusted() {
                let keys = [kAXTrustedCheckOptionPrompt as *const c_void];
                let vals = [kCFBooleanTrue as *const c_void];
                let opts = CFDictionaryCreate(
                    std::ptr::null(),
                    keys.as_ptr(),
                    vals.as_ptr(),
                    1,
                    std::ptr::null(),
                    std::ptr::null(),
                );
                let _ = AXIsProcessTrustedWithOptions(opts);
                if !opts.is_null() {
                    CFRelease(opts as *const c_void);
                }
            }
            if !CGPreflightListenEventAccess() {
                let _ = CGRequestListenEventAccess();
            }
        }
    }

    fn macos_keycode_to_vk(kc: u16) -> Option<u32> {
        let vk = match kc {
            // Letters
            0x00 => 0x41, // A
            0x0B => 0x42, // B
            0x08 => 0x43, // C
            0x02 => 0x44, // D
            0x0E => 0x45, // E
            0x03 => 0x46, // F
            0x05 => 0x47, // G
            0x04 => 0x48, // H
            0x22 => 0x49, // I
            0x26 => 0x4A, // J
            0x28 => 0x4B, // K
            0x25 => 0x4C, // L
            0x2E => 0x4D, // M
            0x2D => 0x4E, // N
            0x1F => 0x4F, // O
            0x23 => 0x50, // P
            0x0C => 0x51, // Q
            0x0F => 0x52, // R
            0x01 => 0x53, // S
            0x11 => 0x54, // T
            0x20 => 0x55, // U
            0x09 => 0x56, // V
            0x0D => 0x57, // W
            0x07 => 0x58, // X
            0x10 => 0x59, // Y
            0x06 => 0x5A, // Z
            // Digits
            0x1D => 0x30, // 0
            0x12 => 0x31, // 1
            0x13 => 0x32, // 2
            0x14 => 0x33, // 3
            0x15 => 0x34, // 4
            0x17 => 0x35, // 5
            0x16 => 0x36, // 6
            0x1A => 0x37, // 7
            0x1C => 0x38, // 8
            0x19 => 0x39, // 9
            // Punctuation
            0x1B => 0xBD, // -
            0x18 => 0xBB, // =
            0x21 => 0xDB, // [
            0x1E => 0xDD, // ]
            0x2A => 0xDC, // \
            0x29 => 0xBA, // ;
            0x27 => 0xDE, // '
            0x2B => 0xBC, // ,
            0x2F => 0xBE, // .
            0x2C => 0xBF, // /
            0x32 => 0xC0, // `
            // Control & editing
            0x35 => 0x1B,  // Esc
            0x30 => 0x09,  // Tab
            0x31 => 0x20,  // Space
            0x24 => 0x0D,  // Return
            0x4C => 0x10D, // Numpad Enter
            0x33 => 0x08,  // Backspace (Delete)
            0x75 => 0x2E,  // Forward Delete
            0x39 => 0x14,  // CapsLock
            // Numpad
            0x47 => 0x90, // Clear / NumLock
            0x4B => 0x6F, // Numpad /
            0x43 => 0x6A, // Numpad *
            0x4E => 0x6D, // Numpad -
            0x45 => 0x6B, // Numpad +
            0x41 => 0x6E, // Numpad .
            0x52 => 0x60, // Numpad 0
            0x53 => 0x61, // Numpad 1
            0x54 => 0x62, // Numpad 2
            0x55 => 0x63, // Numpad 3
            0x56 => 0x64, // Numpad 4
            0x57 => 0x65, // Numpad 5
            0x58 => 0x66, // Numpad 6
            0x59 => 0x67, // Numpad 7
            0x5B => 0x68, // Numpad 8
            0x5C => 0x69, // Numpad 9
            // Modifiers
            0x38 => 0xA0, // LShift
            0x3C => 0xA1, // RShift
            0x3B => 0xA2, // LCtrl
            0x3E => 0xA3, // RCtrl
            0x3A => 0xA4, // LOption (Alt)
            0x3D => 0xA5, // ROption (Alt)
            0x37 => 0x5B, // LCommand (Win)
            0x36 => 0x5C, // RCommand (Win)
            // Arrows & navigation
            0x7B => 0x25, // Left
            0x7C => 0x27, // Right
            0x7D => 0x28, // Down
            0x7E => 0x26, // Up
            0x73 => 0x24, // Home
            0x77 => 0x23, // End
            0x74 => 0x21, // PgUp
            0x79 => 0x22, // PgDn
            // Function keys
            0x7A => 0x70, // F1
            0x78 => 0x71, // F2
            0x63 => 0x72, // F3
            0x76 => 0x73, // F4
            0x60 => 0x74, // F5
            0x61 => 0x75, // F6
            0x62 => 0x76, // F7
            0x64 => 0x77, // F8
            0x65 => 0x78, // F9
            0x6D => 0x79, // F10
            0x67 => 0x7A, // F11
            0x6F => 0x7B, // F12
            _ => return None,
        };
        Some(vk)
    }

    extern "C" fn tap_callback(
        _proxy: CGEventTapProxy,
        event_type: CGEventType,
        event: CGEventRef,
        _user_info: *mut c_void,
    ) -> CGEventRef {
        if event_type == K_CG_EVENT_TAP_DISABLED_BY_TIMEOUT
            || event_type == K_CG_EVENT_TAP_DISABLED_BY_USER_INPUT
        {
            let tap = TAP_PORT.load(Ordering::Acquire);
            if !tap.is_null() {
                unsafe { CGEventTapEnable(tap, true) };
            }
            return event;
        }

        if let Some(tx) = HOOK_TX.get() {
            unsafe {
                match event_type {
                    K_CG_EVENT_KEY_DOWN => {
                        let kc =
                            CGEventGetIntegerValueField(event, K_CG_KEYBOARD_EVENT_KEYCODE) as u16;
                        if let Some(vk) = macos_keycode_to_vk(kc) {
                            let _ = tx.send(RawHookMsg::KeyDown {
                                vk,
                                scan: kc as u32,
                                source: KeySource::Primary,
                            });
                        }
                    }
                    K_CG_EVENT_KEY_UP => {
                        let kc =
                            CGEventGetIntegerValueField(event, K_CG_KEYBOARD_EVENT_KEYCODE) as u16;
                        if let Some(vk) = macos_keycode_to_vk(kc) {
                            let _ = tx.send(RawHookMsg::KeyUp {
                                vk,
                                scan: kc as u32,
                                source: KeySource::Primary,
                            });
                        }
                    }
                    K_CG_EVENT_FLAGS_CHANGED => {
                        let kc =
                            CGEventGetIntegerValueField(event, K_CG_KEYBOARD_EVENT_KEYCODE) as u16;
                        let flags = CGEventGetFlags(event);
                        let is_down = match kc {
                            0x38 | 0x3C => (flags & FLAG_SHIFT) != 0,
                            0x3B | 0x3E => (flags & FLAG_CONTROL) != 0,
                            0x3A | 0x3D => (flags & FLAG_OPTION) != 0,
                            0x37 | 0x36 => (flags & FLAG_COMMAND) != 0,
                            0x39 => (flags & FLAG_CAPS_LOCK) != 0,
                            _ => false,
                        };
                        if let Some(vk) = macos_keycode_to_vk(kc) {
                            if is_down {
                                let _ = tx.send(RawHookMsg::KeyDown {
                                    vk,
                                    scan: kc as u32,
                                    source: KeySource::Primary,
                                });
                            } else {
                                let _ = tx.send(RawHookMsg::KeyUp {
                                    vk,
                                    scan: kc as u32,
                                    source: KeySource::Primary,
                                });
                            }
                        }
                    }
                    K_CG_EVENT_MOUSE_MOVED
                    | K_CG_EVENT_LEFT_MOUSE_DRAGGED
                    | K_CG_EVENT_RIGHT_MOUSE_DRAGGED => {
                        let pt = CGEventGetLocation(event);
                        let _ = tx.send(RawHookMsg::MouseMove {
                            x: pt.x.round() as i32,
                            y: pt.y.round() as i32,
                        });
                    }
                    K_CG_EVENT_LEFT_MOUSE_DOWN => {
                        let _ = tx.send(RawHookMsg::MouseDown("left"));
                    }
                    K_CG_EVENT_LEFT_MOUSE_UP => {
                        let _ = tx.send(RawHookMsg::MouseUp("left"));
                    }
                    K_CG_EVENT_RIGHT_MOUSE_DOWN => {
                        let _ = tx.send(RawHookMsg::MouseDown("right"));
                    }
                    K_CG_EVENT_RIGHT_MOUSE_UP => {
                        let _ = tx.send(RawHookMsg::MouseUp("right"));
                    }
                    K_CG_EVENT_OTHER_MOUSE_DOWN => {
                        let _ = tx.send(RawHookMsg::MouseDown("middle"));
                    }
                    K_CG_EVENT_OTHER_MOUSE_UP => {
                        let _ = tx.send(RawHookMsg::MouseUp("middle"));
                    }
                    K_CG_EVENT_SCROLL_WHEEL => {
                        let delta = CGEventGetIntegerValueField(
                            event,
                            K_CG_SCROLL_WHEEL_EVENT_DELTA_AXIS_1,
                        ) as i16;
                        let _ = tx.send(RawHookMsg::MouseWheel(delta));
                    }
                    _ => {}
                }
            }
        }
        event
    }

    extern "C" fn hid_input_callback(
        _context: *mut c_void,
        _result: IOReturn,
        _sender: *mut c_void,
        value: IOHIDValueRef,
    ) {
        if value.is_null() {
            return;
        }
        unsafe {
            let elem = IOHIDValueGetElement(value);
            if elem.is_null() {
                return;
            }
            if IOHIDElementGetUsagePage(elem) != K_HID_PAGE_KEYBOARD_OR_KEYPAD {
                return;
            }
            let usage = IOHIDElementGetUsage(elem);
            if !(0x04..=0xE7).contains(&usage) {
                return;
            }
            let Some(vk) = hid_usage_to_vk(usage) else {
                return;
            };
            let pressed = IOHIDValueGetIntegerValue(value) != 0;
            if let Some(tx) = HOOK_TX.get() {
                if pressed {
                    let _ = tx.send(RawHookMsg::KeyDown {
                        vk,
                        scan: usage,
                        source: KeySource::Hid,
                    });
                } else {
                    let _ = tx.send(RawHookMsg::KeyUp {
                        vk,
                        scan: usage,
                        source: KeySource::Hid,
                    });
                }
            }
        }
    }

    unsafe fn cf_string_from_str(s: &str) -> CFStringRef {
        CFStringCreateWithBytes(
            std::ptr::null(),
            s.as_ptr(),
            s.len() as isize,
            K_CF_STRING_ENCODING_UTF8,
            0,
        )
    }

    unsafe fn make_hid_matching_dict(usage_page: i32, usage: i32) -> CFDictionaryRef {
        let k_page = cf_string_from_str("DeviceUsagePage");
        let k_usage = cf_string_from_str("DeviceUsage");
        let v_page = CFNumberCreate(
            std::ptr::null(),
            K_CF_NUMBER_SINT32_TYPE,
            &usage_page as *const i32 as *const c_void,
        );
        let v_usage = CFNumberCreate(
            std::ptr::null(),
            K_CF_NUMBER_SINT32_TYPE,
            &usage as *const i32 as *const c_void,
        );
        let keys = [k_page as *const c_void, k_usage as *const c_void];
        let vals = [v_page, v_usage];
        let dict = CFDictionaryCreate(
            std::ptr::null(),
            keys.as_ptr(),
            vals.as_ptr(),
            2,
            &kCFTypeDictionaryKeyCallBacks as *const u8 as *const c_void,
            &kCFTypeDictionaryValueCallBacks as *const u8 as *const c_void,
        );
        if !k_page.is_null() {
            CFRelease(k_page);
        }
        if !k_usage.is_null() {
            CFRelease(k_usage);
        }
        if !v_page.is_null() {
            CFRelease(v_page);
        }
        if !v_usage.is_null() {
            CFRelease(v_usage);
        }
        dict
    }

    /// Creates a non-exclusive read-only IOHIDManager subscribed to all Keyboard & Keypad
    /// devices (including Karabiner-Elements DriverKit VirtualHIDKeyboard).
    unsafe fn start_hid_keyboard_listener(rl: CFRunLoopRef) -> IOHIDManagerRef {
        let mgr = IOHIDManagerCreate(std::ptr::null(), K_IO_HID_OPTIONS_TYPE_NONE);
        if mgr.is_null() {
            return std::ptr::null_mut();
        }
        let d_kb = make_hid_matching_dict(K_HID_PAGE_GENERIC_DESKTOP, K_HID_USAGE_GD_KEYBOARD);
        let d_kp = make_hid_matching_dict(K_HID_PAGE_GENERIC_DESKTOP, K_HID_USAGE_GD_KEYPAD);
        if !d_kb.is_null() && !d_kp.is_null() {
            let dicts = [d_kb as *const c_void, d_kp as *const c_void];
            let arr = CFArrayCreate(
                std::ptr::null(),
                dicts.as_ptr(),
                2,
                &kCFTypeArrayCallBacks as *const u8 as *const c_void,
            );
            if !arr.is_null() {
                IOHIDManagerSetDeviceMatchingMultiple(mgr, arr);
                CFRelease(arr);
            }
        }
        if !d_kb.is_null() {
            CFRelease(d_kb);
        }
        if !d_kp.is_null() {
            CFRelease(d_kp);
        }

        IOHIDManagerRegisterInputValueCallback(mgr, Some(hid_input_callback), std::ptr::null_mut());
        IOHIDManagerScheduleWithRunLoop(mgr, rl, kCFRunLoopCommonModes);

        let ret = IOHIDManagerOpen(mgr, K_IO_HID_OPTIONS_TYPE_NONE);
        if ret != K_IO_RETURN_SUCCESS {
            IOHIDManagerRegisterInputValueCallback(mgr, None, std::ptr::null_mut());
            IOHIDManagerUnscheduleFromRunLoop(mgr, rl, kCFRunLoopCommonModes);
            CFRelease(mgr as *const c_void);
            return std::ptr::null_mut();
        }
        mgr
    }

    /// Periodic self-healing watchdog running on the exact same CFRunLoop thread.
    /// Automatically tears down & rebuilds listeners when:
    /// 1. The user grants Input Monitoring or Accessibility after launch (no restart needed!)
    /// 2. The Mac wakes from sleep (wall-clock jump > 12s, where Karabiner/WindowServer taps often stale)
    /// 3. The CGEventTap gets disabled and cannot be re-enabled in place
    /// 4. The user clicks "重新连接键盘监听" in the menu bar
    extern "C" fn health_timer_callback(_timer: CFRunLoopTimerRef, _info: *mut c_void) {
        unsafe {
            let now_ms = wall_clock_ms();
            let prev_ms = LAST_TICK_WALL_MS.swap(now_ms, Ordering::AcqRel);
            let woke_from_sleep = prev_ms > 0 && now_ms.saturating_sub(prev_ms) > 12_000;

            let ax_now = AXIsProcessTrusted();
            let listen_now = CGPreflightListenEventAccess();
            let ax_upgraded = !SNAPSHOT_AX.load(Ordering::Acquire) && ax_now;
            let listen_upgraded = !SNAPSHOT_LISTEN.load(Ordering::Acquire) && listen_now;
            let manual_reconnect = RECONNECT_REQUESTED.swap(false, Ordering::AcqRel);

            let tap = TAP_PORT.load(Ordering::Acquire);
            let mut tap_dead = false;
            if !tap.is_null() {
                if !CGEventTapIsEnabled(tap) {
                    CGEventTapEnable(tap, true);
                    if !CGEventTapIsEnabled(tap) {
                        tap_dead = true;
                    }
                }
            } else if ax_now || listen_now {
                tap_dead = true;
            }

            let hid_needs_retry = !HID_ACTIVE.load(Ordering::Acquire)
                && listen_now
                && now_ms.saturating_sub(LAST_HID_RETRY_WALL_MS.load(Ordering::Acquire)) > 15_000;

            if manual_reconnect
                || ax_upgraded
                || listen_upgraded
                || woke_from_sleep
                || tap_dead
                || hid_needs_retry
            {
                if hid_needs_retry {
                    LAST_HID_RETRY_WALL_MS.store(now_ms, Ordering::Release);
                }
                CFRunLoopStop(CFRunLoopGetCurrent());
            }
        }
    }

    pub fn is_alt_pressed() -> bool {
        // kCGEventSourceStateCombinedSessionState = 0; works without Accessibility / Input Monitoring
        // permissions so macOS users can always hold Option to temporarily interact/unlock click-through.
        const K_CG_EVENT_SOURCE_STATE_COMBINED_SESSION_STATE: i32 = 0;
        let flags = unsafe { CGEventSourceFlagsState(K_CG_EVENT_SOURCE_STATE_COMBINED_SESSION_STATE) };
        (flags & FLAG_OPTION) != 0
    }

    pub fn run_macos_hook_loop() {
        // Trigger both Accessibility and Input Monitoring prompts once on first launch
        request_permissions_once();

        let mouse_mask: CGEventMask = (1u64 << K_CG_EVENT_LEFT_MOUSE_DOWN)
            | (1u64 << K_CG_EVENT_LEFT_MOUSE_UP)
            | (1u64 << K_CG_EVENT_RIGHT_MOUSE_DOWN)
            | (1u64 << K_CG_EVENT_RIGHT_MOUSE_UP)
            | (1u64 << K_CG_EVENT_MOUSE_MOVED)
            | (1u64 << K_CG_EVENT_LEFT_MOUSE_DRAGGED)
            | (1u64 << K_CG_EVENT_RIGHT_MOUSE_DRAGGED)
            | (1u64 << K_CG_EVENT_SCROLL_WHEEL)
            | (1u64 << K_CG_EVENT_OTHER_MOUSE_DOWN)
            | (1u64 << K_CG_EVENT_OTHER_MOUSE_UP);

        let full_mask: CGEventMask = mouse_mask
            | (1u64 << K_CG_EVENT_KEY_DOWN)
            | (1u64 << K_CG_EVENT_KEY_UP)
            | (1u64 << K_CG_EVENT_FLAGS_CHANGED);

        loop {
            unsafe {
                let ax_ok = AXIsProcessTrusted();
                let listen_ok = CGPreflightListenEventAccess();
                if !ax_ok && !listen_ok {
                    TAP_PORT.store(std::ptr::null_mut(), Ordering::Release);
                    TAP_HAS_KEYBOARD.store(false, Ordering::Release);
                    HID_ACTIVE.store(false, Ordering::Release);
                    std::thread::sleep(Duration::from_secs(2));
                    continue;
                }

                SNAPSHOT_AX.store(ax_ok, Ordering::Release);
                SNAPSHOT_LISTEN.store(listen_ok, Ordering::Release);
                LAST_TICK_WALL_MS.store(wall_clock_ms(), Ordering::Release);

                let rl = CFRunLoopGetCurrent();

                // Channel 1: CGEventTap (mouse + keyboard; prefers passive LISTEN_ONLY, falls back
                // to pass-through DEFAULT tap if ListenEvent TCC is lagging behind Accessibility,
                // or mouse-only tap if keyboard is exclusively served via IOHIDManager)
                let mut tap_has_kb = true;
                let mut tap = CGEventTapCreate(
                    K_CG_SESSION_EVENT_TAP,
                    K_CG_HEAD_INSERT_EVENT_TAP,
                    K_CG_EVENT_TAP_OPTION_LISTEN_ONLY,
                    full_mask,
                    tap_callback,
                    std::ptr::null_mut(),
                );
                if tap.is_null() {
                    tap = CGEventTapCreate(
                        K_CG_SESSION_EVENT_TAP,
                        K_CG_HEAD_INSERT_EVENT_TAP,
                        K_CG_EVENT_TAP_OPTION_DEFAULT,
                        full_mask,
                        tap_callback,
                        std::ptr::null_mut(),
                    );
                }
                if tap.is_null() {
                    tap_has_kb = false;
                    tap = CGEventTapCreate(
                        K_CG_SESSION_EVENT_TAP,
                        K_CG_HEAD_INSERT_EVENT_TAP,
                        K_CG_EVENT_TAP_OPTION_LISTEN_ONLY,
                        mouse_mask,
                        tap_callback,
                        std::ptr::null_mut(),
                    );
                }

                let mut tap_src: CFRunLoopSourceRef = std::ptr::null_mut();
                if !tap.is_null() {
                    tap_src = CFMachPortCreateRunLoopSource(std::ptr::null(), tap, 0);
                    if !tap_src.is_null() {
                        TAP_PORT.store(tap, Ordering::Release);
                        TAP_HAS_KEYBOARD.store(tap_has_kb, Ordering::Release);
                        CFRunLoopAddSource(rl, tap_src, kCFRunLoopCommonModes);
                        CGEventTapEnable(tap, true);
                    } else {
                        CFMachPortInvalidate(tap);
                        CFRelease(tap as *const c_void);
                        tap = std::ptr::null_mut();
                        TAP_PORT.store(std::ptr::null_mut(), Ordering::Release);
                        TAP_HAS_KEYBOARD.store(false, Ordering::Release);
                    }
                } else {
                    TAP_PORT.store(std::ptr::null_mut(), Ordering::Release);
                    TAP_HAS_KEYBOARD.store(false, Ordering::Release);
                }

                // Channel 2: Non-exclusive read-only IOHIDManager for Keyboard & Keypad.
                // Receives events directly from physical keyboards AND Karabiner-Elements
                // DriverKit VirtualHIDKeyboard, even when CGEventTap is blocked by Secure Input
                // or disrupted by third-party event taps.
                let hid_mgr = if listen_ok {
                    start_hid_keyboard_listener(rl)
                } else {
                    std::ptr::null_mut()
                };
                HID_ACTIVE.store(!hid_mgr.is_null(), Ordering::Release);
                if hid_mgr.is_null() && listen_ok {
                    LAST_HID_RETRY_WALL_MS.store(wall_clock_ms(), Ordering::Release);
                }

                if tap.is_null() && hid_mgr.is_null() {
                    std::thread::sleep(Duration::from_secs(2));
                    continue;
                }

                // 2-second watchdog timer on the same RunLoop for zero-restart permission upgrades & sleep recovery
                let timer = CFRunLoopTimerCreate(
                    std::ptr::null(),
                    CFAbsoluteTimeGetCurrent() + 2.0,
                    2.0,
                    0,
                    0,
                    health_timer_callback,
                    std::ptr::null_mut(),
                );
                if !timer.is_null() {
                    CFRunLoopAddTimer(rl, timer, kCFRunLoopCommonModes);
                }

                CFRunLoopRun();

                // Clean teardown before re-initializing
                if !timer.is_null() {
                    CFRunLoopTimerInvalidate(timer);
                    CFRelease(timer as *const c_void);
                }
                if !hid_mgr.is_null() {
                    HID_ACTIVE.store(false, Ordering::Release);
                    IOHIDManagerRegisterInputValueCallback(hid_mgr, None, std::ptr::null_mut());
                    IOHIDManagerUnscheduleFromRunLoop(hid_mgr, rl, kCFRunLoopCommonModes);
                    IOHIDManagerClose(hid_mgr, K_IO_HID_OPTIONS_TYPE_NONE);
                    CFRelease(hid_mgr as *const c_void);
                }
                if !tap.is_null() {
                    TAP_PORT.store(std::ptr::null_mut(), Ordering::Release);
                    TAP_HAS_KEYBOARD.store(false, Ordering::Release);
                    if !tap_src.is_null() {
                        CFRunLoopRemoveSource(rl, tap_src, kCFRunLoopCommonModes);
                        CFRelease(tap_src as *const c_void);
                    }
                    CFMachPortInvalidate(tap);
                    CFRelease(tap as *const c_void);
                }
            }
            std::thread::sleep(Duration::from_millis(500));
        }
    }
}

#[cfg(target_os = "linux")]
pub mod linux_hook {
    use super::{linux_evdev_to_vk, KeySource, RawHookMsg, HOOK_TX};
    use std::cell::RefCell;
    use std::ffi::{c_char, c_int, c_uint, c_ulong, c_void};
    use std::fs::OpenOptions;
    use std::io::Read;
    use std::os::unix::fs::OpenOptionsExt;
    use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
    use std::sync::OnceLock;
    use std::time::{Duration, Instant};

    const RTLD_LAZY: c_int = 0x00001;
    const RTLD_LOCAL: c_int = 0x00000;
    const X_RECORD_ALL_CLIENTS: c_ulong = 3;
    const X_RECORD_FROM_SERVER: c_int = 0;
    const MOD1_MASK: c_uint = 1 << 3; // Alt key in X11 modifier mask

    #[link(name = "dl")]
    extern "C" {
        fn dlopen(filename: *const c_char, flag: c_int) -> *mut c_void;
        fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
    }

    #[repr(C)]
    struct XRecordRange8 {
        first: u8,
        last: u8,
    }

    #[repr(C)]
    struct XRecordRange16 {
        first: u16,
        last: u16,
    }

    #[repr(C)]
    struct XRecordExtRange {
        ext_major: XRecordRange8,
        ext_minor: XRecordRange16,
    }

    #[repr(C)]
    struct XRecordRange {
        core_requests: XRecordRange8,
        core_replies: XRecordRange8,
        ext_requests: XRecordExtRange,
        ext_replies: XRecordExtRange,
        delivered_events: XRecordRange8,
        device_events: XRecordRange8,
        errors: XRecordRange8,
        client_started: c_int,
        client_died: c_int,
    }

    #[repr(C)]
    struct XRecordInterceptData {
        id_base: c_ulong,
        server_time: c_ulong,
        client_seq: c_ulong,
        category: c_int,
        client_swapped: c_int,
        data: *const u8,
        data_len: c_ulong,
    }

    type XOpenDisplayFn = unsafe extern "C" fn(*const c_char) -> *mut c_void;
    type XCloseDisplayFn = unsafe extern "C" fn(*mut c_void) -> c_int;
    type XDefaultScreenFn = unsafe extern "C" fn(*mut c_void) -> c_int;
    type XDefaultRootWindowFn = unsafe extern "C" fn(*mut c_void) -> c_ulong;
    type XDisplayWidthFn = unsafe extern "C" fn(*mut c_void, c_int) -> c_int;
    type XDisplayHeightFn = unsafe extern "C" fn(*mut c_void, c_int) -> c_int;
    type XSyncFn = unsafe extern "C" fn(*mut c_void, c_int) -> c_int;
    type XFreeFn = unsafe extern "C" fn(*mut c_void) -> c_int;
    type XQueryPointerFn = unsafe extern "C" fn(
        *mut c_void,
        c_ulong,
        *mut c_ulong,
        *mut c_ulong,
        *mut c_int,
        *mut c_int,
        *mut c_int,
        *mut c_int,
        *mut c_uint,
    ) -> c_int;

    type XRecordQueryVersionFn =
        unsafe extern "C" fn(*mut c_void, *mut c_int, *mut c_int) -> c_int;
    type XRecordAllocRangeFn = unsafe extern "C" fn() -> *mut XRecordRange;
    type XRecordCreateContextFn = unsafe extern "C" fn(
        *mut c_void,
        c_int,
        *mut c_ulong,
        c_int,
        *mut *mut XRecordRange,
        c_int,
    ) -> c_ulong;
    type XRecordInterceptProc =
        unsafe extern "C" fn(*mut c_void, *mut XRecordInterceptData);
    type XRecordEnableContextFn = unsafe extern "C" fn(
        *mut c_void,
        c_ulong,
        XRecordInterceptProc,
        *mut c_void,
    ) -> c_int;
    type XRecordFreeContextFn = unsafe extern "C" fn(*mut c_void, c_ulong) -> c_int;
    type XRecordFreeDataFn = unsafe extern "C" fn(*mut XRecordInterceptData);

    struct X11Api {
        open_display: XOpenDisplayFn,
        close_display: XCloseDisplayFn,
        default_screen: XDefaultScreenFn,
        default_root_window: XDefaultRootWindowFn,
        display_width: XDisplayWidthFn,
        display_height: XDisplayHeightFn,
        sync: XSyncFn,
        xfree: XFreeFn,
        query_pointer: XQueryPointerFn,
    }

    struct XRecordApi {
        query_version: XRecordQueryVersionFn,
        alloc_range: XRecordAllocRangeFn,
        create_context: XRecordCreateContextFn,
        enable_context: XRecordEnableContextFn,
        free_context: XRecordFreeContextFn,
        free_data: XRecordFreeDataFn,
    }

    static X11_API: OnceLock<Option<X11Api>> = OnceLock::new();
    static XRECORD_API: OnceLock<Option<XRecordApi>> = OnceLock::new();
    static XRECORD_FREE_DATA: OnceLock<XRecordFreeDataFn> = OnceLock::new();

    static SCREEN_W: AtomicI32 = AtomicI32::new(0);
    static SCREEN_H: AtomicI32 = AtomicI32::new(0);
    static LAST_CURSOR_X: AtomicI32 = AtomicI32::new(0);
    static LAST_CURSOR_Y: AtomicI32 = AtomicI32::new(0);
    static HAS_CURSOR: AtomicBool = AtomicBool::new(false);
    static X11_ALT_HELD: AtomicBool = AtomicBool::new(false);

    unsafe fn load_sym<T>(lib: *mut c_void, name: &'static [u8]) -> Option<T> {
        let ptr = dlsym(lib, name.as_ptr() as *const c_char);
        if ptr.is_null() {
            None
        } else {
            Some(std::mem::transmute_copy(&ptr))
        }
    }

    fn x11_api() -> Option<&'static X11Api> {
        X11_API
            .get_or_init(|| unsafe {
                let lib = dlopen(b"libX11.so.6\0".as_ptr() as *const c_char, RTLD_LAZY | RTLD_LOCAL);
                if lib.is_null() {
                    return None;
                }
                Some(X11Api {
                    open_display: load_sym(lib, b"XOpenDisplay\0")?,
                    close_display: load_sym(lib, b"XCloseDisplay\0")?,
                    default_screen: load_sym(lib, b"XDefaultScreen\0")?,
                    default_root_window: load_sym(lib, b"XDefaultRootWindow\0")?,
                    display_width: load_sym(lib, b"XDisplayWidth\0")?,
                    display_height: load_sym(lib, b"XDisplayHeight\0")?,
                    sync: load_sym(lib, b"XSync\0")?,
                    xfree: load_sym(lib, b"XFree\0")?,
                    query_pointer: load_sym(lib, b"XQueryPointer\0")?,
                })
            })
            .as_ref()
    }

    fn xrecord_api() -> Option<&'static XRecordApi> {
        XRECORD_API
            .get_or_init(|| unsafe {
                let lib = dlopen(b"libXtst.so.6\0".as_ptr() as *const c_char, RTLD_LAZY | RTLD_LOCAL);
                if lib.is_null() {
                    return None;
                }
                Some(XRecordApi {
                    query_version: load_sym(lib, b"XRecordQueryVersion\0")?,
                    alloc_range: load_sym(lib, b"XRecordAllocRange\0")?,
                    create_context: load_sym(lib, b"XRecordCreateContext\0")?,
                    enable_context: load_sym(lib, b"XRecordEnableContext\0")?,
                    free_context: load_sym(lib, b"XRecordFreeContext\0")?,
                    free_data: load_sym(lib, b"XRecordFreeData\0")?,
                })
            })
            .as_ref()
    }

    fn update_screen_size_from_display(api: &X11Api, dpy: *mut c_void) -> (i32, i32) {
        unsafe {
            let scr = (api.default_screen)(dpy);
            let w = (api.display_width)(dpy, scr);
            let h = (api.display_height)(dpy, scr);
            if w > 0 && h > 0 {
                SCREEN_W.store(w, Ordering::Relaxed);
                SCREEN_H.store(h, Ordering::Relaxed);
                (w, h)
            } else {
                (1920, 1080)
            }
        }
    }

    pub fn primary_screen_size() -> (i32, i32) {
        let cw = SCREEN_W.load(Ordering::Relaxed);
        let ch = SCREEN_H.load(Ordering::Relaxed);
        if cw > 0 && ch > 0 {
            return (cw, ch);
        }
        if let Some(api) = x11_api() {
            unsafe {
                let dpy = (api.open_display)(std::ptr::null());
                if !dpy.is_null() {
                    let size = update_screen_size_from_display(api, dpy);
                    (api.close_display)(dpy);
                    return size;
                }
            }
        }
        (1920, 1080)
    }

    struct X11QueryConn {
        dpy: *mut c_void,
        root: c_ulong,
        close_fn: XCloseDisplayFn,
    }

    impl Drop for X11QueryConn {
        fn drop(&mut self) {
            if !self.dpy.is_null() {
                unsafe {
                    (self.close_fn)(self.dpy);
                }
            }
        }
    }

    thread_local! {
        static QUERY_CONN: RefCell<Option<Option<X11QueryConn>>> = const { RefCell::new(None) };
    }

    pub fn cursor_pos() -> Option<(i32, i32)> {
        if let Some(api) = x11_api() {
            let queried = QUERY_CONN.with(|cell| {
                let mut borrow = cell.borrow_mut();
                if borrow.is_none() {
                    let conn = unsafe {
                        let dpy = (api.open_display)(std::ptr::null());
                        if dpy.is_null() {
                            None
                        } else {
                            let root = (api.default_root_window)(dpy);
                            update_screen_size_from_display(api, dpy);
                            Some(X11QueryConn {
                                dpy,
                                root,
                                close_fn: api.close_display,
                            })
                        }
                    };
                    *borrow = Some(conn);
                }
                if let Some(Some(conn)) = borrow.as_ref() {
                    let mut root_ret: c_ulong = 0;
                    let mut child_ret: c_ulong = 0;
                    let mut root_x: c_int = 0;
                    let mut root_y: c_int = 0;
                    let mut win_x: c_int = 0;
                    let mut win_y: c_int = 0;
                    let mut mask: c_uint = 0;
                    let ok = unsafe {
                        (api.query_pointer)(
                            conn.dpy,
                            conn.root,
                            &mut root_ret,
                            &mut child_ret,
                            &mut root_x,
                            &mut root_y,
                            &mut win_x,
                            &mut win_y,
                            &mut mask,
                        )
                    };
                    if ok != 0 {
                        X11_ALT_HELD.store((mask & MOD1_MASK) != 0, Ordering::Relaxed);
                        LAST_CURSOR_X.store(root_x, Ordering::Relaxed);
                        LAST_CURSOR_Y.store(root_y, Ordering::Relaxed);
                        HAS_CURSOR.store(true, Ordering::Relaxed);
                        return Some((root_x, root_y));
                    }
                }
                None
            });
            if queried.is_some() {
                return queried;
            }
        }
        if HAS_CURSOR.load(Ordering::Relaxed) {
            Some((
                LAST_CURSOR_X.load(Ordering::Relaxed),
                LAST_CURSOR_Y.load(Ordering::Relaxed),
            ))
        } else {
            None
        }
    }

    pub fn is_alt_pressed() -> bool {
        X11_ALT_HELD.load(Ordering::Relaxed)
    }

    unsafe extern "C" fn record_callback(
        _closure: *mut c_void,
        intercept: *mut XRecordInterceptData,
    ) {
        if intercept.is_null() {
            return;
        }
        let data_ref = &*intercept;
        if data_ref.category == X_RECORD_FROM_SERVER
            && !data_ref.data.is_null()
            && data_ref.data_len >= 8
        {
            let byte_len = (data_ref.data_len as usize).saturating_mul(4);
            let full = std::slice::from_raw_parts(data_ref.data, byte_len);
            let swapped = data_ref.client_swapped != 0;

            if let Some(tx) = HOOK_TX.get() {
                let mut off = 0usize;
                while off + 32 <= full.len() {
                    let raw = &full[off..off + 32];
                    off += 32;
                    let ev_type = raw[0] & 0x7F;
                    let detail = raw[1];
                    match ev_type {
                        2 => {
                            // X11 KeyPress (Xorg evdev keycodes are offset by +8)
                            if detail >= 8 {
                                if let Some(vk) = linux_evdev_to_vk((detail - 8) as u16) {
                                    let _ = tx.send(RawHookMsg::KeyDown {
                                        vk,
                                        scan: detail as u32,
                                        source: KeySource::Primary,
                                    });
                                }
                            }
                        }
                        3 => {
                            // X11 KeyRelease
                            if detail >= 8 {
                                if let Some(vk) = linux_evdev_to_vk((detail - 8) as u16) {
                                    let _ = tx.send(RawHookMsg::KeyUp {
                                        vk,
                                        scan: detail as u32,
                                        source: KeySource::Primary,
                                    });
                                }
                            }
                        }
                        4 => {
                            // X11 ButtonPress
                            match detail {
                                1 => {
                                    let _ = tx.send(RawHookMsg::MouseDown("left"));
                                }
                                2 => {
                                    let _ = tx.send(RawHookMsg::MouseDown("middle"));
                                }
                                3 => {
                                    let _ = tx.send(RawHookMsg::MouseDown("right"));
                                }
                                4 => {
                                    let _ = tx.send(RawHookMsg::MouseWheel(120));
                                }
                                5 => {
                                    let _ = tx.send(RawHookMsg::MouseWheel(-120));
                                }
                                _ => {}
                            }
                        }
                        5 => {
                            // X11 ButtonRelease
                            match detail {
                                1 => {
                                    let _ = tx.send(RawHookMsg::MouseUp("left"));
                                }
                                2 => {
                                    let _ = tx.send(RawHookMsg::MouseUp("middle"));
                                }
                                3 => {
                                    let _ = tx.send(RawHookMsg::MouseUp("right"));
                                }
                                _ => {}
                            }
                        }
                        6 => {
                            // X11 MotionNotify
                            let mut rx = i16::from_ne_bytes([raw[20], raw[21]]);
                            let mut ry = i16::from_ne_bytes([raw[22], raw[23]]);
                            let mut state = u16::from_ne_bytes([raw[28], raw[29]]);
                            if swapped {
                                rx = rx.swap_bytes();
                                ry = ry.swap_bytes();
                                state = state.swap_bytes();
                            }
                            let x = rx as i32;
                            let y = ry as i32;
                            LAST_CURSOR_X.store(x, Ordering::Relaxed);
                            LAST_CURSOR_Y.store(y, Ordering::Relaxed);
                            HAS_CURSOR.store(true, Ordering::Relaxed);
                            X11_ALT_HELD
                                .store((state & (MOD1_MASK as u16)) != 0, Ordering::Relaxed);
                            let _ = tx.send(RawHookMsg::MouseMove { x, y });
                        }
                        _ => {}
                    }
                }
            }
        }
        if let Some(free_fn) = XRECORD_FREE_DATA.get() {
            free_fn(intercept);
        }
    }

    fn try_run_xrecord_loop() -> bool {
        let (Some(x11), Some(xrec)) = (x11_api(), xrecord_api()) else {
            return false;
        };
        let _ = XRECORD_FREE_DATA.set(xrec.free_data);

        unsafe {
            let ctrl_dpy = (x11.open_display)(std::ptr::null());
            if ctrl_dpy.is_null() {
                return false;
            }
            let data_dpy = (x11.open_display)(std::ptr::null());
            if data_dpy.is_null() {
                (x11.close_display)(ctrl_dpy);
                return false;
            }

            let mut major: c_int = 0;
            let mut minor: c_int = 0;
            if (xrec.query_version)(ctrl_dpy, &mut major, &mut minor) == 0 {
                (x11.close_display)(data_dpy);
                (x11.close_display)(ctrl_dpy);
                return false;
            }

            update_screen_size_from_display(x11, ctrl_dpy);

            let range = (xrec.alloc_range)();
            if range.is_null() {
                (x11.close_display)(data_dpy);
                (x11.close_display)(ctrl_dpy);
                return false;
            }
            // Capture KeyPress(2), KeyRelease(3), ButtonPress(4), ButtonRelease(5), MotionNotify(6)
            (*range).device_events.first = 2;
            (*range).device_events.last = 6;

            let mut clients: c_ulong = X_RECORD_ALL_CLIENTS;
            let mut range_ptr = range;
            let ctx = (xrec.create_context)(ctrl_dpy, 0, &mut clients, 1, &mut range_ptr, 1);
            (x11.xfree)(range as *mut c_void);

            if ctx == 0 {
                (x11.close_display)(data_dpy);
                (x11.close_display)(ctrl_dpy);
                return false;
            }

            // Flush context creation on control connection before enabling on data connection
            (x11.sync)(ctrl_dpy, 0);

            // Blocks until context is disabled or display disconnects
            let ok = (xrec.enable_context)(data_dpy, ctx, record_callback, std::ptr::null_mut());

            (xrec.free_context)(ctrl_dpy, ctx);
            (x11.close_display)(data_dpy);
            (x11.close_display)(ctrl_dpy);
            ok != 0
        }
    }

    /// Fallback capture for pure-Wayland sessions when the user belongs to the `input` group
    /// (reads `/dev/input/event*` non-blockingly without requiring root).
    fn run_evdev_fallback_loop() {
        const O_NONBLOCK: c_int = 0x800; // Identical on Linux x86_64 and aarch64
        const EV_KEY: u16 = 1;
        const EV_REL: u16 = 2;
        const REL_WHEEL: u16 = 8;
        const BTN_LEFT: u16 = 272;
        const BTN_RIGHT: u16 = 273;
        const BTN_MIDDLE: u16 = 274;

        let mut files: Vec<std::fs::File> = Vec::new();
        let mut last_scan = Instant::now() - Duration::from_secs(10);
        let mut buf = [0u8; 24 * 16];

        loop {
            if files.is_empty() || last_scan.elapsed() >= Duration::from_secs(10) {
                last_scan = Instant::now();
                let mut opened = Vec::new();
                for i in 0..32 {
                    let path = format!("/dev/input/event{}", i);
                    if let Ok(f) = OpenOptions::new()
                        .read(true)
                        .custom_flags(O_NONBLOCK)
                        .open(&path)
                    {
                        opened.push(f);
                    }
                }
                if !opened.is_empty() {
                    files = opened;
                }
            }

            if files.is_empty() {
                std::thread::sleep(Duration::from_secs(2));
                continue;
            }

            let mut any_read = false;
            for f in &mut files {
                match f.read(&mut buf) {
                    Ok(n) if n >= 24 => {
                        any_read = true;
                        let count = n / 24;
                        if let Some(tx) = HOOK_TX.get() {
                            for idx in 0..count {
                                let off = idx * 24;
                                // 64-bit Linux struct input_event: tv_sec(8), tv_usec(8), type(2), code(2), value(4)
                                let ev_type = u16::from_ne_bytes([buf[off + 16], buf[off + 17]]);
                                let code = u16::from_ne_bytes([buf[off + 18], buf[off + 19]]);
                                let val = i32::from_ne_bytes([
                                    buf[off + 20],
                                    buf[off + 21],
                                    buf[off + 22],
                                    buf[off + 23],
                                ]);
                                if ev_type == EV_KEY {
                                    match code {
                                        BTN_LEFT => {
                                            if val == 1 {
                                                let _ = tx.send(RawHookMsg::MouseDown("left"));
                                            } else if val == 0 {
                                                let _ = tx.send(RawHookMsg::MouseUp("left"));
                                            }
                                        }
                                        BTN_RIGHT => {
                                            if val == 1 {
                                                let _ = tx.send(RawHookMsg::MouseDown("right"));
                                            } else if val == 0 {
                                                let _ = tx.send(RawHookMsg::MouseUp("right"));
                                            }
                                        }
                                        BTN_MIDDLE => {
                                            if val == 1 {
                                                let _ = tx.send(RawHookMsg::MouseDown("middle"));
                                            } else if val == 0 {
                                                let _ = tx.send(RawHookMsg::MouseUp("middle"));
                                            }
                                        }
                                        _ => {
                                            if let Some(vk) = linux_evdev_to_vk(code) {
                                                if val == 1 || val == 2 {
                                                    let _ = tx.send(RawHookMsg::KeyDown {
                                                        vk,
                                                        scan: code as u32,
                                                        source: KeySource::Primary,
                                                    });
                                                } else if val == 0 {
                                                    let _ = tx.send(RawHookMsg::KeyUp {
                                                        vk,
                                                        scan: code as u32,
                                                        source: KeySource::Primary,
                                                    });
                                                }
                                            }
                                        }
                                    }
                                } else if ev_type == EV_REL && code == REL_WHEEL && val != 0 {
                                    let delta = if val > 0 { 120 } else { -120 };
                                    let _ = tx.send(RawHookMsg::MouseWheel(delta));
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }

            if !any_read {
                std::thread::sleep(Duration::from_millis(8));
            }
        }
    }

    pub fn run_linux_hook_loop() {
        // Primary: X11 XRecord (zero-root global keyboard + mouse + wheel + motion on Xorg/UKUI/XWayland)
        let mut retries = 0u8;
        while retries < 3 {
            if try_run_xrecord_loop() {
                // XRecord ran and exited cleanly (e.g. display reset); brief pause before re-attaching
                std::thread::sleep(Duration::from_secs(1));
                retries = 0;
            } else {
                retries = retries.saturating_add(1);
                std::thread::sleep(Duration::from_millis(500));
            }
        }
        // Fallback: non-blocking evdev capture (for pure Wayland users in the `input` group)
        run_evdev_fallback_loop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linux_evdev_maps_letters_digits_modifiers_and_numpad() {
        assert_eq!(linux_evdev_to_vk(1), Some(0x1B)); // Esc
        assert_eq!(linux_evdev_to_vk(2), Some(0x31)); // 1
        assert_eq!(linux_evdev_to_vk(11), Some(0x30)); // 0
        assert_eq!(linux_evdev_to_vk(16), Some(0x51)); // Q
        assert_eq!(linux_evdev_to_vk(30), Some(0x41)); // A
        assert_eq!(linux_evdev_to_vk(44), Some(0x5A)); // Z
        assert_eq!(linux_evdev_to_vk(28), Some(0x0D)); // Enter
        assert_eq!(linux_evdev_to_vk(57), Some(0x20)); // Space
        assert_eq!(linux_evdev_to_vk(96), Some(0x10D)); // Numpad Enter
        assert_eq!(linux_evdev_to_vk(29), Some(0xA2)); // LCtrl
        assert_eq!(linux_evdev_to_vk(56), Some(0xA4)); // LAlt
        assert_eq!(linux_evdev_to_vk(100), Some(0xA5)); // RAlt
        assert_eq!(linux_evdev_to_vk(125), Some(0x5B)); // Super/Meta
        assert_eq!(linux_evdev_to_vk(87), Some(0x7A)); // F11
        assert_eq!(linux_evdev_to_vk(88), Some(0x7B)); // F12
        assert_eq!(linux_evdev_to_vk(0), None);
    }

    #[test]
    fn hid_usage_maps_letters_digits_modifiers_and_numpad() {
        assert_eq!(hid_usage_to_vk(0x04), Some(0x41)); // A
        assert_eq!(hid_usage_to_vk(0x1D), Some(0x5A)); // Z
        assert_eq!(hid_usage_to_vk(0x1E), Some(0x31)); // 1
        assert_eq!(hid_usage_to_vk(0x27), Some(0x30)); // 0
        assert_eq!(hid_usage_to_vk(0x28), Some(0x0D)); // Enter
        assert_eq!(hid_usage_to_vk(0x29), Some(0x1B)); // Esc
        assert_eq!(hid_usage_to_vk(0x2C), Some(0x20)); // Space
        assert_eq!(hid_usage_to_vk(0x58), Some(0x10D)); // Numpad Enter
        assert_eq!(hid_usage_to_vk(0xE0), Some(0xA2)); // LCtrl
        assert_eq!(hid_usage_to_vk(0xE3), Some(0x5B)); // LCommand
        assert_eq!(hid_usage_to_vk(0xE7), Some(0x5C)); // RCommand
        assert_eq!(hid_usage_to_vk(0x00), None);
        assert_eq!(hid_usage_to_vk(0x01), None);
    }

    #[test]
    fn dedup_suppresses_parallel_hid_and_cgtap_events_without_blocking_fast_repress() {
        let mut dedup = KeyDeduplicator::new();
        let t0 = Instant::now();

        // Key pressed: HID arrives first, CGEventTap arrives 2ms later -> only 1 non-repeat KeyDown
        assert_eq!(dedup.on_key_down(0x41, KeySource::Hid, t0), Some(false));
        assert_eq!(
            dedup.on_key_down(0x41, KeySource::Primary, t0 + Duration::from_millis(2)),
            None
        );

        // Held key repeat from the active source still reports repeat=true
        assert_eq!(
            dedup.on_key_down(0x41, KeySource::Hid, t0 + Duration::from_millis(350)),
            Some(true)
        );

        // Key released: HID Up emits once, trailing CGEventTap Up is suppressed
        assert!(dedup.on_key_up(0x41, KeySource::Hid));
        assert!(!dedup.on_key_up(0x41, KeySource::Primary));

        // Micro-tap race: HID Down+Up in 5ms, delayed CGEventTap Down arrives at +10ms -> suppressed
        let t1 = t0 + Duration::from_millis(500);
        assert_eq!(dedup.on_key_down(0x42, KeySource::Hid, t1), Some(false));
        assert!(dedup.on_key_up(0x42, KeySource::Hid));
        assert_eq!(
            dedup.on_key_down(0x42, KeySource::Primary, t1 + Duration::from_millis(10)),
            None
        );

        // Same-source rapid double-tap (even 20ms apart) is NEVER blocked
        let t2 = t1 + Duration::from_millis(200);
        assert_eq!(dedup.on_key_down(0x43, KeySource::Hid, t2), Some(false));
        assert!(dedup.on_key_up(0x43, KeySource::Hid));
        assert_eq!(
            dedup.on_key_down(0x43, KeySource::Hid, t2 + Duration::from_millis(20)),
            Some(false)
        );
    }
}
