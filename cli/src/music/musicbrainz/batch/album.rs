//! Album-centric processing logic for MusicBrainz batch operations

use super::types::{AlbumContext, AlbumGroup, AlbumProcessingPriority, AlbumProcessingResult};
use super::utils::{
    analyze_album_completeness_from_songs, analyze_metadata_changes, calculate_string_similarity,
    select_best_release, store_enrichment_data, store_enrichment_data_with_album_context,
    store_no_match_result,
};
use grimoire::music::{repository::MusicRepository, Song};
use grimoire::musicbrainz::{
    models::Track, MusicBrainzConfig, MusicBrainzMatch, MusicBrainzService, Release,
};
use std::collections::HashMap;
use std::sync::Arc;

/// group songs by album for batch processing
pub fn group_songs_by_album(songs: Vec<Song>) -> Vec<AlbumGroup> {
    let mut album_map: HashMap<(String, String), Vec<Song>> = HashMap::new();

    // group songs by (artist, album) pairs
    for song in songs {
        if let (Some(artist), Some(album)) = (song.artist.clone(), song.album.clone()) {
            let key = (artist.to_lowercase(), album.to_lowercase());
            album_map.entry(key).or_insert_with(Vec::new).push(song);
        }
    }

    // convert to AlbumGroup structures
    album_map
        .into_iter()
        .map(|((_artist, _album), songs)| {
            let processing_priority = match songs.len() {
                1 => AlbumProcessingPriority::SingleSong,
                2..=4 => AlbumProcessingPriority::FewTracks,
                5..=9 => AlbumProcessingPriority::PartialAlbum,
                _ => AlbumProcessingPriority::CompleteAlbum,
            };

            AlbumGroup {
                artist: songs[0].artist.clone().unwrap_or_default(),
                album: songs[0].album.clone().unwrap_or_default(),
                songs,
                musicbrainz_release: None,
                completion_percentage: 0.0,
                is_complete_album: false,
                processing_priority,
            }
        })
        .collect()
}

/// process an entire album group using album-first methodology
pub async fn process_album_group(
    service: &MusicBrainzService,
    repository: &Arc<MusicRepository>,
    album_group: &AlbumGroup,
    force_rescan: bool,
    rescan_updated: bool,
    dry_run: bool,
    auto_apply: bool,
    threshold: f32,
    config: &MusicBrainzConfig,
) -> Result<AlbumProcessingResult, Box<dyn std::error::Error>> {
    let mut result = AlbumProcessingResult {
        processed_count: 0,
        scanned_count: 0,
        updated_count: 0,
        skipped_count: 0,
    };

    println!(
        "   🎵 processing album: {} - {}",
        album_group.artist, album_group.album
    );

    // first, try to find the complete album on musicbrainz
    if let Some(artist) = album_group.songs.first().and_then(|s| s.artist.as_ref()) {
        if let Some(album) = album_group.songs.first().and_then(|s| s.album.as_ref()) {
            println!("   🔍 searching for complete album release...");

            // search for the complete album release
            match service.search_for_album(artist, album).await {
                Ok(releases) if !releases.is_empty() => {
                    // use smart release selection based on config preferences
                    let best_release =
                        select_best_release(&releases, config).unwrap_or(&releases[0]); // fallback to first if scoring fails

                    println!(
                        "   ✓ found {} album releases, selected: {} ({} score, {} {})",
                        releases.len(),
                        best_release.title,
                        best_release.score.unwrap_or(0),
                        best_release.country.as_deref().unwrap_or("?"),
                        best_release.status.as_deref().unwrap_or("?")
                    );

                    // get full release details with track info
                    println!("   📀 fetching full release data for: {}", best_release.id);
                    match service.get_release(&best_release.id.to_string()).await {
                        Ok(full_release) => {
                            println!(
                                "   ✅ got full release data, processing with album tracks..."
                            );
                            return process_album_with_release_data(
                                repository,
                                album_group,
                                &full_release,
                                force_rescan,
                                rescan_updated,
                                dry_run,
                                auto_apply,
                                threshold,
                                config,
                            )
                            .await;
                        }
                        Err(e) => {
                            println!("   ❌ failed to get release details: {}", e);
                            println!("   🔄 falling back to individual song lookup...");
                        }
                    }
                }
                Ok(_) => {
                    println!("   ❌ no album releases found for: {} - {}", artist, album);
                    println!("   🔄 falling back to individual song lookup...");
                }
                Err(e) => {
                    println!("   ❌ album search failed: {}", e);
                    println!("   🔄 falling back to individual song lookup...");
                }
            }

            // fallback to individual song processing with album context
            println!("   🎵 using individual song API calls as fallback...");
            return process_album_fallback(
                service,
                repository,
                album_group,
                force_rescan,
                rescan_updated,
                dry_run,
                auto_apply,
                threshold,
                config,
            )
            .await;
        }
    }

    Ok(result)
}

/// process album group using complete musicbrainz release data
async fn process_album_with_release_data(
    repository: &Arc<MusicRepository>,
    album_group: &AlbumGroup,
    release: &Release,
    force_rescan: bool,
    rescan_updated: bool,
    dry_run: bool,
    auto_apply: bool,
    threshold: f32,
    config: &MusicBrainzConfig,
) -> Result<AlbumProcessingResult, Box<dyn std::error::Error>> {
    let mut result = AlbumProcessingResult {
        processed_count: 0,
        scanned_count: 0,
        updated_count: 0,
        skipped_count: 0,
    };

    println!("   🎵 processing with full release data: {}", release.title);

    // extract all tracks from all media
    let mut mb_tracks = Vec::new();
    if let Some(media) = &release.media {
        for medium in media {
            if let Some(tracks) = &medium.tracks {
                for track in tracks {
                    mb_tracks.push((medium.position.unwrap_or(1), track));
                }
            }
        }
    }

    println!("   📀 found {} tracks in release", mb_tracks.len());

    // match our songs to musicbrainz tracks
    for song in &album_group.songs {
        // check if already has musicbrainz data and we're not forcing rescan
        if !force_rescan && song.metadata.get("musicbrainz").is_some() {
            if !rescan_updated {
                println!(
                    "   ⏭️  {} - already has musicbrainz data, skipping",
                    song.title
                );
                result.skipped_count += 1;
                result.processed_count += 1;
                continue;
            }
        }

        // find best matching track
        let mut best_match: Option<(f32, &Track)> = None;

        for (_disc_num, track) in &mb_tracks {
            let similarity = calculate_string_similarity(&song.title, &track.title);

            if let Some((current_score, _)) = best_match {
                if similarity > current_score {
                    best_match = Some((similarity, track));
                }
            } else if similarity > 0.6 {
                // minimum threshold
                best_match = Some((similarity, track));
            }
        }

        if let Some((confidence, matched_track)) = best_match {
            println!(
                "   ✓ {} -> {} (similarity: {:.1}%)",
                song.title,
                matched_track.title,
                confidence * 100.0
            );

            // create album context
            let album_context = Some(AlbumContext {
                likely_album: album_group.album.clone(),
                likely_artist: album_group.artist.clone(),
                total_tracks_found: mb_tracks.len(),
                track_sequence_confidence: confidence,
            });

            // create a synthetic musicbrainz match from the track data
            if let Some(recording) = &matched_track.recording {
                let mb_match = MusicBrainzMatch {
                    recording: recording.clone(),
                    release: Some(release.clone()),
                    confidence_score: confidence,
                    match_reasons: vec![
                        "album_release_match".to_string(),
                        "track_title_similarity".to_string(),
                    ],
                };

                let enrichment = analyze_metadata_changes(song, &mb_match, album_context.as_ref());

                if !dry_run {
                    store_enrichment_data(repository, &song.id, &enrichment, &[mb_match]).await?;
                }

                if auto_apply
                    && enrichment.confidence_score >= threshold
                    && !enrichment.review_needed
                {
                    let enhancement_count = enrichment.proposed_changes.len();
                    if enhancement_count > 0 && !dry_run {
                        // TODO: apply changes
                        result.updated_count += 1;
                    }
                }

                result.scanned_count += 1;
            } else {
                println!(
                    "   ⚠️  {} - matched track has no recording data",
                    song.title
                );
                result.skipped_count += 1;
            }
        } else {
            println!("   ❌ {} - no suitable track match found", song.title);

            if !dry_run {
                store_no_match_result(repository, &song.id).await?;
            }

            result.skipped_count += 1;
        }

        result.processed_count += 1;
    }

    Ok(result)
}

/// fallback to individual song processing with album context
async fn process_album_fallback(
    service: &MusicBrainzService,
    repository: &Arc<MusicRepository>,
    album_group: &AlbumGroup,
    force_rescan: bool,
    rescan_updated: bool,
    dry_run: bool,
    auto_apply: bool,
    threshold: f32,
    config: &MusicBrainzConfig,
) -> Result<AlbumProcessingResult, Box<dyn std::error::Error>> {
    let mut result = AlbumProcessingResult {
        processed_count: 0,
        scanned_count: 0,
        updated_count: 0,
        skipped_count: 0,
    };

    // collect all matches for album completeness analysis
    let mut all_song_matches = Vec::new();

    for song in &album_group.songs {
        // check if already has musicbrainz data and we're not forcing rescan
        if !force_rescan && song.metadata.get("musicbrainz").is_some() {
            if !rescan_updated {
                println!(
                    "   ⏭️  {} - already has musicbrainz data, skipping",
                    song.title
                );
                result.skipped_count += 1;
                result.processed_count += 1;
                continue;
            }
        }

        // search for individual song with album context
        let matches = service.search_for_song(song).await?;
        result.scanned_count += 1;

        if matches.is_empty() {
            println!("   ❌ {} - no musicbrainz matches found", song.title);

            if !dry_run {
                store_no_match_result(repository, &song.id).await?;
            }

            result.skipped_count += 1;
        } else {
            let best_match = &matches[0];
            println!(
                "   ✓ {} - found match: {} (confidence: {:.1}%)",
                song.title,
                best_match.recording.title,
                best_match.confidence_score * 100.0
            );

            // store song and its matches for album analysis
            all_song_matches.push((song, matches.clone()));
        }

        result.processed_count += 1;
    }

    // perform album completeness analysis
    let album_analysis = analyze_album_completeness_from_songs(&all_song_matches, config);

    println!(
        "   📊 album analysis: {:.1}% complete ({}/{} tracks matched)",
        album_analysis.completion_percentage,
        album_analysis.matched_tracks,
        album_group.songs.len()
    );

    // now process and store enrichment data with album context
    for (song, matches) in all_song_matches {
        let best_match = &matches[0];

        // create enhanced album context with completeness data
        let album_context = Some(AlbumContext {
            likely_album: album_group.album.clone(),
            likely_artist: album_group.artist.clone(),
            total_tracks_found: album_group.songs.len(),
            track_sequence_confidence: album_analysis.completion_percentage / 100.0,
        });

        let mut enrichment = analyze_metadata_changes(song, best_match, album_context.as_ref());

        // boost confidence for complete albums
        if album_analysis.completion_percentage >= config.album_completion_threshold {
            enrichment.confidence_score *= album_analysis.confidence_boost;
            println!(
                "   ⬆️  {} - confidence boosted to {:.1}% (complete album)",
                song.title,
                enrichment.confidence_score * 100.0
            );
        }

        // store enrichment data with album analysis
        store_enrichment_data_with_album_context(
            repository,
            &song.id,
            &enrichment,
            &matches,
            &album_analysis,
        )
        .await?;

        if auto_apply && enrichment.confidence_score >= threshold && !enrichment.review_needed {
            let enhancement_count = enrichment.proposed_changes.len();
            if enhancement_count > 0 && !dry_run {
                // TODO: apply changes
                result.updated_count += 1;
                println!("   🤖 auto-applied {} enhancements", enhancement_count);
            } else if dry_run {
                println!(
                    "   💾 cached {} potential changes for web UI",
                    enhancement_count
                );
            }
        } else {
            println!("   💾 cached enrichment data for web UI review");
        }

        result.processed_count += 1;
    }

    Ok(result)
}
