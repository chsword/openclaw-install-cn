#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use chrono::Utc;
use dirs::home_dir;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{Emitter, Manager};

const DEFAULT_CDN_BASE: &str = "https://oclaw.chatu.plus";
const DEFAULT_NPM_REGISTRY: &str = "https://registry.npmmirror.com";
const OPENCLAW_PACKAGE_SPEC: &str = "openclaw@latest";
const NODEJS_DOWNLOAD_URL: &str = "https://nodejs.org/zh-cn/download";
const WINDOW_WIDTH: u32 = 720;
const WINDOW_MIN_HEIGHT: u32 = 520;
const WINDOW_MAX_HEIGHT: u32 = 920;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OclawConfig {
    cdn_base: String,
    npm_registry: String,
    installed_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BinaryInfo {
    installed: bool,
    version: Option<String>,
    raw: String,
    error: Option<String>,
    source: Option<String>,
    path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NodeInfo {
    installed: bool,
    version: Option<String>,
    raw: String,
    error: Option<String>,
    source: Option<String>,
    path: Option<String>,
    supported: bool,
}

#[derive(Debug, Clone)]
struct EnvironmentStatus {
    node: NodeInfo,
    pnpm: BinaryInfo,
    openclaw: BinaryInfo,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusPayload {
    installed: bool,
    installed_version: Option<String>,
    openclaw: BinaryInfo,
    cdn_base: String,
    npm_registry: String,
    platform: String,
    arch: String,
    node: NodeInfo,
    pnpm: BinaryInfo,
    install_command: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LogEntry {
    timestamp: String,
    level: String,
    source: String,
    message: String,
    stack: String,
}

fn default_config() -> OclawConfig {
    OclawConfig {
        cdn_base: DEFAULT_CDN_BASE.to_string(),
        npm_registry: DEFAULT_NPM_REGISTRY.to_string(),
        installed_version: None,
    }
}

fn config_file_path() -> PathBuf {
    home_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join(".oclaw")
        .join("config.json")
}

fn load_config() -> OclawConfig {
    let defaults = default_config();
    let path = config_file_path();
    if !path.exists() {
        return defaults;
    }

    let raw = match fs::read_to_string(path) {
        Ok(value) => value,
        Err(_) => return defaults,
    };

    match serde_json::from_str::<serde_json::Value>(&raw) {
        Ok(mut value) => {
            if let Some(obj) = value.as_object_mut() {
                obj.remove("cdnBase");
                obj.remove("cdn_base");
            }
            let mut merged = defaults;
            if let Some(v) = value.get("npmRegistry").and_then(|v| v.as_str()) {
                merged.npm_registry = v.to_string();
            }
            if let Some(v) = value.get("npm_registry").and_then(|v| v.as_str()) {
                merged.npm_registry = v.to_string();
            }
            if let Some(v) = value.get("installedVersion").and_then(|v| v.as_str()) {
                merged.installed_version = Some(v.to_string());
            }
            if let Some(v) = value.get("installed_version").and_then(|v| v.as_str()) {
                merged.installed_version = Some(v.to_string());
            }
            merged
        }
        Err(_) => defaults,
    }
}

fn save_config(config: &OclawConfig) -> Result<(), String> {
    let path = config_file_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let payload = json!({
        "npmRegistry": config.npm_registry,
        "installedVersion": config.installed_version,
    });

    fs::write(path, serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

fn update_installed_version(version: Option<String>) -> Result<(), String> {
    let mut cfg = load_config();
    cfg.installed_version = version;
    save_config(&cfg)
}

fn app_log_path(app: &tauri::AppHandle) -> PathBuf {
    if let Ok(dir) = app.path().app_log_dir() {
        return dir.join("error.log");
    }
    std::env::temp_dir().join("openclaw-error.log")
}

fn append_log(app: &tauri::AppHandle, level: &str, source: &str, message: &str, stack: Option<&str>) {
    let path = app_log_path(app);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    let timestamp = Utc::now().to_rfc3339();
    let mut line = format!("[{timestamp}] [{}] [{}] {}", level.to_uppercase(), source, message);
    if let Some(st) = stack {
        if !st.trim().is_empty() {
            line.push('\n');
            line.push_str(st);
        }
    }
    line.push('\n');
    let _ = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .and_then(|mut f| std::io::Write::write_all(&mut f, line.as_bytes()));
}

fn parse_version(raw: &str) -> Option<String> {
    let text = raw.trim();
    if text.is_empty() {
        return None;
    }

    for token in text.split_whitespace() {
        let candidate = token.trim_start_matches('v');
        let parts: Vec<&str> = candidate.split('.').collect();
        if parts.len() >= 3 && parts.iter().all(|p| p.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')) {
            return Some(candidate.to_string());
        }
    }

    Some(text.lines().next().unwrap_or(text).trim_start_matches('v').to_string())
}

fn platform_label() -> String {
    match std::env::consts::OS {
        "windows" => "Windows".to_string(),
        "macos" => "macOS".to_string(),
        _ => "Linux".to_string(),
    }
}

fn platform_code() -> &'static str {
    match std::env::consts::OS {
        "windows" => "win32",
        "macos" => "darwin",
        _ => "linux",
    }
}

fn arch_code() -> &'static str {
    match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        "x86" => "ia32",
        _ => std::env::consts::ARCH,
    }
}

fn run_command(command: &str, args: &[&str]) -> Result<(String, String), String> {
    let is_windows_shell_command = cfg!(target_os = "windows")
        && (matches!(command, "npm" | "pnpm" | "openclaw")
            || command.ends_with(".cmd")
            || command.ends_with(".bat"));

    let mut cmd = if is_windows_shell_command {
        let mut c = Command::new("cmd");
        c.arg("/C").arg(command);
        c
    } else {
        Command::new(command)
    };

    cmd.args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());

    let output = cmd.output().map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok((stdout, stderr))
    } else {
        let msg = stderr.trim();
        if msg.is_empty() {
            Err(stdout.trim().to_string())
        } else {
            Err(msg.to_string())
        }
    }
}

fn detect_binary(command: &str, args: &[&str]) -> BinaryInfo {
    match run_command(command, args) {
        Ok((stdout, stderr)) => {
            let raw = if stdout.trim().is_empty() { stderr.clone() } else { stdout.clone() };
            BinaryInfo {
                installed: true,
                version: parse_version(&raw),
                raw: raw.trim().to_string(),
                error: None,
                source: Some("path".to_string()),
                path: resolve_command_path(command),
            }
        }
        Err(err) => BinaryInfo {
            installed: false,
            version: None,
            raw: String::new(),
            error: Some(err),
            source: None,
            path: None,
        },
    }
}

fn resolve_command_path(command: &str) -> Option<String> {
    if cfg!(target_os = "windows") {
        if let Ok((stdout, _)) = run_command("where", &[command]) {
            return stdout.lines().find(|line| !line.trim().is_empty()).map(|v| v.trim().to_string());
        }
        None
    } else {
        if let Ok((stdout, _)) = run_command("which", &[command]) {
            return stdout.lines().find(|line| !line.trim().is_empty()).map(|v| v.trim().to_string());
        }
        None
    }
}

fn inspect_environment() -> EnvironmentStatus {
    let node_bin = detect_binary("node", &["--version"]);
    let pnpm_bin = detect_binary("pnpm", &["--version"]);
    let mut openclaw_bin = detect_binary("openclaw", &["--version"]);

    if (!openclaw_bin.installed || openclaw_bin.version.is_none()) && pnpm_bin.installed {
        if let Ok((stdout, stderr)) = run_command("pnpm", &["ls", "-g", "openclaw", "--json", "--depth", "0"]) {
            let raw = if stdout.trim().is_empty() { stderr } else { stdout };
            if let Some(version) = parse_openclaw_version_from_pnpm_list(&raw) {
                openclaw_bin = BinaryInfo {
                    installed: true,
                    version: Some(version),
                    raw,
                    error: None,
                    source: Some("pnpm-global-list".to_string()),
                    path: None,
                };
            }
        }
    }

    let node_major = node_bin
        .version
        .as_ref()
        .and_then(|v| v.split('.').next())
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(0);

    EnvironmentStatus {
        node: NodeInfo {
            installed: node_bin.installed,
            version: node_bin.version,
            raw: node_bin.raw,
            error: node_bin.error,
            source: node_bin.source,
            path: node_bin.path,
            supported: node_major >= 18,
        },
        pnpm: pnpm_bin,
        openclaw: openclaw_bin,
    }
}

fn parse_openclaw_version_from_pnpm_list(raw: &str) -> Option<String> {
    let parsed: serde_json::Value = serde_json::from_str(raw).ok()?;
    let list = if parsed.is_array() {
        parsed.as_array()?.clone()
    } else {
        vec![parsed]
    };

    for item in list {
        let deps = item.get("dependencies")?;
        let openclaw = deps.get("openclaw")?;
        if let Some(ver) = openclaw.get("version").and_then(|v| v.as_str()) {
            return parse_version(ver);
        }
    }
    None
}

fn compare_versions(a: &str, b: &str) -> i32 {
    let left: Vec<u32> = a.trim_start_matches('v').split('.').map(|p| p.parse::<u32>().unwrap_or(0)).collect();
    let right: Vec<u32> = b.trim_start_matches('v').split('.').map(|p| p.parse::<u32>().unwrap_or(0)).collect();
    let max_len = left.len().max(right.len());

    for idx in 0..max_len {
        let l = *left.get(idx).unwrap_or(&0);
        let r = *right.get(idx).unwrap_or(&0);
        if l > r {
            return 1;
        }
        if l < r {
            return -1;
        }
    }
    0
}

fn fetch_latest_version(cdn_base: &str) -> Result<String, String> {
    let base = cdn_base.trim_end_matches('/');
    let url = format!("{base}/manifest.json");
    let client = Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client.get(&url).send().map_err(|e| format!("Failed to fetch manifest from {url}: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Failed to fetch manifest from {url}: HTTP {}", response.status()));
    }

    let parsed: serde_json::Value = response.json().map_err(|e| e.to_string())?;
    let latest = parsed
        .get("latest")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Manifest missing \"latest\" field".to_string())?;
    Ok(latest.to_string())
}

fn install_nodejs() -> Result<(), String> {
    if cfg!(target_os = "windows") {
        let args = [
            "install",
            "--id",
            "OpenJS.NodeJS.LTS",
            "-e",
            "--accept-package-agreements",
            "--accept-source-agreements",
        ];
        let _ = run_command("winget", &args)?;
        return Ok(());
    }

    if cfg!(target_os = "macos") {
        let _ = run_command("brew", &["install", "node"])?;
        return Ok(());
    }

    Err(format!("当前系统不支持自动安装 Node.js，请手动安装：{NODEJS_DOWNLOAD_URL}"))
}

fn windows_node_candidate_paths() -> Vec<PathBuf> {
    let mut candidates = vec![
        PathBuf::from(r"C:\Program Files\nodejs\node.exe"),
        PathBuf::from(r"C:\Program Files (x86)\nodejs\node.exe"),
    ];

    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        candidates.push(PathBuf::from(&local_app_data).join("Programs").join("nodejs").join("node.exe"));
    }

    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        candidates.push(
            PathBuf::from(&user_profile)
                .join("AppData")
                .join("Local")
                .join("Programs")
                .join("nodejs")
                .join("node.exe"),
        );
    }

    candidates
}

fn windows_node_directory_candidates() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();

    if let Some(node_path) = resolve_command_path("node") {
        let path = PathBuf::from(node_path);
        if let Some(parent) = path.parent() {
            dirs.push(parent.to_path_buf());
        }
    }

    for candidate in windows_node_candidate_paths() {
        if let Some(parent) = candidate.parent() {
            dirs.push(parent.to_path_buf());
        }
    }

    let mut dedup: Vec<PathBuf> = Vec::new();
    for dir in dirs {
        if !dedup.contains(&dir) {
            dedup.push(dir);
        }
    }
    dedup
}

fn node_bundled_npm_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    for dir in windows_node_directory_candidates() {
        out.push(dir.join("npm.cmd"));
        out.push(dir.join("npm.exe"));
        out.push(dir.join("npm"));
    }
    out
}

fn install_pnpm() -> Result<(), String> {
    let args = ["install", "-g", "pnpm", "--registry=https://registry.npmmirror.com"];

    match run_command("npm", &args) {
        Ok(_) => Ok(()),
        Err(primary_error) => {
            if !cfg!(target_os = "windows") {
                return Err(primary_error);
            }

            let mut fallback_error = primary_error;
            for candidate in node_bundled_npm_candidates() {
                if !candidate.exists() {
                    continue;
                }

                let executable = candidate.to_string_lossy().to_string();
                match run_command(&executable, &args) {
                    Ok(_) => return Ok(()),
                    Err(err) => {
                        fallback_error = err;
                    }
                }
            }

            Err(fallback_error)
        }
    }
}

fn run_pnpm_install_with_progress(app: &tauri::AppHandle) -> Result<(), String> {
    let mut cmd = if cfg!(target_os = "windows") {
        let mut c = Command::new("cmd");
        c.arg("/C").arg("pnpm");
        c
    } else {
        Command::new("pnpm")
    };

    cmd.args([
        "add",
        "-g",
        OPENCLAW_PACKAGE_SPEC,
        "--registry=https://registry.npmmirror.com",
    ])
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .stdin(Stdio::null());

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let app_stdout = app.clone();
    let t_out = std::thread::spawn(move || {
        if let Some(reader) = stdout {
            let reader = BufReader::new(reader);
            for line in reader.lines().map_while(Result::ok) {
                let msg = line.trim();
                if !msg.is_empty() {
                    let _ = app_stdout.emit("install-progress", json!({ "type": "status", "message": msg }));
                }
            }
        }
    });

    let app_stderr = app.clone();
    let t_err = std::thread::spawn(move || {
        if let Some(reader) = stderr {
            let reader = BufReader::new(reader);
            for line in reader.lines().map_while(Result::ok) {
                let msg = line.trim();
                if !msg.is_empty() {
                    let _ = app_stderr.emit("install-progress", json!({ "type": "status", "message": msg }));
                }
            }
        }
    });

    let status = child.wait().map_err(|e| e.to_string())?;
    let _ = t_out.join();
    let _ = t_err.join();

    if status.success() {
        Ok(())
    } else {
        Err(format!("pnpm exited with code {:?}", status.code()))
    }
}

fn parse_log_entries(content: &str) -> Vec<LogEntry> {
    let mut entries: Vec<LogEntry> = Vec::new();
    let mut current: Option<LogEntry> = None;

    for line in content.lines() {
        let is_header = line.starts_with('[') && line.contains("] [") && line.matches(']').count() >= 3;
        if is_header {
            if let Some(entry) = current.take() {
                entries.push(entry);
            }

            let mut parts = line.splitn(4, "] ");
            let ts = parts.next().unwrap_or("").trim_start_matches('[').to_string();
            let level = parts
                .next()
                .unwrap_or("")
                .trim_start_matches('[')
                .trim_end_matches(']')
                .to_lowercase();
            let source = parts
                .next()
                .unwrap_or("")
                .trim_start_matches('[')
                .trim_end_matches(']')
                .to_string();
            let message = parts.next().unwrap_or("").to_string();

            current = Some(LogEntry {
                timestamp: ts,
                level,
                source,
                message,
                stack: String::new(),
            });
        } else if let Some(entry) = current.as_mut() {
            if !line.trim().is_empty() {
                if !entry.stack.is_empty() {
                    entry.stack.push('\n');
                }
                entry.stack.push_str(line);
            }
        }
    }

    if let Some(entry) = current {
        entries.push(entry);
    }

    entries
}

#[tauri::command]
fn get_status() -> Result<StatusPayload, String> {
    let config = load_config();
    let env = inspect_environment();
    Ok(StatusPayload {
        installed: env.openclaw.installed,
        installed_version: env
            .openclaw
            .version
            .clone()
            .or_else(|| config.installed_version.clone()),
        openclaw: env.openclaw,
        cdn_base: config.cdn_base,
        npm_registry: config.npm_registry,
        platform: platform_label(),
        arch: arch_code().to_string(),
        node: env.node,
        pnpm: env.pnpm,
        install_command: format!(
            "pnpm add -g {} --registry={}",
            OPENCLAW_PACKAGE_SPEC, DEFAULT_NPM_REGISTRY
        ),
    })
}

#[tauri::command]
fn resize_window(window: tauri::Window, height: f64) -> Result<serde_json::Value, String> {
    if !height.is_finite() {
        return Ok(json!({"success": false, "error": "invalid height"}));
    }
    let bounded = height.round().clamp(WINDOW_MIN_HEIGHT as f64, WINDOW_MAX_HEIGHT as f64) as u32;
    let current = window.inner_size().map_err(|e| e.to_string())?;
    window
        .set_size(tauri::Size::Physical(tauri::PhysicalSize::new(
            current.width.max(WINDOW_WIDTH),
            bounded,
        )))
        .map_err(|e| e.to_string())?;
    Ok(json!({"success": true, "height": bounded}))
}

#[tauri::command]
fn check_latest() -> serde_json::Value {
    let config = load_config();
    match fetch_latest_version(&config.cdn_base) {
        Ok(latest) => {
            let env = inspect_environment();
            let installed = env.openclaw.version.clone();
            let update_available = installed
                .as_ref()
                .map(|v| compare_versions(&latest, v) > 0)
                .unwrap_or(false);

            json!({
                "success": true,
                "latest": latest,
                "installedVersion": installed,
                "updateAvailable": update_available,
            })
        }
        Err(err) => json!({"success": false, "error": err}),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallOpts {
    force: Option<bool>,
}

#[tauri::command]
fn install(app: tauri::AppHandle, opts: Option<InstallOpts>) -> serde_json::Value {
    let force = opts.and_then(|v| v.force).unwrap_or(false);
    let _ = app.emit("install-progress", json!({ "type": "status", "message": "检查 Node.js、pnpm 与 OpenClaw 环境…" }));

    let env = inspect_environment();
    if !env.node.installed {
        return json!({"success": false, "error": "未检测到 Node.js。请先安装 Node.js 18 或更高版本。"});
    }
    if !env.node.supported {
        return json!({"success": false, "error": format!("当前 Node.js 版本为 {}，需要 18 或更高版本。", env.node.version.unwrap_or_else(|| "unknown".to_string()))});
    }

    if !env.pnpm.installed {
        let _ = app.emit("install-progress", json!({ "type": "status", "message": "未检测到 pnpm，正在自动安装…" }));
        if let Err(err) = install_pnpm() {
            return json!({"success": false, "error": err});
        }
        let refreshed = inspect_environment();
        if !refreshed.pnpm.installed {
            return json!({"success": false, "error": "pnpm 自动安装完成后仍未检测到 pnpm，请检查 npm 全局目录与 PATH 设置。"});
        }
    }

    let _ = app.emit("install-progress", json!({ "type": "status", "message": "读取 manifest.json 中的最新版本…" }));
    let latest = match fetch_latest_version(&load_config().cdn_base) {
        Ok(v) => v,
        Err(err) => return json!({"success": false, "error": err}),
    };

    let current = inspect_environment();
    if !force && current.openclaw.installed {
        if let Some(installed) = current.openclaw.version.clone() {
            if compare_versions(&installed, &latest) >= 0 {
                let _ = update_installed_version(Some(installed.clone()));
                return json!({"success": true, "version": installed, "skipped": true});
            }
        }
    }

    let _ = app.emit("install-progress", json!({ "type": "status", "message": "正在通过 pnpm 安装 OpenClaw…" }));
    if let Err(err) = run_pnpm_install_with_progress(&app) {
        append_log(&app, "error", "main", &err, None);
        return json!({"success": false, "error": err});
    }

    let refreshed = inspect_environment();
    if !refreshed.openclaw.installed || refreshed.openclaw.version.is_none() {
        return json!({"success": false, "error": "pnpm 已执行完成，但当前终端环境仍无法识别 openclaw 命令。请确认 pnpm 全局目录已加入 PATH。"});
    }

    let version = refreshed.openclaw.version.unwrap_or_default();
    let _ = update_installed_version(Some(version.clone()));
    append_log(&app, "info", "main", &format!("OpenClaw {version} installed successfully"), None);
    json!({"success": true, "version": version})
}

#[tauri::command]
fn install_nodejs_cmd() -> serde_json::Value {
    match install_nodejs() {
        Ok(()) => {
            let refreshed = inspect_environment();
            if !refreshed.node.installed {
                return json!({
                    "success": false,
                    "error": format!("自动安装完成后仍未检测到 Node.js。请手动安装：{NODEJS_DOWNLOAD_URL}")
                });
            }
            json!({
                "success": true,
                "version": refreshed.node.version,
                "supported": refreshed.node.supported
            })
        }
        Err(err) => json!({
            "success": false,
            "error": err,
            "manualUrl": NODEJS_DOWNLOAD_URL
        }),
    }
}

#[tauri::command]
fn install_pnpm_cmd() -> serde_json::Value {
    let env = inspect_environment();
    if !env.node.installed {
        return json!({"success": false, "error": "未检测到 Node.js。请先安装 Node.js 18 或更高版本。"});
    }
    if !env.node.supported {
        return json!({"success": false, "error": format!("当前 Node.js 版本为 {}，需要 18 或更高版本。", env.node.version.unwrap_or_else(|| "unknown".to_string()))});
    }

    match install_pnpm() {
        Ok(_) => {
            let refreshed = inspect_environment();
            if !refreshed.pnpm.installed {
                return json!({"success": false, "error": "pnpm 安装完成后仍未检测到 pnpm，请检查 npm 全局目录与 PATH 设置。"});
            }
            json!({"success": true, "version": refreshed.pnpm.version})
        }
        Err(err) => json!({"success": false, "error": err}),
    }
}

#[tauri::command]
fn log_error(app: tauri::AppHandle, message: String, stack: Option<String>) {
    append_log(&app, "error", "renderer", &message, stack.as_deref());
}

#[tauri::command]
fn get_logs(app: tauri::AppHandle) -> serde_json::Value {
    let path = app_log_path(&app);
    if !path.exists() {
        return json!({"success": true, "entries": []});
    }

    match fs::read_to_string(path) {
        Ok(content) => json!({"success": true, "entries": parse_log_entries(&content)}),
        Err(err) => json!({"success": false, "error": err.to_string()}),
    }
}

#[tauri::command]
fn clear_logs(app: tauri::AppHandle) -> serde_json::Value {
    let path = app_log_path(&app);
    if path.exists() {
        if let Err(err) = fs::write(path, "") {
            return json!({"success": false, "error": err.to_string()});
        }
    }
    json!({"success": true})
}

#[tauri::command]
fn export_logs(app: tauri::AppHandle) -> serde_json::Value {
    let source = app_log_path(&app);
    let save_path = rfd::FileDialog::new()
        .set_title("导出日志")
        .set_file_name("openclaw.log")
        .save_file();

    let Some(target) = save_path else {
        return json!({"success": true, "canceled": true});
    };

    let result = if source.exists() {
        fs::copy(&source, &target).map(|_| ())
    } else {
        fs::write(&target, "")
    };

    match result {
        Ok(_) => json!({"success": true, "filePath": target.to_string_lossy()}),
        Err(err) => json!({"success": false, "error": err.to_string()}),
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let app_handle = app.handle().clone();
            std::panic::set_hook(Box::new(move |panic_info| {
                let msg = panic_info.to_string();
                append_log(&app_handle, "error", "main", &msg, None);
            }));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_status,
            resize_window,
            check_latest,
            install,
            install_nodejs_cmd,
            install_pnpm_cmd,
            log_error,
            get_logs,
            clear_logs,
            export_logs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
