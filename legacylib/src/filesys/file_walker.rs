// example: file_walker::walk(base_path.clone()).await?;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use lofty::file::TaggedFileExt;
use lofty::tag::ItemValue;
use lofty::{prelude::AudioFile, probe::Probe};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::Path;
use std::{
    collections::VecDeque,
    fs,
    io::{self, Write},
    path::PathBuf,
    time::{Duration, Instant},
};
use tokio::io::AsyncReadExt;
use tokio::io::{AsyncSeekExt, AsyncWriteExt, SeekFrom};
use tokio::{fs::File, fs::OpenOptions, time::interval};
use walkdir::{DirEntry, WalkDir};

use crate::config::AppConfig;
use crate::media::MediaTypeDetector;

const MAX_BATCH: usize = 50;
const FLUSH_INTERVAL: Duration = Duration::from_secs(30);

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AudioMetadataTagsProperties {
    pub tags: HashMap<String, String>,
    pub properties: HashMap<String, serde_json::Value>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AudioMetadataFile {
    pub file: HashMap<String, serde_json::Value>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AudioMetadata {
    pub tag_properties: AudioMetadataTagsProperties,
    pub file_metadata: AudioMetadataFile,
}

async fn get_audio_tags_properties(f: &str) -> anyhow::Result<AudioMetadataTagsProperties> {
    let path = Path::new(&f);

    let mut tags_map = HashMap::new();
    let mut props_map = HashMap::new();

    let tagged_file = match Probe::open(path).and_then(|p| p.read()) {
        Ok(file) => file,
        Err(e) => {
            eprintln!("Could not read metadata from {:?}: {}", &path, e);
            return Ok(AudioMetadataTagsProperties {
                tags: tags_map,
                properties: props_map,
            });
        }
    };

    if let Some(tag) = tagged_file.primary_tag() {
        for item in tag.items() {
            let key = format!("{:?}", item.key());
            // let value = format!("{:?}", item.value());

            let value_str = match item.value() {
                ItemValue::Text(s) | ItemValue::Locator(s) => s.clone(),
                ItemValue::Binary(_) => "".into(),
            };

            tags_map.insert(key, value_str);
        }
    }

    let props = tagged_file.properties();

    props_map.insert(
        "duration".to_string(),
        serde_json::json!(props.duration().as_secs()),
    );
    props_map.insert(
        "sample_rate".to_string(),
        serde_json::json!(props.sample_rate()),
    );
    props_map.insert("channels".to_string(), serde_json::json!(props.channels()));
    props_map.insert(
        "bitrate".to_string(),
        serde_json::json!(props.audio_bitrate()),
    );
    props_map.insert(
        "bit_depth".to_string(),
        serde_json::json!(props.bit_depth()),
    );

    Ok(AudioMetadataTagsProperties {
        tags: tags_map,
        properties: props_map,
    })
}

async fn get_metadata(f: &str) -> anyhow::Result<AudioMetadataFile> {
    let path = Path::new(&f);

    let metadata = tokio::fs::metadata(&path).await?;
    let mut metadata_map = HashMap::new();

    if let Ok(modified) = metadata.modified() {
        metadata_map.insert("modified".to_string(), serde_json::json!(modified));
    }

    if let Ok(created) = metadata.created() {
        metadata_map.insert("created".to_string(), serde_json::json!(created));
    }

    metadata_map.insert("len_bytes".to_string(), serde_json::json!(metadata.len()));

    if let Some(ext) = path.extension() {
        if let Some(ext_str) = ext.to_str() {
            metadata_map.insert("ext".to_string(), serde_json::json!(ext_str));
        }
    }

    Ok(AudioMetadataFile { file: metadata_map })
}

pub async fn hash_file(path: &str) -> io::Result<String> {
    let mut file = File::open(path).await?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 4096];

    loop {
        let n = file.read(&mut buffer).await?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }

    let hash = hasher.finalize();
    // Ok(truncate_hash(&URL_SAFE_NO_PAD.encode(&hash), 12))
    Ok(URL_SAFE_NO_PAD.encode(&hash))
}

// Removed ScanCheckpoint - will be replaced with database-backed progress tracking

fn stream_files(
    base_path: PathBuf,
    resume_from: Option<PathBuf>,
    detector: &MediaTypeDetector,
) -> impl Iterator<Item = DirEntry> {
    let mut entries: Vec<_> = WalkDir::new(&base_path)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
        .filter(|e| detector.is_audio_file(e.path()).unwrap_or(false))
        .collect();

    entries.sort_by_key(|e| e.path().to_path_buf());

    if let Some(resume_path) = resume_from {
        entries
            .into_iter()
            .skip_while(|e| e.path() <= resume_path.as_path())
            .collect::<Vec<_>>()
            .into_iter()
    } else {
        entries.into_iter()
    }
}

// Removed append_json_object - will be replaced with database storage

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SongFile {
    pub path: String,
    pub id: String,
    pub metadata: AudioMetadata,
    pub base_path: String,
}

async fn store_files(batch: &[DirEntry], base_path: PathBuf) -> anyhow::Result<()> {
    let mut items = Vec::new();

    for entry in batch {
        let path = entry.path();
        let id = hash_file(&path.to_string_lossy()).await?;

        let tag_properties = get_audio_tags_properties(&path.to_string_lossy()).await?;
        let file_metadata = get_metadata(&path.to_string_lossy()).await?;

        let metadata = AudioMetadata {
            tag_properties,
            file_metadata,
        };

        items.push(SongFile {
            base_path: base_path.display().to_string(),
            path: path.display().to_string(),
            id,
            metadata,
        });
    }

    // TODO: Store items in database instead of JSON file
    println!(
        "\rProcessed {} files from {}",
        items.len(),
        base_path.display()
    );
    std::io::stdout().flush()?;

    Ok(())
}

pub async fn walk(base_path: PathBuf, config: &AppConfig) -> anyhow::Result<()> {
    let detector = MediaTypeDetector::from_config(config);

    let mut batch = VecDeque::new();
    let mut last_flush = Instant::now();
    let mut total_processed = 0;

    for entry in stream_files(base_path.clone(), None, &detector) {
        batch.push_back(entry.clone());
        total_processed += 1;

        if batch.len() >= MAX_BATCH || last_flush.elapsed() > FLUSH_INTERVAL {
            store_files(&batch.make_contiguous(), base_path.clone()).await?;
            batch.clear();
            last_flush = Instant::now();

            print!(
                "\rScanning: {} files processed from {}",
                total_processed,
                base_path.display()
            );
            io::stdout().flush()?;
        }
    }

    if !batch.is_empty() {
        store_files(&batch.make_contiguous(), base_path.clone()).await?;
    }

    println!(
        "\nScan complete. Processed {} files total.",
        total_processed
    );

    Ok(())
}
