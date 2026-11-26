//! User-supplied typing sound packs.
//!
//! Two layouts are supported inside `%APPDATA%\kuro-cat-pet\sounds\`:
//!
//! 1. **Mechvibes pack** — a sub folder with `config.json` + one long audio file
//!    that concatenates every key sample. `definitions[key].timing` lists
//!    `[startMs, endMs]` slices; we hand those offsets to Web Audio so each
//!    keystroke plays just its slice.
//! 2. **Plain audio folder** — a sub folder (or the sounds root) full of small
//!    `wav/mp3/ogg` files, each played whole.
//!
//! Audio is returned as base64 so the webview can `decodeAudioData` it without
//! an asset protocol scope.

use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::collections::BTreeMap;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

pub const SUPPORTED_EXTS: &[&str] = &[
    "wav", "mp3", "ogg", "oga", "opus", "m4a", "aac", "flac", "webm",
];

const MAX_FILES: usize = 120;
const MAX_FILE_BYTES: u64 = 12 * 1024 * 1024;
const MAX_VOICES: usize = 400;

const README_TEXT: &str = "敲键盘音效放这里。支持两种放法：\r\n\r\n\
【1】整个音效包文件夹（推荐）\r\n\
  每个文件夹一个音色，比如：\r\n\
  sounds\\樱桃 MX 红轴\\config.json + audio.ogg   (Mechvibes 格式：一个长音频 + 按键时序表)\r\n\
  sounds\\我的音效\\a.wav b.wav c.wav            (普通音频，每个文件一下)\r\n\
  右键猫咪 -> 外观与互动 -> 敲键盘音效 -> 自定义 -> 在「音色包」里挑。\r\n\r\n\
【2】直接把 wav/mp3 丢在 sounds 根目录\r\n\
  当作「散装音效」随机播放。\r\n\r\n\
支持格式：wav / mp3 / ogg / oga / opus / m4a / aac / flac / webm。\r\n\
放完不用重启，最多 3 秒自动扫描；也可点「重新扫描」。\r\n";

fn is_supported(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| SUPPORTED_EXTS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn audio_files_in(dir: &Path) -> Vec<(String, u64, u64)> {
    let mut out = Vec::new();
    let Ok(entries) = fs::read_dir(dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() || !is_supported(&path) {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if meta.len() == 0 || meta.len() > MAX_FILE_BYTES {
            continue;
        }
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        out.push((name, meta.len(), mtime));
    }
    out.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));
    out
}

// ---------- config.json (Mechvibes format) ----------

#[derive(Deserialize, Default)]
struct PackConfig {
    #[serde(default)]
    audio_file: Option<String>,
    #[serde(default)]
    definitions: BTreeMap<String, Definition>,
}

#[derive(Deserialize, Default)]
struct Definition {
    #[serde(default)]
    audio_file: Option<String>,
    #[serde(default)]
    timing: Vec<[f64; 2]>,
}

#[derive(Serialize, Clone)]
pub struct PackInfo {
    pub name: String,
    /// "mechvibes" | "files"
    pub kind: String,
    /// number of playable samples
    pub count: usize,
}

#[derive(Serialize)]
pub struct Track {
    pub data: String,
}

#[derive(Serialize)]
pub struct Voice {
    pub track: usize,
    pub offset: f64,
    pub duration: f64,
    /// Mechvibes key code ("KeyA", "Space", …) — empty means "any key"
    pub code: String,
}

#[derive(Serialize)]
pub struct PackData {
    pub name: String,
    pub tracks: Vec<Track>,
    pub voices: Vec<Voice>,
}

pub fn sounds_dir() -> PathBuf {
    super::config::app_data_dir().join("sounds")
}

pub fn ensure_dir() -> std::io::Result<PathBuf> {
    let dir = sounds_dir();
    fs::create_dir_all(&dir)?;
    let readme = dir.join("说明-音效放这里.txt");
    if !readme.exists() {
        let _ = fs::write(&readme, README_TEXT);
    }
    Ok(dir)
}

fn read_config(dir: &Path) -> Option<PackConfig> {
    let text = fs::read_to_string(dir.join("config.json")).ok()?;
    serde_json::from_str::<PackConfig>(&text).ok()
}

/// Resolves the audio file a definition points at, falling back to the pack's
/// top level `audio_file` and finally to the first audio file in the folder.
fn resolve_audio(dir: &Path, wanted: Option<&str>, fallback: Option<&str>) -> Option<String> {
    for cand in [wanted, fallback].into_iter().flatten() {
        let p = dir.join(cand);
        if p.is_file() && is_supported(&p) {
            return Some(cand.to_string());
        }
    }
    audio_files_in(dir).first().map(|(name, _, _)| name.clone())
}

fn voice_count(dir: &Path) -> (usize, &'static str) {
    if let Some(cfg) = read_config(dir) {
        let mut count = 0usize;
        for def in cfg.definitions.values() {
            count += def.timing.len();
        }
        if count > 0 {
            return (count.min(MAX_VOICES), "mechvibes");
        }
        if cfg.audio_file.is_some() {
            return (1, "mechvibes");
        }
    }
    (audio_files_in(dir).len(), "files")
}

/// All selectable packs (sub folders) plus a `""` pseudo pack for files sitting
/// directly in the sounds folder.
pub fn list_packs() -> Vec<PackInfo> {
    let dir = sounds_dir();
    let mut out = Vec::new();

    let loose = audio_files_in(&dir);
    if !loose.is_empty() {
        out.push(PackInfo {
            name: String::new(),
            kind: "files".into(),
            count: loose.len(),
        });
    }

    let Ok(entries) = fs::read_dir(&dir) else {
        return out;
    };
    let mut dirs: Vec<PathBuf> = entries.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
    dirs.sort_by(|a, b| {
        a.file_name()
            .map(|n| n.to_string_lossy().to_lowercase())
            .cmp(&b.file_name().map(|n| n.to_string_lossy().to_lowercase()))
    });
    for path in dirs {
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if name.is_empty() || name.starts_with('.') {
            continue;
        }
        let (count, kind) = voice_count(&path);
        if count == 0 {
            continue;
        }
        out.push(PackInfo {
            name,
            kind: kind.into(),
            count,
        });
    }
    out
}

pub fn pack_count() -> usize {
    list_packs().len()
}

/// Cheap fingerprint of the folder tree — the pet window polls this.
pub fn signature() -> String {
    let mut hasher = DefaultHasher::new();
    let packs = list_packs();
    packs.len().hash(&mut hasher);
    for pack in &packs {
        pack.name.hash(&mut hasher);
        pack.count.hash(&mut hasher);
        let dir = if pack.name.is_empty() {
            sounds_dir()
        } else {
            sounds_dir().join(&pack.name)
        };
        for (name, len, mtime) in audio_files_in(&dir) {
            name.hash(&mut hasher);
            len.hash(&mut hasher);
            mtime.hash(&mut hasher);
        }
        if let Ok(meta) = fs::metadata(dir.join("config.json")) {
            meta.len().hash(&mut hasher);
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            mtime.hash(&mut hasher);
        }
    }
    format!("{:x}-{}", hasher.finish(), packs.len())
}

pub fn load_pack(name: &str) -> Result<PackData, String> {
    // Only allow names that came back from a scan — no path traversal.
    let wanted = list_packs()
        .into_iter()
        .find(|p| p.name == name)
        .ok_or_else(|| format!("sound pack not found: {name}"))?;

    let dir = if wanted.name.is_empty() {
        sounds_dir()
    } else {
        sounds_dir().join(&wanted.name)
    };

    // Collect voices first, then read only the audio files actually used.
    let mut raw_voices: Vec<(String, f64, f64, String)> = Vec::new();
    if let Some(cfg) = read_config(&dir) {
        for (code, def) in &cfg.definitions {
            let file = resolve_audio(&dir, def.audio_file.as_deref(), cfg.audio_file.as_deref());
            let Some(file) = file else { continue };
            for [start, end] in &def.timing {
                let len = end - start;
                if len <= 1.0 {
                    continue;
                }
                raw_voices.push((
                    file.clone(),
                    (start / 1000.0).max(0.0),
                    len / 1000.0,
                    code.clone(),
                ));
                if raw_voices.len() >= MAX_VOICES {
                    break;
                }
            }
        }
    }
    if raw_voices.is_empty() {
        for (file, _, _) in audio_files_in(&dir).into_iter().take(MAX_FILES) {
            raw_voices.push((file, 0.0, 0.0, String::new()));
        }
    }
    if raw_voices.is_empty() {
        return Err("no playable audio in this pack".into());
    }

    let mut files: Vec<String> = Vec::new();
    for (file, _, _, _) in &raw_voices {
        if !files.iter().any(|f| f == file) {
            files.push(file.clone());
        }
    }

    let mut tracks = Vec::new();
    for file in &files {
        let bytes = fs::read(dir.join(file)).map_err(|e| format!("{file}: {e}"))?;
        tracks.push(Track { data: b64(&bytes) });
    }

    let voices = raw_voices
        .into_iter()
        .filter_map(|(file, offset, duration, code)| {
            let track = files.iter().position(|f| *f == file)?;
            Some(Voice {
                track,
                offset,
                duration,
                code,
            })
        })
        .collect();

    Ok(PackData {
        name: wanted.name,
        tracks,
        voices,
    })
}

pub fn open_dir() -> std::io::Result<PathBuf> {
    let dir = ensure_dir()?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("explorer")
            .arg(&dir)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(&dir).spawn()?;
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open").arg(&dir).spawn()?;
    }
    Ok(dir)
}

fn b64(input: &[u8]) -> String {
    const TABLE: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 {
            TABLE[((n >> 6) & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::b64;

    #[test]
    fn base64_matches_known_vectors() {
        assert_eq!(b64(b""), "");
        assert_eq!(b64(b"f"), "Zg==");
        assert_eq!(b64(b"fo"), "Zm8=");
        assert_eq!(b64(b"foo"), "Zm9v");
        assert_eq!(b64(b"foob"), "Zm9vYg==");
        assert_eq!(b64(b"fooba"), "Zm9vYmE=");
        assert_eq!(b64(b"foobar"), "Zm9vYmFy");
    }
}
