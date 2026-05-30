// 星网桌面壳 · 存储后端
// 职责只有一件笨活:把整段 markdown 文本读/写/删到 ~/.starnet/personal/ 下的真实文件。
// 所有格式解析(frontmatter、id、字段顺序)仍由前端 starnet-format.js 负责,Rust 不碰格式。
//
// 目录映射(对齐数据格式宪法第二节 personal/ 分子目录):
//   id 以 pref-     开头 -> personal/preferences/<id>.md
//   id 以 habit-    开头 -> personal/habits/<id>.md
//   id 以 decision- 开头 -> personal/decisions/<id>.md
//   其他                  -> personal/misc/<id>.md
// 删除 = 移动到 personal/.trash/<id>.md(宪法第十一节:不直接删)。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::{Path, PathBuf};

// ---- 一条偏好在前后端之间传递的最小结构:id + 整段 markdown 文本 ----
#[derive(serde::Serialize, serde::Deserialize)]
struct Item {
    id: String,
    text: String,
}

// ~/.starnet/personal 根目录;没有就建。
fn personal_root() -> Result<PathBuf, String> {
    let home = dirs_home().ok_or_else(|| "找不到用户主目录".to_string())?;
    let root = home.join(".starnet").join("personal");
    fs::create_dir_all(&root).map_err(|e| format!("建目录失败: {e}"))?;
    Ok(root)
}

// 不引 dirs crate,自己读环境变量(Windows: USERPROFILE;类 Unix: HOME)。
fn dirs_home() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("USERPROFILE") {
        if !p.is_empty() {
            return Some(PathBuf::from(p));
        }
    }
    if let Ok(p) = std::env::var("HOME") {
        if !p.is_empty() {
            return Some(PathBuf::from(p));
        }
    }
    None
}

// id 前缀 -> 子目录名
fn subdir_for(id: &str) -> &'static str {
    if id.starts_with("pref-") {
        "preferences"
    } else if id.starts_with("habit-") {
        "habits"
    } else if id.starts_with("decision-") {
        "decisions"
    } else {
        "misc"
    }
}

// 给定 id,算出它该落在哪个文件路径(并确保父目录存在)
fn path_for(id: &str) -> Result<PathBuf, String> {
    if !is_safe_id(id) {
        return Err(format!("非法 id: {id}"));
    }
    let dir = personal_root()?.join(subdir_for(id));
    fs::create_dir_all(&dir).map_err(|e| format!("建子目录失败: {e}"))?;
    Ok(dir.join(format!("{id}.md")))
}

// id 安全校验:挡住路径穿越和分隔符,但允许中文等 Unicode 文字。
// 注意:slug 规则(starnet-format.js)故意保留中文,所以 id 里会出现中文,
// 不能用"只允许 ASCII"的白名单,否则中文标题永远存不进去。改用黑名单挡危险字符。
fn is_safe_id(id: &str) -> bool {
    if id.is_empty() || id.chars().count() > 200 {
        return false;
    }
    // 挡住:路径分隔符、上级目录、盘符冒号、通配/控制字符、首尾点和空白
    if id.contains('/')
        || id.contains('\\')
        || id.contains("..")
        || id.contains(':')
        || id.contains('\0')
    {
        return false;
    }
    // 不允许任何控制字符(换行、制表等)
    if id.chars().any(|c| c.is_control()) {
        return false;
    }
    // 不允许以点或空白开头/结尾(Windows 文件名陷阱)
    let first = id.chars().next().unwrap();
    let last = id.chars().last().unwrap();
    if first == '.' || last == '.' || first.is_whitespace() || last.is_whitespace() {
        return false;
    }
    true
}

// 遍历一个子目录,把里面的 .md 都读成 Item
fn read_dir_items(dir: &Path, out: &mut Vec<Item>) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }
    let entries = fs::read_dir(dir).map_err(|e| format!("读目录失败: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        let id = match path.file_stem().and_then(|s| s.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        match fs::read_to_string(&path) {
            // 宪法第十一节:坏数据不让整体崩,跳过即可(解析在前端做)
            Ok(text) => out.push(Item { id, text }),
            Err(e) => eprintln!("跳过读失败的文件 {path:?}: {e}"),
        }
    }
    Ok(())
}

// ====================================================================
// Tauri 命令:与前端 storage.js 的 Tauri 分支一一对应
// ====================================================================

// 列出全部:扫 preferences/habits/decisions/misc 四个子目录
#[tauri::command]
fn list_items() -> Result<Vec<Item>, String> {
    let root = personal_root()?;
    let mut out = Vec::new();
    for sub in ["preferences", "habits", "decisions", "misc"] {
        read_dir_items(&root.join(sub), &mut out)?;
    }
    Ok(out)
}

// 取单条;不存在返回 None
#[tauri::command]
fn get_item(id: String) -> Result<Option<String>, String> {
    let path = path_for(&id)?;
    match fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(ref e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("读文件失败: {e}")),
    }
}

// 保存:整段 markdown 文本落盘(新建或覆盖)
#[tauri::command]
fn save_item(id: String, text: String) -> Result<(), String> {
    let path = path_for(&id)?;
    fs::write(&path, text).map_err(|e| format!("写文件失败: {e}"))
}

// 删除:移到 .trash/(不直接删)
#[tauri::command]
fn remove_item(id: String) -> Result<(), String> {
    let src = path_for(&id)?;
    if !src.exists() {
        return Ok(());
    }
    let trash = personal_root()?.join(".trash");
    fs::create_dir_all(&trash).map_err(|e| format!("建 trash 失败: {e}"))?;
    let dst = trash.join(format!("{id}.md"));
    // rename 跨盘可能失败,失败就退化成 copy+delete
    if fs::rename(&src, &dst).is_err() {
        fs::copy(&src, &dst).map_err(|e| format!("移入 trash 失败: {e}"))?;
        fs::remove_file(&src).map_err(|e| format!("删原文件失败: {e}"))?;
    }
    Ok(())
}

// 让用户知道数据存哪了(界面上可显示)
#[tauri::command]
fn data_dir() -> Result<String, String> {
    Ok(personal_root()?.to_string_lossy().to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            list_items,
            get_item,
            save_item,
            remove_item,
            data_dir
        ])
        .run(tauri::generate_context!())
        .expect("启动星网失败");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subdir_maps_by_id_prefix() {
        assert_eq!(subdir_for("pref-pytest-a3f2"), "preferences");
        assert_eq!(subdir_for("habit-morning-b1c2"), "habits");
        assert_eq!(subdir_for("decision-naming-d4e5"), "decisions");
        assert_eq!(subdir_for("node-something-x9y8"), "misc");
    }

    #[test]
    fn safe_id_rejects_path_traversal() {
        // 正常 id(含中文 slug)必须放行 —— 这正是上一版的 bug
        assert!(is_safe_id("pref-pytest-a3f2"));
        assert!(is_safe_id("pref-用-pytest-写测试-a3f2"));
        assert!(is_safe_id("habit-早起-b1c2"));
        // 挡住路径穿越和危险字符
        assert!(!is_safe_id("../etc/passwd"));
        assert!(!is_safe_id("pref/../../x"));
        assert!(!is_safe_id("pref\\windows\\x"));
        assert!(!is_safe_id("C:evil"));
        assert!(!is_safe_id("pref-x\ninject"));
        assert!(!is_safe_id(".hidden"));
        assert!(!is_safe_id("trailing "));
        assert!(!is_safe_id(""));
    }
}
