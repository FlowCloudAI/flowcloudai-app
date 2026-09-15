//! 页面文档 Rust 独立校验：解析 HTML/CSS 后拒绝危险结构，并生成可持久化派生结果。
use cssparser::{Parser, ParserInput, Token};
use scraper::{ElementRef, Html, Node};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationDiagnostic {
    pub category: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DerivedLinkTarget {
    pub entry_id: Uuid,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationResult {
    pub valid: bool,
    pub diagnostics: Vec<ValidationDiagnostic>,
    pub derived_text: String,
    pub link_targets: Vec<DerivedLinkTarget>,
}

const FORBIDDEN_TAGS: &[&str] = &[
    "script", "iframe", "object", "embed", "link", "meta", "base", "form",
];

#[derive(Clone)]
enum SignificantToken {
    Ident(String),
    AtKeyword,
    Colon,
    Other,
}

#[derive(Clone, Copy, Default)]
struct CssContext {
    pseudo_rule: bool,
    quoted_strings_are_resources: bool,
    declarations: bool,
}

pub fn validate(html: &str, css: &str, project_id: Option<&str>) -> ValidationResult {
    let mut diagnostics = Vec::new();
    if html.len() > 2_000_000 || css.len() > 1_000_000 {
        diagnostics.push(d("limits", "文档大小超过限制"));
    }

    let document = Html::parse_fragment(html);
    let mut link_targets = Vec::new();
    for element in document.root_element().descendent_elements() {
        validate_element(element, project_id, &mut diagnostics, &mut link_targets);
    }
    validate_css(css, &mut diagnostics);

    ValidationResult {
        valid: diagnostics.is_empty(),
        diagnostics,
        derived_text: derive_text(&document),
        link_targets,
    }
}

fn validate_element(
    element: ElementRef<'_>,
    project_id: Option<&str>,
    diagnostics: &mut Vec<ValidationDiagnostic>,
    link_targets: &mut Vec<DerivedLinkTarget>,
) {
    let tag_name = element.value().name();
    if FORBIDDEN_TAGS
        .iter()
        .any(|forbidden| tag_name.eq_ignore_ascii_case(forbidden))
    {
        diagnostics.push(d("element", format!("禁止元素 {tag_name}")));
    }

    for (name, value) in element.value().attrs() {
        if name
            .get(..2)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("on"))
        {
            diagnostics.push(d("attribute", format!("禁止事件属性 {name}")));
        }
        if name.eq_ignore_ascii_case("href") {
            match parse_href(value, project_id) {
                Ok(Some(entry_id)) => {
                    if !link_targets
                        .iter()
                        .any(|target| target.entry_id == entry_id)
                    {
                        link_targets.push(DerivedLinkTarget {
                            entry_id,
                            title: String::new(),
                        });
                    }
                }
                Ok(None) => {}
                Err(()) => diagnostics.push(d("href", format!("不允许的 href: {value}"))),
            }
        }
        if name.eq_ignore_ascii_case("src") && !is_managed_asset_url(value) {
            diagnostics.push(d("resource", format!("不允许的资源地址: {value}")));
        }
        if name.eq_ignore_ascii_case("style") {
            validate_css_tokens(
                value,
                CssContext {
                    declarations: true,
                    ..CssContext::default()
                },
                diagnostics,
            );
        }
    }

    if tag_name.eq_ignore_ascii_case("style") {
        let embedded_css = element.text().collect::<String>();
        validate_css(&embedded_css, diagnostics);
    }
}

fn parse_href(href: &str, project_id: Option<&str>) -> Result<Option<Uuid>, ()> {
    let scheme_end = href.find(':').ok_or(())?;
    let scheme = &href[..scheme_end];
    if scheme.eq_ignore_ascii_case("http") || scheme.eq_ignore_ascii_case("https") {
        return href[scheme_end + 1..]
            .starts_with("//")
            .then_some(None)
            .ok_or(());
    }
    if scheme.eq_ignore_ascii_case("mailto") || scheme.eq_ignore_ascii_case("tel") {
        return Ok(None);
    }
    if !scheme.eq_ignore_ascii_case("fc") {
        return Err(());
    }

    let mut parts = href[scheme_end + 1..]
        .strip_prefix("//")
        .ok_or(())?
        .split('/');
    let owner = parts.next().ok_or(())?;
    if parts.next() != Some("entry") {
        return Err(());
    }
    let entry_id = Uuid::parse_str(parts.next().ok_or(())?).map_err(|_| ())?;
    if parts.next().is_some() {
        return Err(());
    }
    if owner == "self" {
        return Ok(Some(entry_id));
    }
    let current_project_id = project_id
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or(())?;
    let owner_id = Uuid::parse_str(owner).map_err(|_| ())?;
    (owner_id == current_project_id)
        .then_some(Some(entry_id))
        .ok_or(())
}

fn is_managed_asset_url(value: &str) -> bool {
    value
        .strip_prefix("fcasset://")
        .and_then(|id| Uuid::parse_str(id).ok())
        .is_some()
}

fn derive_text(document: &Html) -> String {
    let mut raw_text = String::new();
    for node in document.tree.nodes() {
        let Node::Text(text) = node.value() else {
            continue;
        };
        let excluded = node
            .ancestors()
            .filter_map(ElementRef::wrap)
            .any(|ancestor| {
                matches!(
                    ancestor.value().name().to_ascii_lowercase().as_str(),
                    "script" | "style"
                )
            });
        if !excluded {
            raw_text.push_str(text);
        }
    }
    raw_text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn validate_css(css: &str, diagnostics: &mut Vec<ValidationDiagnostic>) {
    validate_css_tokens(css, CssContext::default(), diagnostics);
}

fn validate_css_tokens(
    css: &str,
    context: CssContext,
    diagnostics: &mut Vec<ValidationDiagnostic>,
) {
    let mut input = ParserInput::new(css);
    let mut parser = Parser::new(&mut input);
    scan_css_tokens(&mut parser, context, diagnostics);
}

fn scan_css_tokens(
    parser: &mut Parser<'_, '_>,
    context: CssContext,
    diagnostics: &mut Vec<ValidationDiagnostic>,
) {
    let mut significant = Vec::<SignificantToken>::new();
    let mut statement = Vec::<SignificantToken>::new();
    let mut pending_bang = false;

    while !parser.is_exhausted() {
        let token = match parser.next_including_whitespace_and_comments() {
            Ok(token) => token.clone(),
            Err(_) => {
                diagnostics.push(d("css", "CSS 语法无法解析"));
                break;
            }
        };

        match token {
            Token::WhiteSpace(_) | Token::Comment(_) => continue,
            Token::AtKeyword(name) => {
                if name.eq_ignore_ascii_case("import") {
                    diagnostics.push(d("css", "禁止 @import"));
                }
                if name.eq_ignore_ascii_case("keyframes")
                    || name.eq_ignore_ascii_case("-webkit-keyframes")
                {
                    diagnostics.push(d("css", "禁止 @keyframes"));
                }
                pending_bang = false;
                push_significant(
                    &mut significant,
                    &mut statement,
                    SignificantToken::AtKeyword,
                );
            }
            Token::Delim('!') => {
                pending_bang = true;
                push_significant(&mut significant, &mut statement, SignificantToken::Other);
            }
            Token::Ident(name) => {
                if pending_bang && name.eq_ignore_ascii_case("important") {
                    diagnostics.push(d("css", "禁止 !important"));
                }
                if context.declarations
                    && name.eq_ignore_ascii_case("fixed")
                    && previous_property_is(&significant, "position")
                {
                    diagnostics.push(d("css", "禁止 position: fixed"));
                }
                pending_bang = false;
                push_significant(
                    &mut significant,
                    &mut statement,
                    SignificantToken::Ident(name.to_string()),
                );
            }
            Token::Colon => {
                if context.pseudo_rule
                    && context.declarations
                    && matches!(
                        significant.last(),
                        Some(SignificantToken::Ident(name)) if name.eq_ignore_ascii_case("content")
                    )
                {
                    diagnostics.push(d("css", "禁止伪元素 content 注入"));
                }
                pending_bang = false;
                push_significant(&mut significant, &mut statement, SignificantToken::Colon);
            }
            Token::Semicolon => {
                pending_bang = false;
                significant.clear();
                statement.clear();
            }
            Token::UnquotedUrl(value) => {
                if !is_managed_asset_url(&value) {
                    diagnostics.push(d("css", format!("不允许的 CSS 资源地址: {value}")));
                }
                pending_bang = false;
                push_significant(&mut significant, &mut statement, SignificantToken::Other);
            }
            Token::QuotedString(value) => {
                if context.quoted_strings_are_resources && !is_managed_asset_url(&value) {
                    diagnostics.push(d("css", format!("不允许的 CSS 资源地址: {value}")));
                }
                pending_bang = false;
                push_significant(&mut significant, &mut statement, SignificantToken::Other);
            }
            Token::Function(name) => {
                let is_url = name.eq_ignore_ascii_case("url");
                let nested_context = CssContext {
                    declarations: false,
                    pseudo_rule: context.pseudo_rule,
                    quoted_strings_are_resources: is_url
                        || name.eq_ignore_ascii_case("image-set")
                        || name.eq_ignore_ascii_case("-webkit-image-set"),
                };
                let result: Result<(), cssparser::ParseError<'_, ()>> =
                    parser.parse_nested_block(|nested| {
                        scan_css_tokens(nested, nested_context, diagnostics);
                        Ok(())
                    });
                if result.is_err() {
                    diagnostics.push(d("css", "CSS 函数语法无法解析"));
                }
                pending_bang = false;
                push_significant(&mut significant, &mut statement, SignificantToken::Other);
            }
            Token::ParenthesisBlock | Token::SquareBracketBlock => {
                let result: Result<(), cssparser::ParseError<'_, ()>> =
                    parser.parse_nested_block(|nested| {
                        scan_css_tokens(
                            nested,
                            CssContext {
                                declarations: false,
                                ..context
                            },
                            diagnostics,
                        );
                        Ok(())
                    });
                if result.is_err() {
                    diagnostics.push(d("css", "CSS 块语法无法解析"));
                }
                pending_bang = false;
                push_significant(&mut significant, &mut statement, SignificantToken::Other);
            }
            Token::CurlyBracketBlock => {
                let is_at_rule = matches!(statement.first(), Some(SignificantToken::AtKeyword));
                let pseudo_rule = if is_at_rule {
                    context.pseudo_rule
                } else {
                    context.pseudo_rule || has_pseudo_element(&statement)
                };
                let result: Result<(), cssparser::ParseError<'_, ()>> =
                    parser.parse_nested_block(|nested| {
                        scan_css_tokens(
                            nested,
                            CssContext {
                                pseudo_rule,
                                declarations: true,
                                quoted_strings_are_resources: false,
                            },
                            diagnostics,
                        );
                        Ok(())
                    });
                if result.is_err() {
                    diagnostics.push(d("css", "CSS 规则块语法无法解析"));
                }
                pending_bang = false;
                significant.clear();
                statement.clear();
            }
            Token::BadUrl(value) => {
                diagnostics.push(d("css", format!("CSS url() 无法解析: {value}")));
                pending_bang = false;
            }
            Token::BadString(value) => {
                diagnostics.push(d("css", format!("CSS 字符串无法解析: {value}")));
                pending_bang = false;
            }
            _ => {
                pending_bang = false;
                push_significant(&mut significant, &mut statement, SignificantToken::Other);
            }
        }
    }
}

fn push_significant(
    significant: &mut Vec<SignificantToken>,
    statement: &mut Vec<SignificantToken>,
    token: SignificantToken,
) {
    significant.push(token.clone());
    if significant.len() > 2 {
        significant.remove(0);
    }
    statement.push(token);
}

fn previous_property_is(significant: &[SignificantToken], property: &str) -> bool {
    matches!(
        significant,
        [SignificantToken::Ident(name), SignificantToken::Colon]
            if name.eq_ignore_ascii_case(property)
    )
}

fn has_pseudo_element(statement: &[SignificantToken]) -> bool {
    statement.windows(3).any(|tokens| {
        matches!(
            tokens,
            [
                SignificantToken::Colon,
                SignificantToken::Colon,
                SignificantToken::Ident(_)
            ]
        )
    })
}

fn d(category: &str, message: impl Into<String>) -> ValidationDiagnostic {
    ValidationDiagnostic {
        category: category.into(),
        message: message.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROJECT_ID: &str = "88888888-8888-4888-8888-888888888888";
    const ENTRY_ID: &str = "11111111-1111-4111-8111-111111111111";
    const ASSET_ID: &str = "22222222-2222-4222-8222-222222222222";

    #[test]
    fn derives_utf8_text_entities_and_internal_links_from_dom() {
        let result = validate(
            &format!("<p>中文&amp;English <a href=\"fc://self/entry/{ENTRY_ID}\">链接</a></p>"),
            "",
            Some(PROJECT_ID),
        );
        assert!(result.valid, "{:?}", result.diagnostics);
        assert_eq!(result.derived_text, "中文&English 链接");
        assert_eq!(result.link_targets.len(), 1);
        assert_eq!(result.link_targets[0].entry_id.to_string(), ENTRY_ID);
    }

    #[test]
    fn accepts_managed_css_url_and_rejects_fixed_without_whitespace() {
        let accepted = validate(
            "<p>正文</p>",
            &format!(".cover {{ background: url(fcasset://{ASSET_ID}); }}"),
            Some(PROJECT_ID),
        );
        assert!(accepted.valid, "{:?}", accepted.diagnostics);

        let rejected = validate("<p>正文</p>", ".overlay{position:fixed}", Some(PROJECT_ID));
        assert!(!rejected.valid);
    }

    #[test]
    fn rejects_slash_separated_event_attribute() {
        let result = validate("<img/onerror=x>", "", Some(PROJECT_ID));
        assert!(!result.valid);
        assert!(
            result
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.category == "attribute")
        );
    }

    #[test]
    fn ordinary_words_containing_on_are_not_event_attributes() {
        let result = validate(
            "<p>online connection 中文正文 <a href=\"https://example.invalid\">合法链接</a></p>",
            "",
            Some(PROJECT_ID),
        );
        assert!(result.valid, "{:?}", result.diagnostics);
    }
}
