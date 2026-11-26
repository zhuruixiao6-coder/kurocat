//! macOS 系统权限检测（辅助功能 / 输入监控）。
//!
//! - 辅助功能（Accessibility）：CGEventTap 抓键盘事件的前提
//! - 输入监控（Input Monitoring）：IOHIDManager 读硬件键盘的前提
//!
//! 两者都是用户手动授予的 TCC 权限，被拒后不会报错，只会"静默不计数"，
//! 所以前端要主动检测并把用户带到系统设置。

#[derive(serde::Serialize)]
pub struct MacPerms {
    pub accessibility: bool,
    pub input_monitoring: bool,
    pub is_macos: bool,
}

#[cfg(target_os = "macos")]
mod imp {
    use super::MacPerms;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> u8;
    }

    #[link(name = "IOKit", kind = "framework")]
    extern "C" {
        /// kIOHIDRequestTypeListenEvent = 1；返回 0=granted 1=denied 2=unknown
        fn IOHIDCheckAccess(request_type: u32) -> i32;
    }

    pub fn check() -> MacPerms {
        MacPerms {
            accessibility: unsafe { AXIsProcessTrusted() != 0 },
            input_monitoring: unsafe { IOHIDCheckAccess(1) == 0 },
            is_macos: true,
        }
    }

    pub fn open(kind: &str) {
        let url = match kind {
            "input" => "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
            _ => "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
        };
        let _ = std::process::Command::new("open").arg(url).spawn();
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use super::MacPerms;

    pub fn check() -> MacPerms {
        MacPerms {
            accessibility: true,
            input_monitoring: true,
            is_macos: false,
        }
    }

    pub fn open(_kind: &str) {}
}

pub fn check() -> MacPerms {
    imp::check()
}

pub fn open_settings(kind: &str) {
    imp::open(kind);
}
