//! 页面文档 Rust 独立校验：在进入 SQLite 保存和隔离画布前拒绝危险 HTML/CSS。
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationDiagnostic {
    pub category: String,
    pub message: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationResult {
    pub valid: bool,
    pub diagnostics: Vec<ValidationDiagnostic>,
}

const FORBIDDEN_TAGS: &[&str] = &[
    "script", "iframe", "object", "embed", "link", "meta", "base", "form",
];
pub fn validate(html: &str, css: &str, project_id: Option<&str>) -> ValidationResult {
    let mut ds = Vec::new();
    if html.len() > 2_000_000 || css.len() > 1_000_000 {
        ds.push(d("limits", "文档大小超过限制"));
    }
    let lower = html.to_ascii_lowercase();
    for tag in FORBIDDEN_TAGS {
        if lower.contains(&format!("<{tag}")) {
            ds.push(d("element", format!("禁止元素 {tag}")));
        }
    }
    let mut rest = lower.as_str();
    while let Some(i) = rest.find(" on") {
        let tail = &rest[i + 3..];
        if tail.starts_with(|c: char| c.is_ascii_alphabetic()) && tail.find('=').is_some() {
            ds.push(d("attribute", "禁止 on* 事件属性"));
            break;
        }
        rest = tail;
    }
    for href in extract_attr(html, "href") {
        if !allowed_href(&href, project_id) {
            ds.push(d("href", format!("不允许的 href: {href}")));
        }
    }
    for src in extract_attr(html, "src") {
        if !src.starts_with("fcasset://")
            || Uuid::parse_str(src.trim_start_matches("fcasset://")).is_err()
        {
            ds.push(d("resource", format!("不允许的资源地址: {src}")));
        }
    }
    let cl = css.to_ascii_lowercase();
    for (needle, msg) in [
        ("@import", "禁止 @import"),
        ("!important", "禁止 !important"),
        ("url(", "CSS url() 仅允许受管资源"),
        ("position: fixed", "禁止全屏 fixed 覆盖"),
        ("content:", "禁止伪元素 content 注入"),
    ] {
        if cl.contains(needle) {
            ds.push(d("css", msg));
        }
    }
    ValidationResult {
        valid: ds.is_empty(),
        diagnostics: ds,
    }
}
fn d(category: &str, message: impl Into<String>) -> ValidationDiagnostic {
    ValidationDiagnostic {
        category: category.into(),
        message: message.into(),
    }
}
fn extract_attr(input: &str, name: &str) -> Vec<String> {
    let mut out = Vec::new();
    let l = input.to_ascii_lowercase();
    let mut pos = 0;
    while let Some(i) = l[pos..].find(name) {
        let s = pos + i + name.len();
        let b = l.as_bytes().get(s).copied();
        if b == Some(b'=') || b == Some(b' ') {
            if let Some(eq) = l[s..].find('=') {
                let start = s + eq + 1;
                let q = l.as_bytes().get(start).copied();
                let (a, end) = if q == Some(b'"') || q == Some(b'\'') {
                    let q = q.unwrap() as char;
                    let a = start + 1;
                    (a, l[a..].find(q).map(|x| a + x).unwrap_or(l.len()))
                } else {
                    (
                        start,
                        l[start..]
                            .find(char::is_whitespace)
                            .map(|x| start + x)
                            .unwrap_or(l.len()),
                    )
                };
                out.push(input[a..end].to_string());
                pos = end;
                continue;
            }
        }
        pos = s;
    }
    out
}
fn allowed_href(h: &str, project: Option<&str>) -> bool {
    if ["http://", "https://", "mailto:", "tel:", "fc://self/entry/"]
        .iter()
        .any(|p| h.starts_with(p))
    {
        return true;
    }
    if let Some(p) = project {
        return h.starts_with(&format!("fc://{p}/entry/"));
    }
    false
}
