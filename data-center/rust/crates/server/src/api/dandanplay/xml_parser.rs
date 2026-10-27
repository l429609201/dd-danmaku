//! XML 弹幕解析器
//!
//! 解析 dandanplay XML 格式弹幕，转换为 JSON 格式存储

use serde::{Deserialize, Serialize};

/// XML 格式的弹幕响应
///
/// dandanplay XML 格式：
/// ```xml
/// <i>
///   <d p="10.5,1,25,16777215,1234567890">弹幕内容</d>
/// </i>
/// ```
#[derive(Debug)]
pub struct XmlCommentResponse {
    pub comments: Vec<XmlComment>,
}

#[derive(Debug)]
pub struct XmlComment {
    /// p 属性：时间,模式,字号,颜色,时间戳
    pub p_attr: String,
    /// 弹幕文本内容
    pub text: String,
}

/// JSON 格式的弹幕（用于存储）
#[derive(Debug, Serialize, Deserialize)]
pub struct JsonCommentResponse {
    pub count: i32,
    pub comments: Vec<JsonComment>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JsonComment {
    #[serde(rename = "cid")]
    pub id: i64,
    #[serde(rename = "p")]
    pub position: String,
    #[serde(rename = "m")]
    pub message: String,
}

/// 解析 XML 弹幕为 JSON 格式
///
/// 使用简单的手动解析（零依赖方案）
pub fn parse_xml_to_json(xml: &str) -> Result<JsonCommentResponse, XmlParseError> {
    let comments = parse_xml_comments(xml)?;
    
    let json_comments: Vec<JsonComment> = comments
        .into_iter()
        .enumerate()
        .map(|(idx, c)| JsonComment {
            id: (idx + 1) as i64,  // 简单递增 ID
            position: c.p_attr,
            message: c.text,
        })
        .collect();
    
    Ok(JsonCommentResponse {
        count: json_comments.len() as i32,
        comments: json_comments,
    })
}

/// 手动解析 XML <d> 标签
///
/// 简单但有效的解析器，适用于 dandanplay XML 格式
fn parse_xml_comments(xml: &str) -> Result<Vec<XmlComment>, XmlParseError> {
    let mut comments = Vec::new();
    let mut chars = xml.chars().peekable();
    
    while let Some(ch) = chars.next() {
        if ch == '<' {
            // 检查是否是 <d> 标签
            if chars.peek() == Some(&'d') && is_d_tag_start(&xml, chars.clone()) {
                chars.next(); // 跳过 'd'
                
                // 解析 p 属性
                let p_attr = parse_p_attribute(&mut chars)?;
                
                // 跳过到 >
                skip_until(&mut chars, '>');
                chars.next(); // 跳过 '>'
                
                // 读取文本内容
                let text = read_until(&mut chars, '<');
                
                comments.push(XmlComment {
                    p_attr,
                    text: decode_html_entities(&text),
                });
                
                // 跳过 </d>
                skip_until(&mut chars, '>');
            }
        }
    }
    
    Ok(comments)
}

/// 检查是否是 <d 开头
fn is_d_tag_start(xml: &str, mut chars: std::iter::Peekable<std::str::Chars>) -> bool {
    chars.next(); // 跳过 'd'
    matches!(chars.peek(), Some(&' ') | Some(&'>'))
}

/// 解析 p="..." 属性
fn parse_p_attribute(chars: &mut std::iter::Peekable<std::str::Chars>) -> Result<String, XmlParseError> {
    // 跳过空格
    skip_whitespace(chars);
    
    // 查找 p="
    let mut found_p = false;
    while let Some(&ch) = chars.peek() {
        if ch == 'p' {
            chars.next();
            skip_whitespace(chars);
            if chars.peek() == Some(&'=') {
                chars.next();
                skip_whitespace(chars);
                if chars.peek() == Some(&'"') {
                    chars.next();
                    found_p = true;
                    break;
                }
            }
        } else if ch == '>' {
            break;
        } else {
            chars.next();
        }
    }
    
    if !found_p {
        return Err(XmlParseError::MissingPAttribute);
    }
    
    // 读取到下一个 "
    let value = read_until(chars, '"');
    chars.next(); // 跳过结束的 "
    
    Ok(value)
}

/// 跳过空白字符
fn skip_whitespace(chars: &mut std::iter::Peekable<std::str::Chars>) {
    while let Some(&ch) = chars.peek() {
        if ch.is_whitespace() {
            chars.next();
        } else {
            break;
        }
    }
}

/// 跳过直到遇到指定字符
fn skip_until(chars: &mut std::iter::Peekable<std::str::Chars>, target: char) {
    while let Some(&ch) = chars.peek() {
        if ch == target {
            break;
        }
        chars.next();
    }
}

/// 读取直到遇到指定字符
fn read_until(chars: &mut std::iter::Peekable<std::str::Chars>, target: char) -> String {
    let mut result = String::new();
    while let Some(&ch) = chars.peek() {
        if ch == target {
            break;
        }
        result.push(ch);
        chars.next();
    }
    result
}

/// 解码 HTML 实体
fn decode_html_entities(text: &str) -> String {
    text.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

#[derive(Debug, Clone)]
pub enum XmlParseError {
    MissingPAttribute,
    InvalidFormat,
}

impl std::fmt::Display for XmlParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingPAttribute => write!(f, "Missing p attribute in <d> tag"),
            Self::InvalidFormat => write!(f, "Invalid XML format"),
        }
    }
}

impl std::error::Error for XmlParseError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_xml() {
        let xml = r#"<i>
  <d p="10.5,1,25,16777215,1234567890">测试弹幕1</d>
  <d p="20.0,1,25,16777215,1234567891">测试弹幕2</d>
</i>"#;
        
        let result = parse_xml_to_json(xml).unwrap();
        assert_eq!(result.count, 2);
        assert_eq!(result.comments.len(), 2);
        assert_eq!(result.comments[0].message, "测试弹幕1");
        assert_eq!(result.comments[0].position, "10.5,1,25,16777215,1234567890");
        assert_eq!(result.comments[1].message, "测试弹幕2");
    }

    #[test]
    fn test_parse_with_html_entities() {
        let xml = r#"<i><d p="10.5,1,25,16777215,1234567890">&lt;strong&gt;加粗&lt;/strong&gt;</d></i>"#;
        
        let result = parse_xml_to_json(xml).unwrap();
        assert_eq!(result.count, 1);
        assert_eq!(result.comments[0].message, "<strong>加粗</strong>");
    }

    #[test]
    fn test_parse_empty_xml() {
        let xml = "<i></i>";
        
        let result = parse_xml_to_json(xml).unwrap();
        assert_eq!(result.count, 0);
        assert_eq!(result.comments.len(), 0);
    }

    #[test]
    fn test_parse_malformed_xml() {
        let xml = r#"<i><d>没有 p 属性</d></i>"#;
        
        let result = parse_xml_to_json(xml);
        assert!(result.is_err());
    }
}
