//! 页面文档生产校验契约：复用前端 fixture，防止 Rust 安全边界与样例漂移。
use app_lib::document_validation::{ValidationResult, validate};
use serde::Deserialize;
use std::path::{Path, PathBuf};

const PROJECT_ID: &str = "88888888-8888-4888-8888-888888888888";
const ENTRY_ID: &str = "11111111-1111-4111-8111-111111111111";
const ASSET_ID: &str = "22222222-2222-4222-8222-222222222222";

#[derive(Deserialize)]
struct MaliciousFixture {
    cases: Vec<MaliciousCase>,
}

#[derive(Deserialize)]
struct MaliciousCase {
    id: String,
    file: String,
    replace: Replacement,
}

#[derive(Deserialize)]
struct Replacement {
    needle: String,
    value: String,
}

fn fixture_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("tests")
        .join("fixtures")
        .join("page-document")
        .join("v1")
}

fn read_fixture(relative: &str) -> String {
    std::fs::read_to_string(fixture_root().join(relative)).unwrap()
}

fn validate_entry(html: &str, css: &str) -> ValidationResult {
    validate(html, css, Some(PROJECT_ID))
}

#[test]
fn shared_legal_entry_fixture_is_accepted() {
    let result = validate_entry(
        &read_fixture("entry/article.html"),
        &read_fixture("entry/style.css"),
    );
    assert!(result.valid, "合法样例被拒绝：{:?}", result.diagnostics);
}

#[test]
fn every_shared_malicious_case_is_rejected() {
    let fixture: MaliciousFixture =
        serde_json::from_str(&read_fixture("malicious-cases.json")).unwrap();
    let base_html = read_fixture("entry/article.html");
    let base_css = read_fixture("entry/style.css");

    for case in fixture.cases {
        let source = read_fixture(&case.file);
        assert!(
            source.contains(&case.replace.needle),
            "恶意样例 {} 的替换锚点不存在",
            case.id
        );
        let mutated = source.replacen(&case.replace.needle, &case.replace.value, 1);
        let result = if case.file.ends_with(".css") {
            validate_entry(&base_html, &mutated)
        } else {
            validate_entry(&mutated, &base_css)
        };
        assert!(!result.valid, "恶意样例 {} 未被拒绝", case.id);
    }
}

#[test]
fn slash_separated_event_attribute_is_rejected() {
    assert!(!validate_entry("<img/onerror=x>", "").valid);
}

#[test]
fn ordinary_on_words_and_allowed_links_are_accepted() {
    let result = validate_entry(
        &format!(
            "<p>online connection 中文正文 <a href=\"fc://self/entry/{ENTRY_ID}\">词条</a> <a href=\"https://example.invalid\">参考</a></p>"
        ),
        "",
    );
    assert!(result.valid, "{:?}", result.diagnostics);
}

#[test]
fn managed_css_url_is_accepted() {
    let result = validate_entry(
        "<p>正文</p>",
        &format!(".cover {{ background-image: url(fcasset://{ASSET_ID}); }}"),
    );
    assert!(result.valid, "{:?}", result.diagnostics);
}

#[test]
fn fixed_position_without_whitespace_is_rejected() {
    assert!(!validate_entry("<p>正文</p>", ".overlay{position:fixed}").valid);
}

#[test]
fn chinese_derived_text_preserves_characters_and_entities() {
    let result = validate_entry("<p>雾海&#x4E2D;文&amp;潮声</p>", "");
    assert!(result.valid, "{:?}", result.diagnostics);
    assert_eq!(result.derived_text, "雾海中文&潮声");
}
