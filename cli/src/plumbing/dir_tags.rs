//! Directory tag rules CLI commands
//!
//! manage auto-tagging rules for directories - albums get tagged based on file location

use crate::plumbing::utils::CommandOutput;
use clap::Subcommand;
use grimoire::jobs::{
    add_directory_tags, clear_directory_tags, clear_tags_from_directory, list_directory_tag_rules,
    list_directory_tags, remove_directory_tags, strip_tags_from_directory, DirectoryTagRule,
};
use serde::{Deserialize, Serialize};

#[derive(Subcommand)]
pub enum DirTagsAction {
    /// Add tag rules to a directory (albums in this dir will get these tags)
    Add {
        /// Directory path
        path: String,
        /// Tag names to add (comma-separated)
        #[arg(long, value_delimiter = ',')]
        tags: Vec<String>,
    },
    /// Remove tag rules from a directory
    Remove {
        /// Directory path
        path: String,
        /// Tag names to remove (comma-separated)
        #[arg(long, value_delimiter = ',')]
        tags: Vec<String>,
    },
    /// Clear all tag rules from a directory
    Clear {
        /// Directory path
        path: String,
    },
    /// List all directory tag rules
    List {
        /// Optional: filter by directory path
        #[arg(long)]
        path: Option<String>,
    },
    /// Strip tags from all albums under a directory (removes actual album tags)
    Strip {
        /// Directory path
        path: String,
        /// Tag names to strip (comma-separated)
        #[arg(long, value_delimiter = ',')]
        tags: Vec<String>,
    },
    /// Sync: clear all rule-defined tags from albums under a directory
    /// (removes album tags that match the directory's rules)
    Sync {
        /// Directory path
        path: String,
    },
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DirTagRuleOutput {
    pub id: String,
    pub directory_path: String,
    pub tag_name: String,
    pub created_at: String,
}

impl From<DirectoryTagRule> for DirTagRuleOutput {
    fn from(rule: DirectoryTagRule) -> Self {
        DirTagRuleOutput {
            id: rule.id,
            directory_path: rule.directory_path,
            tag_name: rule.tag_name.unwrap_or_else(|| rule.tag_id),
            created_at: super::utils::format_timestamp(rule.created_at),
        }
    }
}

/// handle dir-tags commands
pub async fn handle_command(action: DirTagsAction) -> CommandOutput<serde_json::Value> {
    match action {
        DirTagsAction::Add { path, tags } => {
            if tags.is_empty() {
                return CommandOutput::failure("must provide at least one tag", vec![], ());
            }

            let response = add_directory_tags(&path, tags, None).await;

            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let rules = response.data.unwrap_or_default();
            let output: Vec<DirTagRuleOutput> = rules.into_iter().map(Into::into).collect();

            CommandOutput::success(
                format!("added {} tag rules for {}", output.len(), path),
                output,
            )
        }

        DirTagsAction::Remove { path, tags } => {
            if tags.is_empty() {
                return CommandOutput::failure("must provide at least one tag", vec![], ());
            }

            let response = remove_directory_tags(&path, tags).await;

            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let removed = response.data.unwrap_or(0);
            CommandOutput::success(
                format!("removed {} tag rules from {}", removed, path),
                serde_json::json!({ "removed": removed }),
            )
        }

        DirTagsAction::Clear { path } => {
            let response = clear_directory_tags(&path).await;

            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let cleared = response.data.unwrap_or(0);
            CommandOutput::success(
                format!("cleared {} tag rules from {}", cleared, path),
                serde_json::json!({ "cleared": cleared }),
            )
        }

        DirTagsAction::List { path } => {
            let response = if let Some(ref p) = path {
                list_directory_tags(p).await
            } else {
                list_directory_tag_rules().await
            };

            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let rules = response.data.unwrap_or_default();
            let output: Vec<DirTagRuleOutput> = rules.into_iter().map(Into::into).collect();

            let message = if let Some(p) = path {
                format!("found {} tag rules for {}", output.len(), p)
            } else {
                format!("found {} directory tag rules", output.len())
            };

            CommandOutput::success(message, output)
        }

        DirTagsAction::Strip { path, tags } => {
            if tags.is_empty() {
                return CommandOutput::failure("must provide at least one tag", vec![], ());
            }

            let response = strip_tags_from_directory(&path, tags).await;

            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let stripped = response.data.unwrap_or(0);
            CommandOutput::success(
                format!("stripped {} tag assignments from albums under {}", stripped, path),
                serde_json::json!({ "stripped": stripped }),
            )
        }

        DirTagsAction::Sync { path } => {
            let response = clear_tags_from_directory(&path).await;

            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let cleared = response.data.unwrap_or(0);
            CommandOutput::success(
                format!("cleared {} rule-based tag assignments from albums under {}", cleared, path),
                serde_json::json!({ "cleared": cleared }),
            )
        }
    }
}
