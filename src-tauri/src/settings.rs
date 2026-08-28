//! 非敏感应用设置与 API 密钥存储适配。
//!
//! `settings.json` 只保存可公开的运行配置；密钥由 `ApiKeyStore` 交给平台安全存储。配置写入
//! 使用同目录临时文件，避免中断时破坏整份设置。

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, path::Path};

// ── 应用设置 ───────────────────────────────────────────────────────────────

/// 存储在 app_config_dir/settings.json，不含任何密钥。
///
/// 新字段必须提供默认值，以便旧版配置能够无损加载。
#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct AppSettings {
    // ── 存储 ──────────────────────────────
    /// 媒体文件根目录（图片、音频）
    /// None = 使用默认 Documents/FlowCloudAI；移动端始终忽略自定义值
    pub media_dir: Option<String>,
    /// 数据库文件目录
    /// None = Windows 使用 Documents/FlowCloudAI，其他平台使用 app_data_dir()；移动端始终忽略自定义值
    pub db_path: Option<String>,
    /// 插件目录
    /// None = Windows 使用 Documents/FlowCloudAI/plugins，其他平台使用 app_data_dir()/plugins；移动端始终忽略自定义值
    pub plugins_path: Option<String>,
    /// 首页项目卡片的本机星标项目 ID。
    pub starred_project_ids: Vec<String>,
    /// 词条卡片的本机星标词条 ID。
    pub starred_entry_ids: Vec<String>,

    // ── 外观 ──────────────────────────────
    /// "system" | "light" | "dark"
    pub theme: String,
    /// "zh-CN" | "en-US" | ...
    pub language: String,
    /// 编辑器字体大小（px）
    pub editor_font_size: u8,
    /// 颜色主题配置。None = 使用默认流云配色。
    pub theme_color_config: Option<serde_json::Value>,
    /// 历史字段名保持兼容：控制组件毛玻璃及桌面原生材质（Windows Acrylic / macOS Vibrancy）
    pub shell_acrylic_enabled: bool,

    // ── 备份行为 ───────────────────────────
    /// 历史兼容字段：旧版本词条自动保存间隔。当前不再用于编辑器自动保存。
    pub auto_save_secs: u32,
    /// 自动备份间隔（秒），0 = 关闭
    pub auto_backup_secs: u32,
    /// CSV 自动备份目录。None = 数据库目录下的 backup；移动端始终忽略自定义值
    pub backup_dir: Option<String>,
    /// 最多保留多少组自动备份
    pub max_backup_count: u32,
    /// 新建词条时的默认类型
    pub default_entry_type: Option<String>,

    // ── AI 默认配置 ────────────────────────
    pub llm: LlmDefaults,
    pub image: ImageDefaults,
    pub tts: TtsDefaults,

    // ── AI 工具配置 ────────────────────────
    /// 网络搜索引擎："bing" | "baidu" | "duckduckgo"
    pub search_engine: String,
    /// AI 搜索工具可使用的信源组
    pub search_sources: SearchSourceSettings,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            media_dir: None,
            db_path: None,
            plugins_path: None,
            starred_project_ids: Vec::new(),
            starred_entry_ids: Vec::new(),
            theme: "system".to_string(),
            language: "zh-CN".to_string(),
            editor_font_size: 14,
            theme_color_config: None,
            shell_acrylic_enabled: true,
            auto_save_secs: 0,
            auto_backup_secs: 300,
            backup_dir: None,
            max_backup_count: 20,
            default_entry_type: None,
            llm: LlmDefaults::default(),
            image: ImageDefaults::default(),
            tts: TtsDefaults::default(),
            search_engine: "bing".to_string(),
            search_sources: SearchSourceSettings::default(),
        }
    }
}

/// 原子写文件：先写同目录临时文件并 fsync，再 rename 覆盖目标。
/// 避免原地 fs::write 在写一半时崩溃/断电留下截断文件（整表/整份配置被破坏）。
pub(crate) fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    use std::io::Write;
    let Some(name) = path.file_name() else {
        return Err(anyhow::anyhow!("非法文件路径: {:?}", path));
    };
    let mut tmp_name = name.to_os_string();
    tmp_name.push(".tmp");
    let tmp_path = path.with_file_name(tmp_name);

    {
        let mut file = std::fs::File::create(&tmp_path)?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }
    if let Err(e) = std::fs::rename(&tmp_path, path) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(e.into());
    }
    Ok(())
}

impl AppSettings {
    /// 从 settings.json 加载；文件不存在时返回默认值
    pub fn load(path: &Path) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    /// 保存到 settings.json
    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(self)?;
        // 原子写：settings.json 含 db_path/media_dir 等关键路径；原地写被截断后
        // load() 会静默回落默认值 → 用户自定义库路径“消失”、世界库看似丢失。
        write_atomic(path, json.as_bytes())?;
        Ok(())
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct LlmDefaults {
    pub plugin_id: Option<String>,
    pub default_model: Option<String>,
    pub temperature: f64,
    pub top_p: f64,
    /// 重复惩罚，0 = 不惩罚
    pub frequency_penalty: f64,
    /// 存在惩罚，0 = 不惩罚
    pub presence_penalty: f64,
    pub max_tokens: i64,
    pub stream: bool,
    /// 是否显示思考过程（ReasoningDelta）
    pub show_reasoning: bool,
    /// 仅追加到通用 AI 对话默认系统提示词之后
    pub app_sense_custom_prompt: String,
    /// 是否允许在 AI 面板中选择作家模式。作家模式会跳过常规写入确认。
    pub writer_mode_enabled: bool,
    /// 是否在上下文接近模型窗口时自动压缩历史
    pub auto_compact_enabled: bool,
    /// 自动压缩触发阈值，取值 0.0 - 1.0
    pub auto_compact_threshold_ratio: f64,
    /// 自动压缩后保留最近多少条可见消息
    pub auto_compact_recent_messages: u32,
    /// 压缩文本详细程度："brief" | "balanced" | "detailed"
    pub auto_compact_detail: String,
    /// 按 `plugin:model` 保存的 token 估算校准系数。
    pub token_calibration_factors: HashMap<String, f64>,
    /// 按 `plugin:model` 保存的用户价格覆盖。
    pub model_price_overrides: HashMap<String, ModelPriceOverride>,
    /// 月度预算；None 表示不启用告警。
    pub monthly_budget_amount: Option<f64>,
    /// 月度预算的币种，不做汇率换算。
    pub monthly_budget_currency: String,
    /// 达到预算的该比例时开始告警。
    pub budget_warn_ratio: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModelPriceOverride {
    pub prompt_price_per_m: f64,
    pub completion_price_per_m: f64,
    pub currency: String,
}

impl Default for LlmDefaults {
    fn default() -> Self {
        Self {
            plugin_id: None,
            default_model: None,
            temperature: 0.7,
            top_p: 0.9,
            frequency_penalty: 0.0,
            presence_penalty: 0.0,
            max_tokens: 8192,
            stream: true,
            show_reasoning: false,
            app_sense_custom_prompt: String::new(),
            writer_mode_enabled: false,
            auto_compact_enabled: true,
            auto_compact_threshold_ratio: 0.65,
            auto_compact_recent_messages: 8,
            auto_compact_detail: "balanced".to_string(),
            token_calibration_factors: HashMap::new(),
            model_price_overrides: HashMap::new(),
            monthly_budget_amount: None,
            monthly_budget_currency: "USD".to_string(),
            budget_warn_ratio: 0.8,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub struct ImageDefaults {
    pub plugin_id: Option<String>,
    pub default_model: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct TtsDefaults {
    pub plugin_id: Option<String>,
    pub default_model: Option<String>,
    pub voice_id: Option<String>,
    /// 合成后自动播放
    pub auto_play: bool,
}

impl Default for TtsDefaults {
    fn default() -> Self {
        Self {
            plugin_id: None,
            default_model: None,
            voice_id: None,
            auto_play: true,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct SearchSourceSettings {
    /// 维基媒体项目：维基百科、维基词典、维基文库、维基语录、维基导游
    pub wikimedia: bool,
    /// 技术类 wiki
    pub technical_wiki: bool,
    /// 游戏类 wiki
    pub game_wiki: bool,
    /// 作品设定类 wiki
    pub fandom_wiki: bool,
    /// 电竞资料 wiki
    pub esports_wiki: bool,
    /// 通用网页搜索兜底
    pub web: bool,
}

impl Default for SearchSourceSettings {
    fn default() -> Self {
        Self {
            wikimedia: true,
            technical_wiki: true,
            game_wiki: true,
            fandom_wiki: true,
            esports_wiki: true,
            web: true,
        }
    }
}

// ── API 密钥存储 ───────────────────────────────────────────────────────────

// 桌面（Windows / Linux / macOS）与 iOS：系统密钥链（keyring crate），不落任何文件。
// Android：keyring 无可用后端会退回内存 mock（set 写进随即丢弃的临时对象、get 永远空
// → 表现为"保存成功但切页就没了"），故改存应用私有目录下的明文文件 api_keys.json。
// 该文件在应用沙箱内，未 root 的设备其它应用读不到；存储目录在启动时由
// `init_api_key_storage` 注入（见 lib.rs setup）。如需更强安全可后续接 Android Keystore 加密。

/// API 密钥存取。
pub struct ApiKeyStore;

#[cfg(not(target_os = "android"))]
const KEYRING_SERVICE: &str = "cn.flowcloudai.www";

#[cfg(not(target_os = "android"))]
impl ApiKeyStore {
    /// 读取插件的 API Key；不存在时返回 None
    pub fn get(plugin_id: &str) -> Option<String> {
        keyring::Entry::new(KEYRING_SERVICE, plugin_id)
            .ok()
            .and_then(|e| e.get_password().ok())
    }

    /// 写入插件的 API Key
    pub fn set(plugin_id: &str, api_key: &str) -> Result<()> {
        keyring::Entry::new(KEYRING_SERVICE, plugin_id)
            .map_err(|e| anyhow::anyhow!("keyring error: {}", e))?
            .set_password(api_key)
            .map_err(|e| anyhow::anyhow!("keyring set error: {}", e))
    }

    /// 删除插件的 API Key
    pub fn delete(plugin_id: &str) -> Result<()> {
        keyring::Entry::new(KEYRING_SERVICE, plugin_id)
            .map_err(|e| anyhow::anyhow!("keyring error: {}", e))?
            .delete_credential()
            .map_err(|e| anyhow::anyhow!("keyring delete error: {}", e))
    }
}

/// 基于应用私有目录明文文件的 API Key 存储（Android 实际使用；目录显式传入，便于宿主侧测试）。
/// 每次操作都直接读/写文件、无内存缓存，因此重新挂载页面重新查询能拿到已保存值。
#[cfg(any(target_os = "android", test))]
mod file_key_store {
    use anyhow::Result;
    use std::collections::BTreeMap;
    use std::path::Path;

    const FILE_NAME: &str = "api_keys.json";

    fn read_all(dir: &Path) -> BTreeMap<String, String> {
        std::fs::read(dir.join(FILE_NAME))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    fn write_all(dir: &Path, map: &BTreeMap<String, String>) -> Result<()> {
        std::fs::create_dir_all(dir).map_err(|e| anyhow::anyhow!("创建密钥目录失败: {}", e))?;
        let json =
            serde_json::to_vec_pretty(map).map_err(|e| anyhow::anyhow!("序列化密钥失败: {}", e))?;
        // 原子写：整份 api_keys.json 每次全量重写，原地写被截断会一次性丢掉所有已存 Key。
        super::write_atomic(&dir.join(FILE_NAME), &json)
            .map_err(|e| anyhow::anyhow!("写入密钥文件失败: {}", e))
    }

    pub fn get(dir: &Path, plugin_id: &str) -> Option<String> {
        read_all(dir).get(plugin_id).cloned()
    }

    pub fn set(dir: &Path, plugin_id: &str, api_key: &str) -> Result<()> {
        let mut map = read_all(dir);
        map.insert(plugin_id.to_string(), api_key.to_string());
        write_all(dir, &map)
    }

    pub fn delete(dir: &Path, plugin_id: &str) -> Result<()> {
        let mut map = read_all(dir);
        map.remove(plugin_id);
        write_all(dir, &map)
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn roundtrip_persists_through_file() {
            let dir = std::env::temp_dir().join(format!("fc_apikey_test_{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);

            // 复现 bug 场景：保存后"重新读取"（每次都读文件，模拟切页重挂载）应拿到值。
            assert_eq!(get(&dir, "deepseek-llm"), None);
            set(&dir, "deepseek-llm", "sk-abc").unwrap();
            assert_eq!(get(&dir, "deepseek-llm"), Some("sk-abc".to_string()));

            // 覆盖 + 多插件互不影响
            set(&dir, "deepseek-llm", "sk-xyz").unwrap();
            set(&dir, "qwen-llm", "sk-q").unwrap();
            assert_eq!(get(&dir, "deepseek-llm"), Some("sk-xyz".to_string()));
            assert_eq!(get(&dir, "qwen-llm"), Some("sk-q".to_string()));

            // 删除只影响目标
            delete(&dir, "deepseek-llm").unwrap();
            assert_eq!(get(&dir, "deepseek-llm"), None);
            assert_eq!(get(&dir, "qwen-llm"), Some("sk-q".to_string()));

            let _ = std::fs::remove_dir_all(&dir);
        }
    }
}

#[cfg(target_os = "android")]
mod android_key_store {
    use anyhow::Result;
    use std::path::PathBuf;
    use std::sync::{Mutex, OnceLock};

    static STORAGE_DIR: OnceLock<PathBuf> = OnceLock::new();
    /// 串行化文件读改写，避免并发覆盖。
    static FILE_LOCK: Mutex<()> = Mutex::new(());

    pub fn init_storage_dir(dir: PathBuf) {
        let _ = STORAGE_DIR.set(dir);
    }

    fn dir() -> Result<&'static PathBuf> {
        STORAGE_DIR
            .get()
            .ok_or_else(|| anyhow::anyhow!("API Key 存储目录未初始化"))
    }

    pub fn get(plugin_id: &str) -> Option<String> {
        let _guard = FILE_LOCK.lock().ok()?;
        super::file_key_store::get(dir().ok()?, plugin_id)
    }

    pub fn set(plugin_id: &str, api_key: &str) -> Result<()> {
        let _guard = FILE_LOCK
            .lock()
            .map_err(|_| anyhow::anyhow!("密钥文件锁异常"))?;
        super::file_key_store::set(dir()?, plugin_id, api_key)
    }

    pub fn delete(plugin_id: &str) -> Result<()> {
        let _guard = FILE_LOCK
            .lock()
            .map_err(|_| anyhow::anyhow!("密钥文件锁异常"))?;
        super::file_key_store::delete(dir()?, plugin_id)
    }
}

#[cfg(target_os = "android")]
impl ApiKeyStore {
    /// 读取插件的 API Key；不存在时返回 None
    pub fn get(plugin_id: &str) -> Option<String> {
        android_key_store::get(plugin_id)
    }

    /// 写入插件的 API Key
    pub fn set(plugin_id: &str, api_key: &str) -> Result<()> {
        android_key_store::set(plugin_id, api_key)
    }

    /// 删除插件的 API Key
    pub fn delete(plugin_id: &str) -> Result<()> {
        android_key_store::delete(plugin_id)
    }
}

/// 注入 Android 的 API Key 明文存储目录（应用私有目录）。仅 Android 需要；
/// 桌面 / iOS 走系统密钥链，不调用。
#[cfg(target_os = "android")]
pub fn init_api_key_storage(dir: std::path::PathBuf) {
    android_key_store::init_storage_dir(dir);
}
