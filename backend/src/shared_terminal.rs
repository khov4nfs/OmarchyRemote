//! Shared tmux sessions: attach from both an iPhone PTY and Fedora Ptyxis.
use anyhow::{Result, bail};
use serde_json::{Value, json};
use std::{
    path::Path,
    process::{Command, Stdio},
};

fn run(args: &[&str]) -> Result<String> {
    let output = Command::new(crate::apps::resolve_program("tmux")?)
        .args(args)
        .output()?;
    if !output.status.success() {
        bail!("tmux: {}", String::from_utf8_lossy(&output.stderr).trim());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}
pub fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-.".contains(&b))
}
pub fn exists(name: &str) -> bool {
    valid_name(name) && run(&["has-session", "-t", &format!("={name}")]).is_ok()
}
pub fn create(cwd: Option<&Path>) -> Result<String> {
    let name = format!("omr-{}", uuid::Uuid::new_v4().simple());
    let path = cwd.map(|p| p.to_path_buf()).unwrap_or(crate::apps::home()?);
    run(&[
        "new-session",
        "-d",
        "-s",
        &name,
        "-c",
        &path.to_string_lossy(),
    ])?;
    Ok(name)
}
pub fn remove(name: &str) {
    if name.starts_with("omr-") && valid_name(name) {
        let _ = run(&["kill-session", "-t", &format!("={name}")]);
    }
}
pub fn list() -> Result<Value> {
    if crate::apps::resolve_program("tmux").is_err() {
        return Ok(json!({"available":false,"sessions":[]}));
    }
    let raw = run(&["list-sessions", "-F", "#{session_name}"]).unwrap_or_default();
    let sessions = raw
        .lines()
        .filter(|name| valid_name(name))
        .take(100)
        .map(|name| json!({"name":name,"managed":name.starts_with("omr-")}))
        .collect::<Vec<_>>();
    Ok(json!({"available":true,"sessions":sessions}))
}
pub fn open_ptyxis(name: &str) -> Result<()> {
    if !exists(name) {
        bail!("Shared terminal not found")
    }
    let mut child = Command::new(crate::apps::resolve_program("ptyxis")?)
        .args([
            "--new-window",
            "--title",
            &format!("Omarchy {name}"),
            "--",
            "tmux",
            "attach-session",
            "-t",
            &format!("={name}"),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}
#[cfg(test)]
mod tests {
    #[test]
    fn safe_names() {
        assert!(super::valid_name("omr-abc_123"));
        assert!(!super::valid_name("foo/bar"));
        assert!(!super::valid_name("has space"));
    }
}
