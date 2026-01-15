//! helper functions for search confidence scoring and user preferences

use crate::search::models::{MatchType, Suggestion};

/// determine if suggestion should be included based on confidence threshold
pub fn should_include_suggestion(suggestion: &Suggestion) -> bool {
    // determine match type from suggestion metadata
    let match_type = suggestion
        .metadata
        .as_ref()
        .and_then(|m| m.get("match_type"))
        .and_then(|mt| mt.as_str())
        .map(MatchType::from_str)
        .unwrap_or(MatchType::Name);

    suggestion.confidence >= match_type.threshold()
}

/// calculate confidence score based on query match quality
pub fn calculate_confidence(query: &str, match_text: &str, fts_rank: f32) -> f32 {
    let query_lower = query.to_lowercase();
    let match_lower = match_text.to_lowercase();

    if match_lower == query_lower {
        1.0 // exact match
    } else if match_lower.starts_with(&query_lower) {
        0.9 // prefix match
    } else if match_lower.contains(&query_lower) {
        0.7 // contains match
    } else {
        // fuzzy/FTS match - use normalized rank
        (0.5 + (fts_rank.abs() * 0.05)).min(0.6)
    }
}

/// apply user preference multiplier to ranking score
pub fn apply_user_preference_multiplier(
    base_score: f32,
    rating: Option<i32>,
    is_favorite: bool,
) -> f32 {
    let mut score = base_score;

    // apply rating multiplier
    if let Some(r) = rating {
        score *= match r {
            5 => 1.5,
            4 => 1.2,
            3 => 1.0,
            2 => 0.8,
            1 => 0.5,
            0 => 0.0, // filter out entirely (zero-star means "don't show me this")
            _ => 1.0,
        };
    }

    // apply favorite boost
    if is_favorite {
        score *= 1.3;
    }

    score
}

/// generate highlight with markdown bold for matched text
pub fn generate_highlight(text: &str, query: &str) -> String {
    let query_lower = query.to_lowercase();
    let text_lower = text.to_lowercase();

    if let Some(pos) = text_lower.find(&query_lower) {
        let mut result = String::new();
        result.push_str(&text[..pos]);
        result.push_str("**");
        result.push_str(&text[pos..pos + query.len()]);
        result.push_str("**");
        result.push_str(&text[pos + query.len()..]);
        result
    } else {
        text.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::models::SuggestionType;

    #[test]
    fn test_calculate_confidence() {
        // exact match
        assert_eq!(calculate_confidence("test", "test", -1.0), 1.0);

        // prefix match
        assert_eq!(calculate_confidence("test", "testing", -1.0), 0.9);

        // contains match
        assert_eq!(calculate_confidence("test", "atestb", -1.0), 0.7);

        // fuzzy match
        let conf = calculate_confidence("test", "something else", -0.5);
        assert!(conf >= 0.5 && conf <= 0.6);
    }

    #[test]
    fn test_user_preference_multiplier() {
        let base = 1.0;

        // ratings
        assert_eq!(apply_user_preference_multiplier(base, Some(5), false), 1.5);
        assert_eq!(apply_user_preference_multiplier(base, Some(4), false), 1.2);
        assert_eq!(apply_user_preference_multiplier(base, Some(3), false), 1.0);
        assert_eq!(apply_user_preference_multiplier(base, Some(2), false), 0.8);
        assert_eq!(apply_user_preference_multiplier(base, Some(1), false), 0.5);
        assert_eq!(apply_user_preference_multiplier(base, Some(0), false), 0.0);

        // favorite boost
        assert_eq!(apply_user_preference_multiplier(base, None, true), 1.3);

        // combined
        assert_eq!(
            apply_user_preference_multiplier(base, Some(5), true),
            1.5 * 1.3
        );
    }

    #[test]
    fn test_generate_highlight() {
        assert_eq!(
            generate_highlight("hello world", "world"),
            "hello **world**"
        );
        assert_eq!(generate_highlight("testing", "test"), "**test**ing");
        assert_eq!(generate_highlight("no match", "xyz"), "no match");
    }

    #[test]
    fn test_match_type_thresholds() {
        assert_eq!(MatchType::Title.threshold(), 0.0);
        assert_eq!(MatchType::Name.threshold(), 0.0);
        assert_eq!(MatchType::Filename.threshold(), 0.8);
        assert_eq!(MatchType::Lyrics.threshold(), 0.7);
        assert_eq!(MatchType::Metadata.threshold(), 0.8);
    }

    #[test]
    fn test_should_include_suggestion() {
        let mut suggestion = Suggestion {
            value: "test".to_string(),
            display: "test".to_string(),
            highlight: "test".to_string(),
            count: 1,
            suggestion_type: SuggestionType::Song,
            confidence: 0.9,
            metadata: Some(serde_json::json!({"match_type": "title"})),
            entity_id: "1".to_string(),
        };

        // title match with high confidence - should include
        assert!(should_include_suggestion(&suggestion));

        // filename match with low confidence - should exclude
        suggestion.confidence = 0.5;
        suggestion.metadata = Some(serde_json::json!({"match_type": "filename"}));
        assert!(!should_include_suggestion(&suggestion));

        // filename match with high confidence - should include
        suggestion.confidence = 0.85;
        assert!(should_include_suggestion(&suggestion));
    }
}
