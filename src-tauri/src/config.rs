use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

fn default_cat_breed() -> String {
    "black".to_string()
}

fn default_idle_play() -> bool { true }
fn default_idle_play_sec() -> u32 { 30 }
fn default_walk_mode() -> String { "off".to_string() }

/// 归一化自由走动模式：仅允许 off / roam / follow
pub fn normalize_walk_mode(mode: &str) -> String {
    match mode {
        "roam" | "follow" => mode.to_string(),
        _ => "off".to_string(),
    }
}
fn default_kb_rgb_mode() -> u8 { 1 }
fn default_kb_rgb_color() -> String { "#22e0e6".to_string() }
fn default_kb_rgb_bright() -> f32 { 1.15 }
fn default_kb_rgb_speed() -> f32 { 1.0 }
fn default_kb_lights_off() -> bool { false }
fn default_kb_color_mode() -> u8 { 0 }
fn default_kb_color_a() -> String { "#22e0e6".to_string() }
fn default_kb_color_b() -> String { "#2b6cf0".to_string() }
fn default_kb_color_c() -> String { "#e14ec4".to_string() }

fn default_mcp_enabled() -> bool {
    true
}

fn default_privacy_password_guard() -> bool {
    true
}

fn default_mcp_port() -> u16 {
    27420
}

fn default_obs_enabled() -> bool {
    false
}

fn default_obs_port() -> u16 {
    27421
}

fn default_obs_hide_pet() -> bool {
    false
}

pub fn default_render_mode() -> String {
    "3d".to_string()
}

/// 2D 视角已下线：任何来源（旧配置 / MCP / 手工改 json）都归一成 3d。
pub fn normalize_render_mode(_raw: &str) -> String {
    "3d".to_string()
}

pub fn default_collar_color() -> String {
    "none".to_string()
}

pub fn normalize_collar_color(raw: &str) -> String {
    match raw.trim().to_ascii_lowercase().as_str() {
        "red" => "red".to_string(),
        "blue" => "blue".to_string(),
        "pink" => "pink".to_string(),
        "green" => "green".to_string(),
        _ => "none".to_string(),
    }
}

pub fn default_headphone_mode() -> String {
    "off".to_string()
}

pub fn default_key_sound_enabled() -> bool {
    true
}

pub fn default_key_sound_volume() -> u8 {
    55
}

pub fn default_key_sound_style() -> String {
    "mechanical".to_string()
}

pub fn default_key_sound_pack() -> String {
    String::new()
}

/// A pack is just a folder name; strip anything that could escape the sounds
/// directory and cap the length so a hand-edited settings.json stays harmless.
pub fn normalize_key_sound_pack(raw: &str) -> String {
    let cleaned: String = raw
        .trim()
        .chars()
        .filter(|c| *c != '/' && *c != '\\' && *c != ':' && !c.is_control())
        .collect();
    let trimmed = cleaned.trim_matches('.').trim().to_string();
    trimmed.chars().take(96).collect()
}

pub fn normalize_key_sound_style(raw: &str) -> String {
    let id = raw.trim().to_ascii_lowercase();
    match id.as_str() {
        "blue" | "thock" | "soft" | "typewriter" | "bubble" | "woodblock" | "droplet" | "coin"
        | "meow" | "custom" => id,
        _ => "mechanical".to_string(),
    }
}

pub fn normalize_headphone_mode(raw: &str) -> String {
    match raw.trim().to_ascii_lowercase().as_str() {
        "auto" => "auto".to_string(),
        "on" => "on".to_string(),
        _ => "off".to_string(),
    }
}

pub fn default_keyboard_layout() -> String {
    if cfg!(feature = "layout-108") {
        "108".to_string()
    } else {
        "65".to_string()
    }
}

pub fn normalize_keyboard_layout(raw: &str) -> String {
    match raw.trim() {
        "108" => "108".to_string(),
        "75" => "75".to_string(),
        _ => "65".to_string(),
    }
}

pub fn default_keyboard_orientation() -> String {
    "cat".to_string()
}

pub fn normalize_keyboard_orientation(raw: &str) -> String {
    if raw.trim() == "viewer" {
        "viewer".to_string()
    } else {
        "cat".to_string()
    }
}

pub fn default_tail_key_mode() -> String {
    "smart".to_string()
}

pub fn normalize_tail_key_mode(raw: &str) -> String {
    match raw.trim().to_ascii_lowercase().as_str() {
        "custom" => "custom".to_string(),
        "edge" => "edge".to_string(),
        "off" => "off".to_string(),
        _ => "smart".to_string(),
    }
}

pub fn default_tail_key_ids() -> Vec<String> {
    vec![
        "enter".to_string(),
        "space".to_string(),
        "bs".to_string(),
        "esc".to_string(),
    ]
}

pub fn normalize_tail_key_ids(raw: &[String]) -> Vec<String> {
    let mut out = Vec::with_capacity(raw.len().min(120));
    for item in raw {
        let clean: String = item
            .trim()
            .to_ascii_lowercase()
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '_')
            .take(24)
            .collect();
        if !clean.is_empty() && !out.contains(&clean) {
            out.push(clean);
            if out.len() >= 120 {
                break;
            }
        }
    }
    out
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub x: Option<i32>,
    pub y: Option<i32>,
    #[cfg(target_os = "macos")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_id: Option<String>,
    #[cfg(windows)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub windows_display_id: Option<String>,
    pub scale: f64,
    pub always_on_top: bool,
    pub click_through_locked: bool,
    pub show_key_bubbles: bool,
    pub sound_enabled: bool,
    #[serde(default = "default_key_sound_enabled")]
    pub key_sound_enabled: bool,
    #[serde(default = "default_key_sound_volume")]
    pub key_sound_volume: u8,
    #[serde(default = "default_key_sound_style")]
    pub key_sound_style: String,
    #[serde(default = "default_key_sound_pack")]
    pub key_sound_pack: String,
    pub autostart: bool,
    #[serde(default = "default_cat_breed")]
    pub cat_breed: String,
    #[serde(default = "default_mcp_enabled")]
    pub mcp_enabled: bool,
    #[serde(default = "default_mcp_port")]
    pub mcp_port: u16,
    #[serde(default = "default_keyboard_layout")]
    pub keyboard_layout: String,
    #[serde(default = "default_keyboard_orientation")]
    pub keyboard_orientation: String,
    #[serde(default)]
    pub keyboard_preset: String,
    #[serde(default = "default_idle_play")]
    pub idle_play: bool,
    #[serde(default = "default_idle_play_sec")]
    pub idle_play_sec: u32,
    #[serde(default = "default_walk_mode")]
    pub walk_mode: String,
    #[serde(default = "default_kb_rgb_mode")]
    pub kb_rgb_mode: u8,
    #[serde(default = "default_kb_rgb_color")]
    pub kb_rgb_color: String,
    #[serde(default = "default_kb_rgb_bright")]
    pub kb_rgb_bright: f32,
    #[serde(default = "default_kb_rgb_speed")]
    pub kb_rgb_speed: f32,
    #[serde(default = "default_kb_lights_off")]
    pub kb_lights_off: bool,
    #[serde(default = "default_kb_color_mode")]
    pub kb_color_mode: u8,
    #[serde(default = "default_kb_color_a")]
    pub kb_color_a: String,
    #[serde(default = "default_kb_color_b")]
    pub kb_color_b: String,
    #[serde(default = "default_kb_color_c")]
    pub kb_color_c: String,
    #[serde(default = "default_privacy_password_guard")]
    pub privacy_password_guard: bool,
    #[serde(default = "default_tail_key_mode")]
    pub tail_key_mode: String,
    #[serde(default = "default_tail_key_ids")]
    pub tail_key_ids: Vec<String>,
    #[serde(default = "default_obs_enabled")]
    pub obs_enabled: bool,
    #[serde(default = "default_obs_port")]
    pub obs_port: u16,
    #[serde(default = "default_obs_hide_pet")]
    pub obs_hide_pet: bool,
    #[serde(default = "default_render_mode")]
    pub render_mode: String,
    #[serde(default = "default_collar_color")]
    pub collar_color: String,
    #[serde(default = "default_headphone_mode")]
    pub headphone_mode: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            x: None,
            y: None,
            #[cfg(target_os = "macos")]
            display_id: None,
            #[cfg(windows)]
            windows_display_id: None,
            scale: 1.0,
            always_on_top: true,
            click_through_locked: false,
            show_key_bubbles: true,
            sound_enabled: true,
            key_sound_enabled: default_key_sound_enabled(),
            key_sound_volume: default_key_sound_volume(),
            key_sound_style: default_key_sound_style(),
            key_sound_pack: default_key_sound_pack(),
            autostart: false,
            cat_breed: default_cat_breed(),
            mcp_enabled: default_mcp_enabled(),
            mcp_port: default_mcp_port(),
            keyboard_layout: default_keyboard_layout(),
            keyboard_orientation: default_keyboard_orientation(),
            keyboard_preset: String::new(),
            idle_play: default_idle_play(),
            idle_play_sec: default_idle_play_sec(),
            walk_mode: default_walk_mode(),
            kb_rgb_mode: default_kb_rgb_mode(),
            kb_rgb_color: default_kb_rgb_color(),
            kb_rgb_bright: default_kb_rgb_bright(),
            kb_rgb_speed: default_kb_rgb_speed(),
            kb_lights_off: default_kb_lights_off(),
            kb_color_mode: default_kb_color_mode(),
            kb_color_a: default_kb_color_a(),
            kb_color_b: default_kb_color_b(),
            kb_color_c: default_kb_color_c(),
            privacy_password_guard: default_privacy_password_guard(),
            tail_key_mode: default_tail_key_mode(),
            tail_key_ids: default_tail_key_ids(),
            obs_enabled: default_obs_enabled(),
            obs_port: default_obs_port(),
            obs_hide_pet: default_obs_hide_pet(),
            render_mode: default_render_mode(),
            collar_color: default_collar_color(),
            headphone_mode: default_headphone_mode(),
        }
    }
}

pub fn app_data_dir() -> PathBuf {
    #[cfg(windows)]
    {
        let base = std::env::var("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."));
        base.join("kuro-cat-pet")
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."));
        home.join("Library")
            .join("Application Support")
            .join("kuro-cat-pet")
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        let home = std::env::var("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."));
        home.join(".config").join("kuro-cat-pet")
    }
}

pub fn config_path() -> PathBuf {
    app_data_dir().join("settings.json")
}

pub fn load_settings() -> AppSettings {
    let path = config_path();
    if let Ok(content) = fs::read_to_string(&path) {
        if let Ok(mut parsed) = serde_json::from_str::<AppSettings>(&content) {
            parsed.scale = parsed.scale.clamp(0.20, 1.50);
            parsed.tail_key_mode = normalize_tail_key_mode(&parsed.tail_key_mode);
            parsed.tail_key_ids = normalize_tail_key_ids(&parsed.tail_key_ids);
            parsed.render_mode = normalize_render_mode(&parsed.render_mode);
            parsed.collar_color = normalize_collar_color(&parsed.collar_color);
            parsed.headphone_mode = normalize_headphone_mode(&parsed.headphone_mode);
            parsed.key_sound_volume = parsed.key_sound_volume.min(100);
            parsed.key_sound_style = normalize_key_sound_style(&parsed.key_sound_style);
            parsed.key_sound_pack = normalize_key_sound_pack(&parsed.key_sound_pack);
            return parsed;
        }
    }
    AppSettings::default()
}

pub fn save_settings(settings: &AppSettings) {
    let _ = try_save_settings(settings);
}

pub fn try_save_settings(settings: &AppSettings) -> std::io::Result<()> {
    static NEXT_WRITE: AtomicUsize = AtomicUsize::new(0);
    let path = config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(std::io::Error::other)?;
    let write_id = NEXT_WRITE.fetch_add(1, Ordering::Relaxed);
    let temporary_path = path.with_extension(format!("json.{}.{write_id}.tmp", std::process::id()));
    let result = fs::write(&temporary_path, json).and_then(|()| fs::rename(&temporary_path, path));
    if result.is_err() {
        let _ = fs::remove_file(temporary_path);
    }
    result
}

#[cfg(windows)]
pub fn set_windows_autostart(enabled: bool) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegDeleteValueW, RegOpenKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER,
        KEY_SET_VALUE, REG_SZ,
    };

    fn to_wide(s: &str) -> Vec<u16> {
        OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    let subkey = to_wide("Software\\Microsoft\\Windows\\CurrentVersion\\Run");
    let value_name = to_wide("KuroCat");
    let legacy_value_name = to_wide("KuroCatPet");

    unsafe {
        let mut hkey: HKEY = std::ptr::null_mut();
        let status = RegOpenKeyExW(
            HKEY_CURRENT_USER,
            subkey.as_ptr(),
            0,
            KEY_SET_VALUE,
            &mut hkey,
        );
        if status != 0 {
            return Err(format!("RegOpenKeyExW failed with code {}", status));
        }

        // Clean up legacy autostart key so users upgrading from <=v4.2 never run two copies
        let _ = RegDeleteValueW(hkey, legacy_value_name.as_ptr());

        let result = if enabled {
            let exe = std::env::current_exe()
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .to_string();
            let quoted = format!("\"{}\"", exe);
            let data = to_wide(&quoted);
            let byte_len = (data.len() * std::mem::size_of::<u16>()) as u32;
            let st = RegSetValueExW(
                hkey,
                value_name.as_ptr(),
                0,
                REG_SZ,
                data.as_ptr() as *const u8,
                byte_len,
            );
            if st == 0 {
                Ok(())
            } else {
                Err(format!("RegSetValueExW failed with code {}", st))
            }
        } else {
            let _ = RegDeleteValueW(hkey, value_name.as_ptr());
            Ok(())
        };

        RegCloseKey(hkey);
        result
    }
}

#[cfg(target_os = "macos")]
pub fn set_windows_autostart(enabled: bool) -> Result<(), String> {
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    let agents_dir = PathBuf::from(home).join("Library").join("LaunchAgents");
    let plist_path = agents_dir.join("com.kurocat.pet.plist");

    if enabled {
        fs::create_dir_all(&agents_dir).map_err(|e| e.to_string())?;
        let exe = std::env::current_exe()
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .to_string();
        let plist = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.kurocat.pet</string>
    <key>ProgramArguments</key>
    <array>
        <string>{}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
"#,
            exe
        );
        fs::write(plist_path, plist).map_err(|e| e.to_string())
    } else {
        if plist_path.exists() {
            let _ = fs::remove_file(plist_path);
        }
        Ok(())
    }
}

#[cfg(all(not(windows), not(target_os = "macos")))]
pub fn set_windows_autostart(enabled: bool) -> Result<(), String> {
    let config_root = std::env::var("XDG_CONFIG_HOME")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
            PathBuf::from(home).join(".config")
        });
    let autostart_dir = config_root.join("autostart");
    let desktop_path = autostart_dir.join("kurocat.desktop");

    if enabled {
        fs::create_dir_all(&autostart_dir).map_err(|e| e.to_string())?;
        let exe = std::env::current_exe()
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .to_string();
        let entry = format!(
            "[Desktop Entry]\n\
             Type=Application\n\
             Name=KuroCat\n\
             Comment=Minimalist desktop cat typing & mouse companion\n\
             Exec=\"{exe}\"\n\
             Icon=KuroCat\n\
             Terminal=false\n\
             X-GNOME-Autostart-enabled=true\n",
            exe = exe.replace('"', "\\\"")
        );
        fs::write(desktop_path, entry).map_err(|e| e.to_string())
    } else {
        if desktop_path.exists() {
            let _ = fs::remove_file(desktop_path);
        }
        Ok(())
    }
}

#[cfg(windows)]
pub fn create_desktop_shortcut() -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_str = exe_path.to_string_lossy().replace('\'', "''");
    let work_dir = exe_path
        .parent()
        .map(|p| p.to_string_lossy().replace('\'', "''"))
        .unwrap_or_default();

    let script = format!(
        "$desktop = [Environment]::GetFolderPath('Desktop'); \
         $lnk = Join-Path $desktop 'KuroCat.lnk'; \
         $ws = New-Object -ComObject WScript.Shell; \
         $s = $ws.CreateShortcut($lnk); \
         $s.TargetPath = '{exe}'; \
         $s.WorkingDirectory = '{wd}'; \
         $s.IconLocation = '{exe},0'; \
         $s.Description = 'KuroCat Desktop Companion'; \
         $s.Save(); \
         Write-Output $lnk",
        exe = exe_str,
        wd = work_dir,
    );

    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", &script])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("Failed to invoke PowerShell: {}", e))?;

    if output.status.success() {
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(path)
    } else {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if err.is_empty() {
            "Failed to create desktop shortcut".to_string()
        } else {
            err
        })
    }
}

#[cfg(not(windows))]
pub fn create_desktop_shortcut() -> Result<String, String> {
    Ok("Desktop shortcut is managed via Applications on this OS".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tail_key_mode_normalizes_safely() {
        assert_eq!(normalize_tail_key_mode("smart"), "smart");
        assert_eq!(normalize_tail_key_mode(" CUSTOM "), "custom");
        assert_eq!(normalize_tail_key_mode("edge"), "edge");
        assert_eq!(normalize_tail_key_mode("OFF"), "off");
        assert_eq!(normalize_tail_key_mode("invalid"), "smart");
    }

    #[test]
    fn tail_key_ids_dedupes_and_sanitizes() {
        let raw = vec![
            "Enter".to_string(),
            " enter ".to_string(),
            "NP_0".to_string(),
            "bad-key!$".to_string(),
            "".to_string(),
        ];
        assert_eq!(
            normalize_tail_key_ids(&raw),
            vec!["enter".to_string(), "np_0".to_string(), "badkey".to_string()]
        );
    }

    #[test]
    fn legacy_settings_json_deserializes_with_tail_defaults() {
        let legacy = r#"{
            "x": null,
            "y": null,
            "scale": 1.0,
            "alwaysOnTop": true,
            "clickThroughLocked": false,
            "showKeyBubbles": true,
            "soundEnabled": true,
            "autostart": false
        }"#;
        let parsed: AppSettings = serde_json::from_str(legacy).expect("legacy json should parse");
        assert_eq!(parsed.tail_key_mode, "smart");
        assert_eq!(parsed.tail_key_ids, default_tail_key_ids());
    }
}
