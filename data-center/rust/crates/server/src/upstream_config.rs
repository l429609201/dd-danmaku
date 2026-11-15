//! 官方凭据专用配置边界：数据库优先，环境变量仅用于尚未保存配置的部署。
use std::{fs::{self, OpenOptions}, io::Write, path::Path};
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
use base64::{engine::general_purpose::STANDARD, Engine};
use db::entities::config;
use ring::{aead, rand::{SecureRandom, SystemRandom}};
use sea_orm::{ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseConnection, EntityTrait, QueryFilter, Set, TransactionTrait};

pub use crate::api::settings::models::{DandanplayConfigResponse, UpdateDandanplayConfigRequest};
use crate::dandanplay_upstream::Credentials;

pub const NAMESPACE: &str = "dandanplay";
const AAD: &[u8] = b"dd-danmaku:dandanplay:app_secret:v1";
const DEFAULT_AGENT: &str = "data-center-rust/0.1.0";

/// 主密钥来自本地持久化参数，绝不使用 JWT 默认密钥或散列替代原始应用密钥。
pub struct ConfigCipher(aead::LessSafeKey);
impl ConfigCipher {
    pub fn from_base64(encoded: &str) -> Result<Self, String> {
        let bytes = STANDARD.decode(encoded.trim()).map_err(|_| "DANDANPLAY_CONFIG_KEY 必须是 32 字节密钥的标准 Base64".to_owned())?;
        if bytes.len() != 32 { return Err("DANDANPLAY_CONFIG_KEY 解码后必须恰好为 32 字节".into()); }
        let key = aead::UnboundKey::new(&aead::AES_256_GCM, &bytes).map_err(|_| "无法初始化配置加密".to_owned())?;
        Ok(Self(aead::LessSafeKey::new(key)))
    }
    /// 优先读取持久化参数文件；仅首次创建时兼容导入旧环境变量密钥。
    pub fn from_env() -> Result<Self, String> {
        let directory = std::env::var("CONFIG_PATH").ok().filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "/app/config".into());
        Self::from_file(Path::new(&directory).join("encryption-key.json").as_path(),
            std::env::var("DANDANPLAY_CONFIG_KEY").ok().as_deref())
    }

    /// 临时文件写入并同步后用硬链接原子发布；多进程竞争时读取胜出文件，不覆盖已有密钥。
    pub fn from_file(path: &Path, legacy_key: Option<&str>) -> Result<Self, String> {
        fn read_key(path: &Path) -> Result<ConfigCipher, String> {
            let metadata = fs::symlink_metadata(path).map_err(|_| "无法读取本地加密参数文件".to_owned())?;
            if !metadata.file_type().is_file() { return Err("本地加密参数必须为普通文件".into()); }
            #[cfg(unix)] {
                use std::os::unix::fs::PermissionsExt;
                if metadata.permissions().mode() & 0o077 != 0 {
                    return Err("本地加密参数文件权限过宽，请设置为 0600".into());
                }
            }
            let bytes = fs::read(path).map_err(|_| "无法读取本地加密参数文件".to_owned())?;
            let data: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| "本地加密参数文件损坏，禁止自动替换密钥".to_owned())?;
            ConfigCipher::from_base64(data.get("key").and_then(|v| v.as_str()).ok_or("本地加密参数缺少 key")?)
        }
        match fs::symlink_metadata(path) {
            Ok(_) => return read_key(path),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {},
            Err(_) => return Err("无法访问本地加密参数文件".into()),
        }
        let parent = path.parent().ok_or("本地加密参数路径无效")?;
        fs::create_dir_all(parent).map_err(|_| "无法创建持久化配置目录".to_owned())?;
        let mut random = [0u8; 32];
        SystemRandom::new().fill(&mut random).map_err(|_| "无法生成随机主密钥".to_owned())?;
        let encoded = match legacy_key {
            Some(key) => { Self::from_base64(key)?; key.trim().to_owned() },
            None => STANDARD.encode(random),
        };
        let temporary = parent.join(format!(".encryption-key-{}.tmp", uuid::Uuid::new_v4()));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)] options.mode(0o600);
        let mut file = options.open(&temporary).map_err(|_| "无法创建私密加密参数文件".to_owned())?;
        let result = (|| {
            let content = serde_json::json!({"version":1,"key":encoded}).to_string();
            file.write_all(content.as_bytes()).and_then(|_| file.sync_all()).map_err(|_| "无法持久化加密参数文件".to_owned())?;
            match fs::hard_link(&temporary, path) {
                Ok(()) => { fs::File::open(parent).and_then(|dir| dir.sync_all()).map_err(|_| "无法同步加密参数目录".to_owned())?; },
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {},
                Err(_) => return Err("无法原子保存本地加密参数文件".into()),
            }
            read_key(path)
        })();
        // 只清理本次 create_new 创建的临时文件；目标密钥文件永不删除或覆盖。
        let _ = fs::remove_file(&temporary);
        result
    }
    pub fn encrypt(&self, secret: &str) -> Result<String, String> {
        let mut nonce = [0u8; 12];
        SystemRandom::new().fill(&mut nonce).map_err(|_| "无法生成配置加密随机数".to_owned())?;
        let mut body = secret.as_bytes().to_vec();
        self.0.seal_in_place_append_tag(aead::Nonce::assume_unique_for_key(nonce), aead::Aad::from(AAD), &mut body)
            .map_err(|_| "配置加密失败".to_owned())?;
        let mut envelope = nonce.to_vec(); envelope.extend(body);
        Ok(format!("v1:{}", STANDARD.encode(envelope)))
    }
    pub fn decrypt(&self, envelope: &str) -> Result<String, String> {
        let failure = || "无法解密弹弹应用密钥，请检查本地加密参数文件是否与保存时一致".to_owned();
        let encoded = envelope.strip_prefix("v1:").ok_or_else(failure)?;
        let mut bytes = STANDARD.decode(encoded).map_err(|_| failure())?;
        if bytes.len() < 28 { return Err(failure()); }
        let nonce: [u8; 12] = bytes[..12].try_into().map_err(|_| failure())?;
        let clear = self.0.open_in_place(aead::Nonce::assume_unique_for_key(nonce), aead::Aad::from(AAD), &mut bytes[12..]).map_err(|_| failure())?;
        String::from_utf8(clear.to_vec()).map_err(|_| failure())
    }
}

async fn rows<C: ConnectionTrait>(db: &C) -> Result<Vec<config::Model>, String> {
    config::Entity::find().filter(config::Column::Namespace.eq(NAMESPACE)).all(db).await
        .map_err(|_| "无法读取弹弹应用配置".to_owned())
}
fn value<'a>(rows: &'a [config::Model], key: &str) -> Option<&'a str> {
    rows.iter().find(|r| r.config_key == key).and_then(|r| r.value_text.as_deref())
}
fn database_credentials(rows: &[config::Model], cipher: &ConfigCipher) -> Result<Credentials, String> {
    let app_id = value(rows, "app_id").ok_or("弹弹数据库配置缺少 app_id")?.to_owned();
    let user_agent = value(rows, "user_agent").ok_or("弹弹数据库配置缺少 user_agent")?.to_owned();
    let secret = rows.iter().find(|r| r.config_key == "app_secret" && r.is_secret)
        .and_then(|r| r.value_text.as_deref()).ok_or("弹弹数据库配置缺少加密应用密钥")?;
    let app_secret = cipher.decrypt(secret)?;
    validate(&app_id, &user_agent, Some(&app_secret))?;
    Ok(Credentials { app_id, app_secret, user_agent })
}

/// 每次回源重新查询，热更新生效；存在任何数据库配置时禁止拼接环境变量凭据。
pub async fn load_credentials(db: &DatabaseConnection) -> Result<Credentials, String> {
    let configured = rows(db).await?;
    if configured.is_empty() { return Credentials::from_env(); }
    database_credentials(&configured, &ConfigCipher::from_env()?)
}
/// 显式密码器接缝供独立测试验证数据库签名，不读取或修改真实环境变量。
pub async fn load_credentials_with_cipher(db: &DatabaseConnection, cipher: &ConfigCipher) -> Result<Credentials, String> {
    database_credentials(&rows(db).await?, cipher)
}

pub async fn get_config(db: &DatabaseConnection) -> Result<DandanplayConfigResponse, String> {
    let configured = rows(db).await?;
    let encryption_ready = ConfigCipher::from_env().is_ok();
    if !configured.is_empty() {
        return Ok(DandanplayConfigResponse {
            app_id: value(&configured, "app_id").unwrap_or_default().into(),
            user_agent: value(&configured, "user_agent").unwrap_or(DEFAULT_AGENT).into(),
            secret_configured: configured.iter().any(|r| r.config_key == "app_secret" && r.is_secret && r.value_text.as_ref().is_some_and(|v| !v.is_empty())),
            source: "database".into(), encryption_ready,
        });
    }
    let app_id = std::env::var("DANDANPLAY_APP_ID").unwrap_or_default();
    let secret_configured = std::env::var("DANDANPLAY_APP_SECRET").is_ok_and(|s| !s.trim().is_empty());
    let user_agent = std::env::var("DANDANPLAY_USER_AGENT").ok().filter(|s| !s.trim().is_empty()).unwrap_or_else(|| DEFAULT_AGENT.into());
    let source = if !app_id.trim().is_empty() || secret_configured { "environment" } else { "none" };
    Ok(DandanplayConfigResponse { app_id, user_agent, secret_configured, source: source.into(), encryption_ready })
}

fn validate(app_id: &str, user_agent: &str, secret: Option<&str>) -> Result<(), String> {
    if app_id.trim().is_empty() || app_id.len() > 256 || reqwest::header::HeaderValue::from_str(app_id).is_err() {
        return Err("app_id 必须为有效且非空的请求头值（最多 256 字节）".into());
    }
    if user_agent.trim().is_empty() || user_agent.len() > 1024 || reqwest::header::HeaderValue::from_str(user_agent).is_err() {
        return Err("user_agent 必须为有效且非空的请求头值（最多 1024 字节）".into());
    }
    if let Some(secret) = secret {
        if secret.trim().is_empty() || secret == "****" || secret.len() > 4096 { return Err("app_secret 必须为真实非空密钥（最多 4096 字节），不能提交掩码".into()); }
    }
    Ok(())
}

pub async fn save_config(db: &DatabaseConnection, request: UpdateDandanplayConfigRequest) -> Result<(), String> {
    save_config_with_cipher(db, request, &ConfigCipher::from_env()?).await
}
/// 三项在同一事务内替换，省略密钥时保留原加密值；首次保存必须提供真实密钥。
pub async fn save_config_with_cipher(db: &DatabaseConnection, request: UpdateDandanplayConfigRequest, cipher: &ConfigCipher) -> Result<(), String> {
    validate(&request.app_id, &request.user_agent, request.app_secret.as_deref())?;
    let tx = db.begin().await.map_err(|_| "无法开始弹弹配置事务".to_owned())?;
    let existing = rows(&tx).await?;
    let encrypted = if let Some(secret) = request.app_secret {
        cipher.encrypt(&secret)?
    } else {
        let stored = existing.iter().find(|r| r.config_key == "app_secret" && r.is_secret)
            .and_then(|r| r.value_text.as_deref()).ok_or("首次保存必须提供 app_secret；省略仅保留数据库已有密钥")?;
        // 保留前认证密文，避免错误主密钥下静默保存不可用配置。
        cipher.decrypt(stored)?;
        stored.to_owned()
    };
    config::Entity::delete_many().filter(config::Column::Namespace.eq(NAMESPACE)).exec(&tx).await.map_err(|_| "无法更新弹弹应用配置".to_owned())?;
    let now = chrono::Utc::now().naive_utc();
    for (key, text, secret) in [("app_id", request.app_id, false), ("user_agent", request.user_agent, false), ("app_secret", encrypted, true)] {
        config::ActiveModel { namespace: Set(NAMESPACE.into()), config_key: Set(key.into()), value_type: Set(if secret { "aes-256-gcm-v1" } else { "string" }.into()), value_text: Set(Some(text)), is_secret: Set(secret), created_at: Set(now), updated_at: Set(now), ..Default::default() }
            .insert(&tx).await.map_err(|_| "无法写入弹弹应用配置".to_owned())?;
    }
    tx.commit().await.map_err(|_| "无法提交弹弹配置事务".to_owned())?;
    Ok(())
}
