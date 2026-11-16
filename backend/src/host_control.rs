//! GNOME desktop launcher and KDE Connect CLI companion. All actions use argv, never a shell.
use anyhow::{Result, bail};
use axum::{
    Json,
    extract::Query,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{collections::BTreeMap, fs, path::PathBuf, process::Command, time::Duration};

fn run(program: &str, args: &[&str]) -> Result<String> {
    let output = Command::new(crate::apps::resolve_program(program)?)
        .args(args)
        .output()?;
    if !output.status.success() {
        bail!(
            "{program}: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}
struct DesktopApp {
    id: String,
    name: String,
    path: PathBuf,
}
fn installed_apps() -> Vec<DesktopApp> {
    let home = crate::apps::home().unwrap_or_default();
    let mut apps = BTreeMap::new();
    for dir in [
        home.join(".local/share/applications"),
        PathBuf::from("/usr/share/applications"),
        home.join(".local/share/flatpak/exports/share/applications"),
        PathBuf::from("/var/lib/flatpak/exports/share/applications"),
    ] {
        let Ok(files) = fs::read_dir(dir) else {
            continue;
        };
        for entry in files.flatten().take(4000) {
            let path = entry.path();
            let Some(id) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            if !id.ends_with(".desktop") || apps.contains_key(id) {
                continue;
            }
            let Ok(raw) = fs::read_to_string(&path) else {
                continue;
            };
            if raw.len() > 131072 {
                continue;
            }
            let (mut section, mut name, mut application, mut hidden) = (false, None, false, false);
            for line in raw.lines() {
                let line = line.trim();
                if line.starts_with('[') {
                    section = line == "[Desktop Entry]";
                    continue;
                }
                if !section {
                    continue;
                }
                if let Some(value) = line.strip_prefix("Name=") {
                    name = Some(value.trim().to_owned());
                } else if line == "Type=Application" {
                    application = true;
                } else if line == "NoDisplay=true" || line == "Hidden=true" {
                    hidden = true;
                }
            }
            if application
                && !hidden
                && let Some(name) = name
                && !name.is_empty()
            {
                apps.insert(
                    id.to_owned(),
                    DesktopApp {
                        id: id.to_owned(),
                        name,
                        path,
                    },
                );
            }
        }
    }
    apps.into_values().collect()
}
#[derive(Deserialize)]
pub struct AppQuery {
    #[serde(default)]
    q: String,
}
pub async fn app_list(Query(q): Query<AppQuery>) -> Response {
    let apps = tokio::task::spawn_blocking(move || {
        let needle = q.q.trim().to_lowercase();
        installed_apps()
            .into_iter()
            .filter(|a| {
                needle.len() <= 120
                    && (a.name.to_lowercase().contains(&needle)
                        || a.id.to_lowercase().contains(&needle))
            })
            .take(150)
            .map(|a| json!({"id":a.id,"name":a.name}))
            .collect::<Vec<_>>()
    })
    .await
    .unwrap_or_default();
    Json(json!({"apps":apps})).into_response()
}
#[derive(Deserialize)]
pub struct LaunchRequest {
    id: String,
}
pub async fn app_launch(Json(q): Json<LaunchRequest>) -> Response {
    match tokio::task::spawn_blocking(move || -> Result<Value> {
        let app = installed_apps()
            .into_iter()
            .find(|a| a.id == q.id)
            .ok_or_else(|| anyhow::anyhow!("Application not installed"))?;
        run("gio", &["launch", &app.path.to_string_lossy()])?;
        Ok(json!({"requested":true}))
    })
    .await
    {
        Ok(Ok(v)) => Json(v).into_response(),
        Ok(Err(e)) => crate::files::err(e),
        Err(e) => crate::files::err(e),
    }
}
fn gsconnect() -> bool {
    let home = crate::apps::home().unwrap_or_default();
    [
        PathBuf::from("/usr/share/gnome-shell/extensions/gsconnect@andyholmes.github.io"),
        home.join(".local/share/gnome-shell/extensions/gsconnect@andyholmes.github.io"),
    ]
    .iter()
    .any(|p| p.is_dir())
}
pub async fn desktop_status() -> Response {
    Json(json!({
        "desktop":std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_else(|_| "unknown".into()),
        "session":std::env::var("XDG_SESSION_TYPE").unwrap_or_else(|_| "unknown".into()),
        "fedora":fs::read_to_string("/etc/os-release")
            .map(|file| file.lines().any(|line| line == "ID=fedora")).unwrap_or(false),
        "ptyxis":crate::apps::resolve_program("ptyxis").is_ok(),
        "tmux":crate::apps::resolve_program("tmux").is_ok(),
        "gsconnect":gsconnect(),
        "kdeconnect_cli":crate::apps::resolve_program("kdeconnect-cli").is_ok(),
    }))
    .into_response()
}
pub async fn connect_status() -> Response {
    let v = tokio::task::spawn_blocking(|| {
        let cli = crate::apps::resolve_program("kdeconnect-cli").is_ok();
        json!({"gsconnect":gsconnect(),"kdeconnect_cli":cli,
            "wdotool":crate::apps::resolve_program("wdotool").is_ok(),
            "devices":if cli { run("kdeconnect-cli", &["--list-devices"]).unwrap_or_default() } else { String::new() }})
    }).await.unwrap_or_else(|_| json!({"error":"Status unavailable"}));
    Json(v).into_response()
}
fn valid_device(v: &str) -> Result<&str> {
    if v.is_empty()
        || v.len() > 128
        || !v
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_:.".contains(&b))
    {
        bail!("Invalid device ID");
    }
    Ok(v)
}
#[derive(Deserialize)]
pub struct PairRequest {
    device: String,
}
pub async fn connect_pair(Json(q): Json<PairRequest>) -> Response {
    match tokio::task::spawn_blocking(move || -> Result<Value> {
        run(
            "kdeconnect-cli",
            &["--pair", "--device", valid_device(&q.device)?],
        )?;
        Ok(json!({"requested":true}))
    })
    .await
    {
        Ok(Ok(v)) => Json(v).into_response(),
        Ok(Err(e)) => crate::files::err(e),
        Err(e) => crate::files::err(e),
    }
}
#[derive(Deserialize)]
pub struct SendRequest {
    device: String,
    path: String,
}
pub async fn connect_send(Json(q): Json<SendRequest>) -> Response {
    match tokio::task::spawn_blocking(move || -> Result<Value> {
        let path = crate::files::resolve(&crate::files::root()?, &q.path)?;
        if !path.is_file() {
            bail!("Choose a regular file inside HOME")
        }
        run(
            "kdeconnect-cli",
            &[
                "--device",
                valid_device(&q.device)?,
                "--send",
                &path.to_string_lossy(),
            ],
        )?;
        Ok(json!({"requested":true}))
    })
    .await
    {
        Ok(Ok(v)) => Json(v).into_response(),
        Ok(Err(e)) => crate::files::err(e),
        Err(e) => crate::files::err(e),
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum TouchpadEvent {
    Move { dx: i32, dy: i32 },
    Scroll { dx: i32, dy: i32 },
    Click { button: String },
}

/// Construct only supported wdotool commands with bounded numerical arguments.
fn touchpad_args(event: &TouchpadEvent) -> Result<Vec<String>> {
    match event {
        TouchpadEvent::Move { dx, dy } if dx.unsigned_abs() <= 150 && dy.unsigned_abs() <= 150 => {
            Ok(vec![
                "mousemove".into(),
                "--relative".into(),
                dx.to_string(),
                dy.to_string(),
            ])
        }
        TouchpadEvent::Scroll { dx, dy } if dx.unsigned_abs() <= 8 && dy.unsigned_abs() <= 8 => {
            Ok(vec!["scroll".into(), dx.to_string(), dy.to_string()])
        }
        TouchpadEvent::Click { button } => {
            let number = match button.as_str() {
                "left" => "1",
                "middle" => "2",
                "right" => "3",
                _ => bail!("Unsupported touchpad button"),
            };
            Ok(vec!["click".into(), number.into()])
        }
        _ => bail!("Touchpad motion outside allowed range"),
    }
}

/// The GNOME RemoteDesktop portal mediates wdotool's pointer access.
pub async fn touchpad_event(Json(q): Json<TouchpadEvent>) -> Response {
    let result: Result<Value> = async {
        let args = touchpad_args(&q)?;
        let program = crate::apps::resolve_program("wdotool")?;
        let output = tokio::time::timeout(
            Duration::from_secs(20),
            tokio::process::Command::new(program)
                .args(["--backend", "libei"])
                .args(args)
                .kill_on_drop(true)
                .output(),
        )
        .await??;
        if !output.status.success() {
            bail!(
                "wdotool: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            );
        }
        Ok(json!({"requested":true}))
    }
    .await;
    match result {
        Ok(value) => Json(value).into_response(),
        Err(error) => crate::files::err(error),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn safe_device_ids() {
        assert!(super::valid_device("aa-bb:01").is_ok());
        assert!(super::valid_device("--execute=/bin/sh").is_err());
    }

    #[test]
    fn input_commands_are_bounded_and_whitelisted() {
        use super::{TouchpadEvent, touchpad_args};
        assert_eq!(
            touchpad_args(&TouchpadEvent::Move { dx: -10, dy: 4 }).unwrap(),
            vec!["mousemove", "--relative", "-10", "4"]
        );
        assert_eq!(
            touchpad_args(&TouchpadEvent::Click {
                button: "right".into()
            })
            .unwrap(),
            vec!["click", "3"]
        );
        assert_eq!(
            touchpad_args(&TouchpadEvent::Scroll { dx: 0, dy: -3 }).unwrap(),
            vec!["scroll", "0", "-3"]
        );
        assert!(touchpad_args(&TouchpadEvent::Move { dx: 151, dy: 0 }).is_err());
        assert!(
            touchpad_args(&TouchpadEvent::Move {
                dx: i32::MIN,
                dy: 0
            })
            .is_err()
        );
        assert!(touchpad_args(&TouchpadEvent::Scroll { dx: 0, dy: 9 }).is_err());
        assert!(
            touchpad_args(&TouchpadEvent::Click {
                button: "--execute".into()
            })
            .is_err()
        );
        assert!(
            serde_json::from_str::<TouchpadEvent>(r#"{"action":"execute","command":"sh"}"#)
                .is_err()
        );
    }
}