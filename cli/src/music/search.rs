//! Music search CLI handlers

use grimoire::music::MusicService;
use grimoire::search::{SearchQuery, SearchService, SearchType};
use std::collections::HashMap;

/// Handle music search command
pub async fn handle_search(
    service: &MusicService<'_>,
    query: String,
    structured: bool,
    search_type: String,
    limit: u32,
    verbose: bool,
    songs_only: bool,
    page: u32,
    user_id: Option<String>,
) -> Result<(), Box<dyn std::error::Error>> {
    // parse user id if provided
    let parsed_user_id = if let Some(user_id_str) = user_id {
        match uuid::Uuid::parse_str(&user_id_str) {
            Ok(id) => {
                println!(
                    "🔍 Searching for: \"{}\" (for user: {})",
                    query, user_id_str
                );
                Some(id)
            }
            Err(_) => {
                eprintln!("❌ Invalid user ID format: {}", user_id_str);
                return Err("Invalid user ID".into());
            }
        }
    } else {
        println!("🔍 Searching for: \"{}\" (global view)", query);
        None
    };

    // Parse search type
    let search_type_enum = match search_type.as_str() {
        "websearch" => SearchType::WebSearch,
        "plainto" => SearchType::PlainText,
        "phrase" => SearchType::Phrase,
        _ => {
            eprintln!(
                "❌ Invalid search type: {}. Valid types: websearch, plainto, phrase",
                search_type
            );
            return Err("Invalid search type".into());
        }
    };

    // Build search query
    let mut search_query = SearchQuery::new()
        .with_search_type(search_type_enum)
        .with_domains(vec!["music".to_string()])
        .with_pagination(page, limit);

    if structured {
        search_query = search_query.with_structured_search(&query);
        println!("📝 Using structured search: {}", query);
    } else {
        search_query = search_query.with_query(&query);
        println!("🔤 Using text search: {}", query);
    }

    // Get search service from database connection
    let search_service = SearchService::new(service.get_pool().clone());

    if songs_only {
        // Search only songs
        let (results, total_count) = search_service
            .search_songs(parsed_user_id, &search_query)
            .await?;

        if results.is_empty() {
            println!("😔 No songs found matching your search.");
            return Ok(());
        }

        println!("🎵 Found {} songs (total: {}):", results.len(), total_count);
        println!();

        for (i, song) in results.iter().enumerate() {
            let rank_indicator = if song.search_rank > 0.0 {
                format!(" (rank: {:.2})", song.search_rank)
            } else {
                String::new()
            };

            println!("{}. {} {}", i + 1, song.title, rank_indicator);

            if verbose {
                if let Some(artist) = &song.artist {
                    println!("   🎤 Artist: {}", artist);
                }
                if let Some(album) = &song.album {
                    println!("   💿 Album: {}", album);
                }
                if let Some(genre) = &song.genre {
                    println!("   🎶 Genre: {}", genre);
                }
                if let Some(year) = song.year {
                    println!("   📅 Year: {}", year);
                }
                if song.is_favorite {
                    println!("   ⭐ Favorite");
                }
                if let Some(rating) = song.rating {
                    println!("   📊 Rating: {}/5", rating);
                }
                if let Some(ref tags) = song.tags {
                    if !tags.is_empty() {
                        println!("   🏷️  Tags: {}", tags.join(", "));
                    }
                }
                println!("   🆔 ID: {}", song.id);
                println!();
            } else {
                // Show basic info in compact format
                let mut details = Vec::new();
                if let Some(artist) = &song.artist {
                    details.push(format!("🎤 {}", artist));
                }
                if let Some(album) = &song.album {
                    details.push(format!("💿 {}", album));
                }
                if !details.is_empty() {
                    println!("   {}", details.join(" • "));
                }
            }
        }
    } else {
        // Search both songs and playlists
        let results = search_service.search_music(&search_query).await?;

        if results.results.is_empty() {
            println!("😔 No results found matching your search.");
            return Ok(());
        }

        println!(
            "🎵 Found {} results (page {} of {}):",
            results.results.len(),
            results.page,
            results.total_pages
        );
        println!("📊 Total matches: {}", results.total_count);
        println!("⏱️  Search time: {}ms", results.query_time_ms);
        println!();

        // Group results by type
        let mut by_type: HashMap<String, Vec<_>> = HashMap::new();
        for result in &results.results {
            by_type
                .entry(result.result_type.clone())
                .or_default()
                .push(result);
        }

        // Display songs first
        if let Some(songs) = by_type.get("song") {
            println!("🎵 Songs ({}):", songs.len());
            for (i, song) in songs.iter().enumerate() {
                let rank_indicator = if song.relevance_score > 0.0 {
                    format!(" (rank: {:.2})", song.relevance_score)
                } else {
                    String::new()
                };

                println!("  {}. {} {}", i + 1, song.title, rank_indicator);

                if verbose {
                    if let Some(subtitle) = &song.subtitle {
                        println!("     {}", subtitle);
                    }
                    if let Some(description) = &song.description {
                        println!("     📝 {}", description);
                    }
                    println!("     🆔 ID: {}", song.id);
                    println!();
                } else if let Some(subtitle) = &song.subtitle {
                    println!("     {}", subtitle);
                }
            }
            println!();
        }

        // Display playlists
        if let Some(playlists) = by_type.get("playlist") {
            println!("📋 Playlists ({}):", playlists.len());
            for (i, playlist) in playlists.iter().enumerate() {
                let rank_indicator = if playlist.relevance_score > 0.0 {
                    format!(" (rank: {:.2})", playlist.relevance_score)
                } else {
                    String::new()
                };

                println!("  {}. {} {}", i + 1, playlist.title, rank_indicator);

                if verbose {
                    if let Some(subtitle) = &playlist.subtitle {
                        println!("     {}", subtitle);
                    }
                    if let Some(description) = &playlist.description {
                        println!("     📝 {}", description);
                    }
                    println!("     🆔 ID: {}", playlist.id);
                    println!();
                } else if let Some(subtitle) = &playlist.subtitle {
                    println!("     {}", subtitle);
                }
            }
        }

        // Show suggestions if available
        if !results.suggestions.is_empty() {
            println!("💡 Suggestions:");
            for suggestion in &results.suggestions {
                println!("  • {} ({})", suggestion.text, suggestion.category);
            }
        }
    }

    Ok(())
}

/// Handle search suggestions command
pub async fn handle_suggest(
    service: &MusicService<'_>,
    query: String,
    limit: u32,
) -> Result<(), Box<dyn std::error::Error>> {
    println!("💡 Getting suggestions for: \"{}\"", query);

    // Get search service from database connection
    let search_service = SearchService::new(service.get_pool().clone());

    let suggestions = search_service.get_suggestions(&query).await?;

    if suggestions.is_empty() {
        println!("😔 No suggestions found for your query.");
        return Ok(());
    }

    println!("💡 Found {} suggestions:", suggestions.len());
    println!();

    // Group suggestions by category
    let mut by_category: HashMap<String, Vec<_>> = HashMap::new();
    for suggestion in &suggestions {
        by_category
            .entry(suggestion.category.clone())
            .or_default()
            .push(suggestion);
    }

    // Display suggestions by category
    let category_order = [
        "artist", "album", "genre", "title", "playlist", "tag", "other",
    ];

    for category in category_order {
        if let Some(suggestions) = by_category.get(category) {
            let category_emoji = match category {
                "artist" => "🎤",
                "album" => "💿",
                "genre" => "🎶",
                "title" => "🎵",
                "playlist" => "📋",
                "tag" => "🏷️",
                _ => "💡",
            };

            println!("{} {} suggestions:", category_emoji, category);

            for (i, suggestion) in suggestions.iter().take(limit as usize).enumerate() {
                let frequency_indicator = if suggestion.frequency > 1 {
                    format!(" ({})", suggestion.frequency)
                } else {
                    String::new()
                };

                println!("  {}. {}{}", i + 1, suggestion.text, frequency_indicator);
            }
            println!();
        }
    }

    // Show any remaining categories not in the predefined order
    for (category, suggestions) in by_category {
        if !category_order.contains(&category.as_str()) {
            println!("💡 {} suggestions:", category);
            for (i, suggestion) in suggestions.iter().take(limit as usize).enumerate() {
                let frequency_indicator = if suggestion.frequency > 1 {
                    format!(" ({})", suggestion.frequency)
                } else {
                    String::new()
                };

                println!("  {}. {}{}", i + 1, suggestion.text, frequency_indicator);
            }
            println!();
        }
    }

    Ok(())
}
