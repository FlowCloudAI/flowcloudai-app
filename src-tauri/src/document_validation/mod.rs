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
    pub entry_id: Option<Uuid>,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationResult {
    pub valid: bool,
    pub diagnostics: Vec<ValidationDiagnostic>,
    pub derived_text: String,
    pub link_targets: Vec<DerivedLinkTarget>,
    pub asset_ids: Vec<Uuid>,
}

const FORBIDDEN_TAGS: &[&str] = &[
    "script", "style", "iframe", "object", "embed", "form", "input", "textarea", "select",
    "button", "base", "link", "meta",
];
const FORBIDDEN_ATTRIBUTES: &[&str] = &["ping", "action", "formaction", "background"];
const FORBIDDEN_ATTRIBUTE_PREFIXES: &[&str] = &["on"];
const MANAGED_RESOURCE_ATTRIBUTES: &[&str] = &["src", "srcset", "poster"];
const NON_LINK_MANAGED_RESOURCE_ATTRIBUTES: &[&str] = &["href", "xlink:href"];
const LINK_ELEMENTS: &[&str] = &["a", "area"];

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
    let mut asset_ids = Vec::new();
    for element in document.root_element().descendent_elements() {
        validate_element(
            element,
            project_id,
            &mut diagnostics,
            &mut link_targets,
            &mut asset_ids,
        );
    }
    validate_css(css, &mut diagnostics, &mut asset_ids);

    ValidationResult {
        valid: diagnostics.is_empty(),
        diagnostics,
        derived_text: derive_text(&document),
        link_targets,
        asset_ids,
    }
}

fn validate_element(
    element: ElementRef<'_>,
    project_id: Option<&str>,
    diagnostics: &mut Vec<ValidationDiagnostic>,
    link_targets: &mut Vec<DerivedLinkTarget>,
    asset_ids: &mut Vec<Uuid>,
) {
    let tag_name = element.value().name();
    if FORBIDDEN_TAGS
        .iter()
        .any(|forbidden| tag_name.eq_ignore_ascii_case(forbidden))
    {
        diagnostics.push(d("element", format!("禁止元素 {tag_name}")));
    }
    if tag_name.eq_ignore_ascii_case("img") {
        if let Some(declared) = element.value().attr("data-fc-asset-id") {
            let source = element.value().attr("src").and_then(managed_asset_id);
            if parse_document_uuid(declared).ok() != source {
                diagnostics.push(d(
                    "resource",
                    "img 的 data-fc-asset-id 必须与 src UUID 一致",
                ));
            }
        }
    }

    for (qualified_name, value) in &element.value().attrs {
        let name = qualified_name.local.as_ref();
        let prefix = qualified_name.prefix.as_ref().map(AsRef::as_ref);
        let display_name =
            prefix.map_or_else(|| name.to_string(), |prefix| format!("{prefix}:{name}"));
        if FORBIDDEN_ATTRIBUTE_PREFIXES.iter().any(|forbidden| {
            name.get(..forbidden.len())
                .is_some_and(|prefix| prefix.eq_ignore_ascii_case(forbidden))
        }) {
            diagnostics.push(d("attribute", format!("禁止事件属性 {display_name}")));
            continue;
        }
        if FORBIDDEN_ATTRIBUTES
            .iter()
            .any(|forbidden| display_name.eq_ignore_ascii_case(forbidden))
        {
            diagnostics.push(d("attribute", format!("禁止属性 {display_name}")));
            continue;
        }
        let unqualified_href = prefix.is_none() && name.eq_ignore_ascii_case("href");
        let xlink_href = (prefix.is_some_and(|prefix| prefix.eq_ignore_ascii_case("xlink"))
            && name.eq_ignore_ascii_case("href"))
            || name.eq_ignore_ascii_case("xlink:href");
        let is_link_element = LINK_ELEMENTS
            .iter()
            .any(|link| tag_name.eq_ignore_ascii_case(link));
        let non_link_managed_resource = NON_LINK_MANAGED_RESOURCE_ATTRIBUTES
            .iter()
            .any(|attribute| display_name.eq_ignore_ascii_case(attribute));
        let managed_resource_attribute = MANAGED_RESOURCE_ATTRIBUTES
            .iter()
            .find(|attribute| name.eq_ignore_ascii_case(attribute))
            .copied();
        if unqualified_href && is_link_element {
            match parse_href(value, project_id) {
                Ok(Some(target)) => {
                    if !link_targets.contains(&target) {
                        link_targets.push(target);
                    }
                }
                Ok(None) => {}
                Err(()) => diagnostics.push(d("href", format!("不允许的 href: {value}"))),
            }
        }
        if non_link_managed_resource && !is_link_element {
            validate_managed_resource(value, &display_name, diagnostics, asset_ids);
        }
        if xlink_href && is_link_element {
            diagnostics.push(d(
                "attribute",
                format!("链接元素不允许资源属性 {display_name}"),
            ));
        }
        match managed_resource_attribute {
            Some("src") => validate_managed_resource(value, &display_name, diagnostics, asset_ids),
            Some("poster") => {
                validate_managed_resource(value, &display_name, diagnostics, asset_ids)
            }
            Some("srcset") => validate_srcset(value, diagnostics, asset_ids),
            _ => {}
        }
        if name.eq_ignore_ascii_case("style") {
            validate_css_tokens(
                value,
                CssContext {
                    declarations: true,
                    ..CssContext::default()
                },
                diagnostics,
                asset_ids,
            );
        }
    }

    if tag_name.eq_ignore_ascii_case("style") {
        let embedded_css = element.text().collect::<String>();
        validate_css(&embedded_css, diagnostics, asset_ids);
    }
}

fn parse_href(href: &str, project_id: Option<&str>) -> Result<Option<DerivedLinkTarget>, ()> {
    if href.is_empty()
        || href
            .chars()
            .any(|character| character <= '\u{20}' || character == '\u{7f}')
        || has_invalid_percent_encoding(href)
    {
        return Err(());
    }
    if let Some(anchor) = href.strip_prefix('#') {
        return (!anchor.is_empty()).then_some(None).ok_or(());
    }

    let scheme_end = href.find(':').ok_or(())?;
    let scheme = &href[..scheme_end];
    if !is_valid_scheme(scheme) {
        return Err(());
    }
    if scheme.eq_ignore_ascii_case("http") || scheme.eq_ignore_ascii_case("https") {
        return valid_absolute_url(href, scheme).then_some(None).ok_or(());
    }
    if scheme.eq_ignore_ascii_case("mailto") || scheme.eq_ignore_ascii_case("tel") {
        return (href.len() > scheme.len() + 1).then_some(None).ok_or(());
    }
    if scheme.eq_ignore_ascii_case("fc") {
        return parse_fc_entry_href(&href[scheme_end + 1..]).map(Some);
    }
    if scheme.eq_ignore_ascii_case("entry") {
        return parse_legacy_entry_href(&href[scheme_end + 1..], project_id);
    }
    if scheme.eq_ignore_ascii_case("entry-title") {
        return parse_entry_title_href(&href[scheme_end + 1..]).map(Some);
    }
    Err(())
}

fn has_invalid_percent_encoding(value: &str) -> bool {
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%'
            && (index + 2 >= bytes.len()
                || !bytes[index + 1].is_ascii_hexdigit()
                || !bytes[index + 2].is_ascii_hexdigit())
        {
            return true;
        }
        index += 1;
    }
    false
}

fn is_valid_scheme(value: &str) -> bool {
    let mut bytes = value.bytes();
    bytes.next().is_some_and(|byte| byte.is_ascii_alphabetic())
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'.' | b'-'))
}

fn valid_absolute_url(href: &str, scheme: &str) -> bool {
    let remainder = &href[scheme.len() + 1..];
    let Some(authority_and_path) = remainder.strip_prefix("//") else {
        return false;
    };
    let authority_end = authority_and_path
        .find(['/', '?', '#'])
        .unwrap_or(authority_and_path.len());
    let authority = &authority_and_path[..authority_end];
    let host_and_port = authority
        .rsplit_once('@')
        .map_or(authority, |(_, host)| host);
    if host_and_port.is_empty() {
        return false;
    }

    if let Some(ipv6) = host_and_port.strip_prefix('[') {
        let Some(closing_bracket) = ipv6.find(']') else {
            return false;
        };
        if closing_bracket == 0 {
            return false;
        }
        let port = &ipv6[closing_bracket + 1..];
        return port.is_empty()
            || port.strip_prefix(':').is_some_and(|value| {
                !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit())
            });
    }

    let (hostname, port) = host_and_port
        .rsplit_once(':')
        .map_or((host_and_port, None), |(host, port)| (host, Some(port)));
    !hostname.is_empty()
        && !hostname
            .chars()
            .any(|character| matches!(character, '\\' | ':' | '@' | '[' | ']'))
        && port.is_none_or(|value| {
            !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit())
        })
}

fn parse_fc_entry_href(remainder: &str) -> Result<DerivedLinkTarget, ()> {
    let parts = remainder
        .strip_prefix("//")
        .ok_or(())?
        .split('/')
        .collect::<Vec<_>>();
    if parts.len() != 3
        || !parts[0].eq_ignore_ascii_case("self")
        || !parts[1].eq_ignore_ascii_case("entry")
    {
        return Err(());
    }
    Ok(id_target(parse_document_uuid(parts[2])?))
}

fn parse_legacy_entry_href(
    remainder: &str,
    project_id: Option<&str>,
) -> Result<Option<DerivedLinkTarget>, ()> {
    let parts = remainder
        .strip_prefix("//")
        .ok_or(())?
        .split('/')
        .collect::<Vec<_>>();
    match parts.as_slice() {
        [entry] => Ok(Some(id_target(parse_document_uuid(entry)?))),
        [project, entry] => {
            let owner_id = parse_document_uuid(project)?;
            let entry_id = parse_document_uuid(entry)?;
            let current_project_id = project_id.and_then(|value| Uuid::parse_str(value).ok());
            Ok((Some(owner_id) == current_project_id).then_some(id_target(entry_id)))
        }
        _ => Err(()),
    }
}

fn parse_entry_title_href(remainder: &str) -> Result<DerivedLinkTarget, ()> {
    let encoded_title = remainder.strip_prefix("//").ok_or(())?;
    if encoded_title.is_empty()
        || encoded_title
            .chars()
            .any(|character| matches!(character, '/' | '?' | '#'))
    {
        return Err(());
    }
    let title = urlencoding::decode(encoded_title)
        .map_err(|_| ())?
        .into_owned();
    if title.trim().is_empty()
        || title
            .chars()
            .any(|character| character <= '\u{1f}' || character == '\u{7f}')
    {
        return Err(());
    }
    Ok(DerivedLinkTarget {
        entry_id: None,
        title,
    })
}

fn id_target(entry_id: Uuid) -> DerivedLinkTarget {
    DerivedLinkTarget {
        entry_id: Some(entry_id),
        title: String::new(),
    }
}

fn parse_document_uuid(value: &str) -> Result<Uuid, ()> {
    let bytes = value.as_bytes();
    if bytes.len() != 36
        || bytes.iter().enumerate().any(|(index, byte)| match index {
            8 | 13 | 18 | 23 => *byte != b'-',
            _ => !byte.is_ascii_hexdigit(),
        })
        || !matches!(bytes[14], b'1'..=b'8')
        || !matches!(bytes[19].to_ascii_lowercase(), b'8' | b'9' | b'a' | b'b')
    {
        return Err(());
    }
    let id = Uuid::parse_str(value).map_err(|_| ())?;
    (!id.is_nil()).then_some(id).ok_or(())
}

fn managed_asset_id(value: &str) -> Option<Uuid> {
    let Some((scheme, id)) = value.split_once("://") else {
        return None;
    };
    scheme
        .eq_ignore_ascii_case("fcasset")
        .then(|| parse_document_uuid(id).ok())
        .flatten()
}

fn validate_managed_resource(
    value: &str,
    attribute: &str,
    diagnostics: &mut Vec<ValidationDiagnostic>,
    asset_ids: &mut Vec<Uuid>,
) {
    if let Some(id) = managed_asset_id(value) {
        if !asset_ids.contains(&id) {
            asset_ids.push(id);
        }
    } else {
        diagnostics.push(d(
            "resource",
            format!("{attribute} 只允许 fcasset://<uuid>: {value}"),
        ));
    }
}

fn validate_srcset(
    value: &str,
    diagnostics: &mut Vec<ValidationDiagnostic>,
    asset_ids: &mut Vec<Uuid>,
) {
    let mut candidate_count = 0;
    for candidate in value.split(',') {
        let Some(url) = candidate.split_whitespace().next() else {
            diagnostics.push(d("resource", "srcset 包含空候选地址"));
            continue;
        };
        candidate_count += 1;
        validate_managed_resource(url, "srcset", diagnostics, asset_ids);
    }
    if candidate_count == 0 {
        diagnostics.push(d("resource", "srcset 必须包含候选地址"));
    }
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

fn validate_css(css: &str, diagnostics: &mut Vec<ValidationDiagnostic>, asset_ids: &mut Vec<Uuid>) {
    validate_css_tokens(css, CssContext::default(), diagnostics, asset_ids);
}

fn validate_css_tokens(
    css: &str,
    context: CssContext,
    diagnostics: &mut Vec<ValidationDiagnostic>,
    asset_ids: &mut Vec<Uuid>,
) {
    let mut input = ParserInput::new(css);
    let mut parser = Parser::new(&mut input);
    scan_css_tokens(&mut parser, context, diagnostics, asset_ids);
}

fn scan_css_tokens(
    parser: &mut Parser<'_, '_>,
    context: CssContext,
    diagnostics: &mut Vec<ValidationDiagnostic>,
    asset_ids: &mut Vec<Uuid>,
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
                validate_managed_resource(&value, "CSS url()", diagnostics, asset_ids);
                pending_bang = false;
                push_significant(&mut significant, &mut statement, SignificantToken::Other);
            }
            Token::QuotedString(value) => {
                if context.quoted_strings_are_resources {
                    validate_managed_resource(&value, "CSS 资源", diagnostics, asset_ids);
                }
                pending_bang = false;
                push_significant(&mut significant, &mut statement, SignificantToken::Other);
            }
            Token::Function(name) => {
                let is_url = name.eq_ignore_ascii_case("url");
                if is_url {
                    let parsed_url: Result<String, cssparser::ParseError<'_, ()>> = parser
                        .parse_nested_block(|nested| {
                            let value = nested
                                .expect_string_cloned()
                                .map_err(cssparser::ParseError::<()>::from)?;
                            nested
                                .expect_exhausted()
                                .map_err(cssparser::ParseError::<()>::from)?;
                            Ok(value.to_string())
                        });
                    match parsed_url {
                        Ok(value) if managed_asset_id(&value).is_some() => {
                            validate_managed_resource(&value, "CSS url()", diagnostics, asset_ids);
                        }
                        Ok(value) => {
                            diagnostics.push(d("css", format!("不允许的 CSS 资源地址: {value}")))
                        }
                        Err(_) => {
                            diagnostics.push(d("css", "CSS url() 必须直接包含 fcasset://<uuid>"))
                        }
                    }
                    pending_bang = false;
                    push_significant(&mut significant, &mut statement, SignificantToken::Other);
                    continue;
                }
                let nested_context = CssContext {
                    declarations: false,
                    pseudo_rule: context.pseudo_rule,
                    quoted_strings_are_resources: name.eq_ignore_ascii_case("image-set")
                        || name.eq_ignore_ascii_case("-webkit-image-set"),
                };
                let result: Result<(), cssparser::ParseError<'_, ()>> =
                    parser.parse_nested_block(|nested| {
                        scan_css_tokens(nested, nested_context, diagnostics, asset_ids);
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
                            asset_ids,
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
                            asset_ids,
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
    }) || statement.windows(2).any(|tokens| {
        matches!(
            tokens,
            [SignificantToken::Colon, SignificantToken::Ident(name)]
                if matches!(
                    name.to_ascii_lowercase().as_str(),
                    "before" | "after" | "first-letter" | "first-line"
                )
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

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct HtmlPolicyFixture {
        forbidden_tags: Vec<String>,
        forbidden_attributes: Vec<String>,
        forbidden_attribute_prefixes: Vec<String>,
        managed_resource_attributes: ManagedResourceAttributesFixture,
    }

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ManagedResourceAttributesFixture {
        all_elements: Vec<String>,
        non_link_elements: Vec<String>,
        link_elements: Vec<String>,
    }

    fn string_refs(items: &[String]) -> Vec<&str> {
        items.iter().map(String::as_str).collect()
    }

    #[test]
    fn shared_html_policy_matches_rust_validator_constants() {
        let fixture: HtmlPolicyFixture = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../tests/fixtures/page-document/v1/html-policy.json"
        )))
        .unwrap();
        assert_eq!(string_refs(&fixture.forbidden_tags), FORBIDDEN_TAGS);
        assert_eq!(
            string_refs(&fixture.forbidden_attributes),
            FORBIDDEN_ATTRIBUTES
        );
        assert_eq!(
            string_refs(&fixture.forbidden_attribute_prefixes),
            FORBIDDEN_ATTRIBUTE_PREFIXES
        );
        assert_eq!(
            string_refs(&fixture.managed_resource_attributes.all_elements),
            MANAGED_RESOURCE_ATTRIBUTES
        );
        assert_eq!(
            string_refs(&fixture.managed_resource_attributes.non_link_elements),
            NON_LINK_MANAGED_RESOURCE_ATTRIBUTES
        );
        assert_eq!(
            string_refs(&fixture.managed_resource_attributes.link_elements),
            LINK_ELEMENTS
        );
    }

    #[test]
    fn derives_utf8_text_entities_and_internal_links_from_dom() {
        let result = validate(
            &format!(
                "<p>中文&amp;English <a href=\"fc://self/entry/{ENTRY_ID}\">链接</a> <a href=\"entry://{ENTRY_ID}\">旧链接</a> <a href=\"entry://{PROJECT_ID}/{ENTRY_ID}\">项目链接</a> <a href=\"entry://22222222-2222-4222-8222-222222222222/{ENTRY_ID}\">跨项目链接</a> <a href=\"entry-title://%E5%BE%85%E5%BB%BA%E8%AF%8D%E6%9D%A1\">标题链接</a></p>"
            ),
            "",
            Some(PROJECT_ID),
        );
        assert!(result.valid, "{:?}", result.diagnostics);
        assert_eq!(
            result.derived_text,
            "中文&English 链接 旧链接 项目链接 跨项目链接 标题链接"
        );
        assert_eq!(
            result.link_targets,
            vec![
                id_target(Uuid::parse_str(ENTRY_ID).unwrap()),
                DerivedLinkTarget {
                    entry_id: None,
                    title: "待建词条".into(),
                },
            ]
        );
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

        let dynamic_url = validate(
            "<p>正文</p>",
            ".cover { --asset: 'fcasset://22222222-2222-4222-8222-222222222222'; background: url(var(--asset)); }",
            Some(PROJECT_ID),
        );
        assert!(!dynamic_url.valid);

        let legacy_pseudo = validate(
            "<p>正文</p>",
            ".notice:before { content: '伪造提示'; }",
            Some(PROJECT_ID),
        );
        assert!(!legacy_pseudo.valid);
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
