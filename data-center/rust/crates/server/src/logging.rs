//! 统一初始化控制台和按日轮转的运行日志，复用现有依赖而不引入后台写入线程。

use chrono::Local;
use std::{
    fs::{File, OpenOptions},
    io::{self, Write},
    path::PathBuf,
    sync::{Mutex, MutexGuard},
};
use tracing_subscriber::{fmt::MakeWriter, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

struct DailyFile {
    directory: PathBuf,
    date: String,
    file: File,
}

impl DailyFile {
    fn open(directory: PathBuf) -> io::Result<Self> {
        std::fs::create_dir_all(&directory)?;
        let date = Local::now().format("%Y-%m-%d").to_string();
        let file = Self::open_file(&directory, &date)?;
        Ok(Self { directory, date, file })
    }

    fn open_file(directory: &std::path::Path, date: &str) -> io::Result<File> {
        let mut options = OpenOptions::new();
        options.create(true).append(true);
        // 新日志只允许服务账号读写，避免启动诊断等内容被其他本机账号读取。
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        options.open(directory.join(format!("data-center-{date}.log")))
    }

    fn rotate(&mut self) -> io::Result<()> {
        let date = Local::now().format("%Y-%m-%d").to_string();
        if self.date != date {
            // 先打开新文件再替换句柄；轮转失败时仍保留旧文件，不丢弃现有日志。
            let file = Self::open_file(&self.directory, &date)?;
            self.file = file;
            self.date = date;
        }
        Ok(())
    }
}

struct DailyWriter(Mutex<DailyFile>);

struct DailyGuard<'a>(MutexGuard<'a, DailyFile>);

impl<'a> MakeWriter<'a> for DailyWriter {
    type Writer = DailyGuard<'a>;

    fn make_writer(&'a self) -> Self::Writer {
        // 一条事件持有同一把锁，防止并发写入交错或跨午夜拆到两个文件。
        let mut guard = self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Err(error) = guard.rotate() {
            // 不递归调用 tracing，文件故障必须仍可在 Docker 标准错误中看到。
            eprintln!("日志按日轮转失败，继续写入上一日志文件：{error}");
        }
        DailyGuard(guard)
    }
}

impl Write for DailyGuard<'_> {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        // 直接写文件而非缓冲队列，进程退出时不依赖额外 guard 排空日志。
        self.0.file.write(bytes)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.0.file.flush()
    }
}

/// 控制台始终启用；目录不可写时明确警告并降级，不阻止服务启动。
pub fn init() {
    let directory = std::env::var("CONFIG_PATH")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/app/config"))
        .join("logs");

    // RUST_LOG 优先，其次兼容旧 LOG_LEVEL；错误配置回退 info 而非启动崩溃。
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        let level = std::env::var("LOG_LEVEL").unwrap_or_else(|_| "info".to_string());
        let level = level.trim().to_lowercase();
        let level = if level == "warning" { "warn" } else { &level };
        EnvFilter::try_new(format!("{level},sqlx=warn"))
            .unwrap_or_else(|_| EnvFilter::new("info,sqlx=warn"))
    });
    let file = match DailyFile::open(directory.clone()) {
        Ok(file) => Some(
            tracing_subscriber::fmt::layer()
                .with_ansi(false)
                .with_writer(DailyWriter(Mutex::new(file))),
        ),
        Err(error) => {
            eprintln!("无法初始化运行日志目录 {}，仅输出控制台日志：{error}", directory.display());
            None
        }
    };

    let file_enabled = file.is_some();
    tracing_subscriber::registry()
        .with(filter)
        // 明确输出 stdout，Docker logs 与日志文件接收相同过滤级别的事件。
        .with(tracing_subscriber::fmt::layer().with_ansi(false).with_writer(io::stdout))
        .with(file)
        .init();
    if file_enabled {
        tracing::info!("运行日志已初始化，控制台与文件双写，日志目录：{}", directory.display());
    } else {
        tracing::warn!("文件日志不可用，当前仅输出控制台日志");
    }
}
