use serde::Serialize;
use std::io;
use std::path::{Path, PathBuf};
use std::{fs, os::windows::fs::MetadataExt};

/// 同步操作结果
#[derive(Debug, Clone, Serialize)]
pub struct SyncResult {
    pub success: bool,
    pub mode_used: String,
    pub error: Option<String>,
}

// ---- public API ----

/// 启用 link：junction → copy 级联
pub fn enable_link(source: &Path, target: &Path) -> SyncResult {
    if target.exists() {
        // 幂等：已是 junction 且指向相同源
        if let Ok(resolved) = read_link_target(target) {
            if paths_equal(&resolved, source) {
                return SyncResult {
                    success: true,
                    mode_used: "junction".into(),
                    error: None,
                };
            }
        }
        return SyncResult {
            success: false,
            mode_used: "none".into(),
            error: Some(format!("目标已存在且非指向源的链接: {}", target.display())),
        };
    }

    // 确保父目录存在
    if let Some(parent) = target.parent() {
        let _ = fs::create_dir_all(parent);
    }

    // 尝试 junction
    match junction::create(source, target) {
        Ok(()) => SyncResult {
            success: true,
            mode_used: "junction".into(),
            error: None,
        },
        Err(e) => {
            // fallback: copy
            match copy_dir_recursive(source, target) {
                Ok(()) => SyncResult {
                    success: true,
                    mode_used: "copy".into(),
                    error: None,
                },
                Err(e2) => SyncResult {
                    success: false,
                    mode_used: "none".into(),
                    error: Some(format!("junction 失败: {}, copy 也失败: {}", e, e2)),
                },
            }
        }
    }
}

/// 禁用 link：仅删除 reparse point，真实目录拒删
pub fn disable_link(target: &Path) -> SyncResult {
    if !target.exists() {
        return SyncResult {
            success: true,
            mode_used: "none".into(),
            error: None,
        };
    }
    match is_reparse_point(target) {
        Ok(true) => match fs::remove_dir(target) {
            Ok(()) => SyncResult {
                success: true,
                mode_used: "junction".into(),
                error: None,
            },
            Err(e) => SyncResult {
                success: false,
                mode_used: "none".into(),
                error: Some(e.to_string()),
            },
        },
        Ok(false) => SyncResult {
            success: false,
            mode_used: "none".into(),
            error: Some(format!("目标不是链接，拒删: {}", target.display())),
        },
        Err(e) => SyncResult {
            success: false,
            mode_used: "none".into(),
            error: Some(e.to_string()),
        },
    }
}

/// 读取 junction/symlink 的目标路径
pub fn read_link_target(path: &Path) -> io::Result<PathBuf> {
    std::fs::read_link(path)
}
/// 纳管：把未纳管资产复制进 ~/.agents 源目录。
/// - copy 模式：仅复制，原位置不动
/// - move 模式：复制后把原位置替换为指向 dest 的 junction；
///   原位置若为真实目录，先备份到 backup_root 再替换
pub fn adopt(origin: &Path, dest: &Path, mode: &str, backup_root: &Path) -> SyncResult {
    if !origin.exists() {
        return SyncResult {
            success: false,
            mode_used: "none".into(),
            error: Some(format!("源目录不存在: {}", origin.display())),
        };
    }
    if dest.exists() {
        return SyncResult {
            success: false,
            mode_used: "none".into(),
            error: Some(format!("已存在同名纳管目录: {}", dest.display())),
        };
    }

    if let Err(e) = copy_dir_recursive(origin, dest) {
        return SyncResult {
            success: false,
            mode_used: "none".into(),
            error: Some(format!("复制到纳管目录失败: {}", e)),
        };
    }

    if mode != "move" {
        return SyncResult {
            success: true,
            mode_used: "copy".into(),
            error: None,
        };
    }

    // move：原位置替换为 junction
    match is_reparse_point(origin) {
        Ok(true) => {
            // 链接只需移除再重建
            if let Err(e) = fs::remove_dir(origin) {
                return SyncResult {
                    success: false,
                    mode_used: "copy".into(),
                    error: Some(format!("已复制但移除原链接失败: {}", e)),
                };
            }
        }
        Ok(false) => {
            // 真实目录：先备份再移除
            if let Err(e) = fs::create_dir_all(backup_root) {
                return SyncResult {
                    success: false,
                    mode_used: "copy".into(),
                    error: Some(format!("已复制但创建备份目录失败: {}", e)),
                };
            }
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let name = origin
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            let backup = backup_root.join(format!("adopted-{}-{}", stamp, name));
            if let Err(e) = fs::rename(origin, &backup) {
                // 跨盘 rename 可能失败，回退为 copy + remove_dir_all
                if copy_dir_recursive(origin, &backup).is_err() || fs::remove_dir_all(origin).is_err()
                {
                    return SyncResult {
                        success: false,
                        mode_used: "copy".into(),
                        error: Some(format!("已复制但备份原目录失败: {}", e)),
                    };
                }
            }
        }
        Err(e) => {
            return SyncResult {
                success: false,
                mode_used: "copy".into(),
                error: Some(format!("已复制但检测原目录类型失败: {}", e)),
            };
        }
    }

    match junction::create(dest, origin) {
        Ok(()) => SyncResult {
            success: true,
            mode_used: "move".into(),
            error: None,
        },
        Err(e) => SyncResult {
            success: false,
            mode_used: "copy".into(),
            error: Some(format!("已复制但原位置重建链接失败: {}", e)),
        },
    }
}

/// 判断 path 是否为 reparse point（junction 或 symlink）
pub fn is_reparse_point(path: &Path) -> io::Result<bool> {
    let attr = fs::symlink_metadata(path)?;
    Ok(attr.file_attributes() & 0x400 != 0)
}

// ---- internal helpers ----

fn paths_equal(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(aa), Ok(bb)) => aa == bb,
        _ => a == b,
    }
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            // 跳过 .git
            if src_path
                .file_name()
                .map(|n| n == ".git")
                .unwrap_or(false)
            {
                continue;
            }
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

// ---- unit tests ----

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join("skillman_test").join(name);
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn test_create_junction() {
        let src = tmp_dir("src");
        let tgt = tmp_dir("tgt");
        let _ = fs::remove_dir_all(&tgt);

        fs::write(src.join("test.txt"), "hello world").unwrap();
        let r = enable_link(&src, &tgt);
        assert!(r.success, "enable failed: {:?}", r.error);
        assert_eq!(r.mode_used, "junction");

        let data = fs::read_to_string(tgt.join("test.txt")).unwrap();
        assert_eq!(data, "hello world");

        let _ = fs::remove_dir(&tgt);
        let _ = fs::remove_dir_all(&src);
    }

    #[test]
    fn test_idempotent() {
        let src = tmp_dir("src2");
        let tgt = tmp_dir("tgt2");
        let _ = fs::remove_dir_all(&tgt);

        fs::write(src.join("f.txt"), "x").unwrap();
        let r1 = enable_link(&src, &tgt);
        assert!(r1.success);
        let r2 = enable_link(&src, &tgt);
        assert!(r2.success, "idempotent failed: {:?}", r2.error);

        let _ = fs::remove_dir(&tgt);
        let _ = fs::remove_dir_all(&src);
    }

    #[test]
    fn test_target_exists_error() {
        let src = tmp_dir("src3");
        let tgt = tmp_dir("tgt3");

        fs::write(src.join("a.txt"), "a").unwrap();
        fs::create_dir_all(&tgt).unwrap();
        fs::write(tgt.join("real.txt"), "real").unwrap();

        let r = enable_link(&src, &tgt);
        assert!(!r.success);

        let _ = fs::remove_dir_all(&tgt);
        let _ = fs::remove_dir_all(&src);
    }

    #[test]
    fn test_safe_delete_real_dir() {
        let real = tmp_dir("real_dir");
        fs::write(real.join("important.txt"), "do not delete").unwrap();

        let r = disable_link(&real);
        assert!(!r.success);
        assert!(real.exists());

        let _ = fs::remove_dir_all(&real);
    }

    #[test]
    fn test_adopt_move() {
        let base = tmp_dir("adopt_move");
        let origin = base.join("origin");
        let dest = base.join("managed");
        let backups = base.join("backups");
        fs::create_dir_all(&origin).unwrap();
        fs::write(origin.join("SKILL.md"), "---\nname: x\n---\nbody").unwrap();

        let r = adopt(&origin, &dest, "move", &backups);
        assert!(r.success, "adopt move failed: {:?}", r.error);
        assert_eq!(r.mode_used, "move");
        // dest 有内容
        assert!(dest.join("SKILL.md").exists());
        // origin 变成指向 dest 的 junction
        let resolved = read_link_target(&origin).unwrap();
        assert!(paths_equal(&resolved, &dest));
        // 备份存在
        let backup_count = fs::read_dir(&backups).unwrap().count();
        assert_eq!(backup_count, 1);

        let _ = fs::remove_dir(&origin); // 只删 junction
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn test_adopt_copy_keeps_origin() {
        let base = tmp_dir("adopt_copy");
        let origin = base.join("origin");
        let dest = base.join("managed");
        let backups = base.join("backups");
        fs::create_dir_all(&origin).unwrap();
        fs::write(origin.join("SKILL.md"), "body").unwrap();

        let r = adopt(&origin, &dest, "copy", &backups);
        assert!(r.success, "adopt copy failed: {:?}", r.error);
        assert_eq!(r.mode_used, "copy");
        // origin 仍是真实目录
        assert!(origin.join("SKILL.md").exists());
        assert!(!is_reparse_point(&origin).unwrap());

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn test_adopt_dest_exists_error() {
        let base = tmp_dir("adopt_conflict");
        let origin = base.join("origin");
        let dest = base.join("managed");
        let backups = base.join("backups");
        fs::create_dir_all(&origin).unwrap();
        fs::create_dir_all(&dest).unwrap();

        let r = adopt(&origin, &dest, "copy", &backups);
        assert!(!r.success);

        let _ = fs::remove_dir_all(&base);
    }
}
