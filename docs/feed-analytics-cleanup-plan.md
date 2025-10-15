# Feed Analytics Cleanup Plan

## 🚨 CRITICAL RULES - NEVER FORGET 🚨

1. **NO EMOJIS**: Keep code comments, logs, and ui display text lowercase (proper nouns and acronyms can be uppercase)
2. **File Size Limit**: Maximum ~500 lines per file
3. **Dark Theme Design**: UI must use dark theme with primary colors black, white, and magenta accents. Use other colors sparingly. Avoid borders and no rounded corner border radius (border-radius: 0)
4. **Modular Architecture**: Use solidjs hooks for reactive logic, leverage createResource/produce/mutate for optimal reactivity, keep components presentational, central context providers for state, avoid prop drilling
5. **Data Validation**: Use zod for all json api data parsing and validation (existing pattern)
6. **Code Reuse**: Leverage existing lib code and hooks where possible, build new generic utilities in `client/js/src/lib/`
7. **Domain Separation**: Keep admin logic generic in views/admin/, music-specific code in lib/music/ and hooks/music/
8. **Generic Library Focus**: Build reusable patterns in `client/js/src/lib/`
9. **LEGACY CODE MARKING**: When implementing new better patterns, clearly mark old code as `@deprecated`, `// LEGACY:`, or `// TODO: migrate to X` so we know which system to use and can clean up later. This prevents confusion between "this is broken and needs debugging now" vs "this works but should be migrated as part of the plan"
10. **MAXIMUM CODE REUSE**: Reuse existing song edit forms, bulk operations, filtering APIs, and modal systems.

## Current Crisis State

### What We Broke Today
- **Working Feed**: We destroyed a working social feed while trying to add album addition events
- **Performance**: Feed queries are now extremely slow (complex aggregation on 4000+ events)
- **Over-Aggregation**: Changed from individual items to weekly/daily summaries hiding actual content
- **User Attribution**: Added bad fallback UUID causing null usernames (partially fixed)
- **Migration Chaos**: Multiple migration rollbacks, schema changes mid-implementation

### What We're Trying to Achieve (The Original Goal)
- **Album Addition Events**: Show "edward added Devil's Triangle album" in feed
- **Smart Aggregation**: Album plays show as single album card, not 12 individual song entries
- **Real-time Feel**: Recent activity appears quickly, older activity aggregates over time
- **Clean UI**: One card per collection (album/playlist), individual songs only when played solo

### Core Misunderstanding
The feed should NOT show every individual song play. When a user clicks "play album" and listens to 12 songs, we want ONE album card saying "edward played Devil's Triangle" not 12 song cards.

## Root Cause Analysis

### The Data Problem
```sql
-- Current reality in database:
play | song | 3990 events | 19+ hours old  -- Individual song plays
add  | album| 2 events     | 30 mins old   -- Album additions
```

**Why 3990 song plays?** This suggests the frontend is emitting individual `play` events for every song rather than collection-level events. This is the core architectural problem.

### The SQL Function Problem
The current `get_social_feed_items()` function is trying to:
1. Take 3990 individual song events
2. Magically group them into album cards retroactively
3. Do complex temporal aggregation with multiple CTEs
4. Handle both old and new patterns simultaneously

This is fundamentally the wrong approach.

### The Event Emission Problem
Frontend should emit:
- `play` + `domain_type: album` + `domain_ids: [song1, song2, ...]` when user plays album
- `play` + `domain_type: song` + `media_blob_id: song1` when user plays individual song

Not:
- 12 individual `play` + `domain_type: song` events when album is played

## Recovery Plan

### Phase 1: Stop the Bleeding (Immediate)
1. **Revert to Last Working Feed**
   - Find the last known working migration (probably 077 or 078)
   - Create new migration that restores simple, fast feed query
   - Accept that album additions won't show temporarily

2. **Fix Download Job User Attribution**
   - Complete the user_id fixes for download jobs (partially done)
   - Prevent future null username issues

3. **Data Cleanup**
   - Identify and clean up any remaining bad analytics events
   - Ensure all events have valid user_ids

### Phase 2: Fix Event Architecture (Core Fix)
1. **Audit Frontend Event Emission**
   - Review how collection plays are currently tracked
   - Ensure album/playlist plays emit collection-level events
   - Individual song plays should only happen when user plays single song

2. **Analytics Service Fixes**
   - Fix the album addition analytics to use proper user context
   - Remove fallback UUID pattern
   - Implement proper error handling for missing user context

3. **Event Type Audit**
   - Review existing 4000+ events to understand why so many individual songs
   - Determine if historical data needs correction or is acceptable

### Phase 3: Simple Feed Implementation (Stable Foundation)
1. **Simple SQL Function**
   - Create much simpler feed query without complex aggregation
   - Focus on recent events with basic chronological ordering
   - Minimal grouping logic - prefer showing too much over missing content

2. **Add Album Events Gradually**
   - Once simple feed works, add album addition events incrementally
   - Test each change thoroughly before adding complexity

3. **Progressive Enhancement**
   - Add aggregation features one at a time
   - Each feature should be optional/toggleable for debugging

### Phase 4: Smart Aggregation (Future)
1. **Collection Event Detection**
   - Implement logic to detect when multiple song plays = album play
   - Use timing, sequence, and user session data
   - Create collection cards retroactively from song data

2. **Temporal Grouping**
   - Implement sensible time-based grouping
   - Recent events (< 1 hour): show individually
   - Older events (> 1 day): group by collection/session
   - Much older (> 1 week): summarize by time period

## Implementation Guidelines

### Database Design Principles
- **Keep it Simple**: Avoid complex CTEs and aggregations in main query
- **Use Indexes**: Ensure all feed queries use proper indexes
- **Limit Data**: Always use LIMIT and reasonable time windows
- **Pagination**: Proper offset/limit for large datasets

### Event Design Principles
- **Collection-First**: Default to collection-level events when possible
- **User Context Required**: Never create events without valid user_id
- **Graceful Degradation**: Skip analytics rather than create bad data
- **Clear Semantics**: Event types should map clearly to UI actions

### UI Design Principles
- **One Card Per Action**: Album play = one album card, not 12 song cards
- **Progressive Loading**: Show recent content fast, load more as needed
- **Error Boundaries**: Handle missing/malformed data gracefully
- **Performance First**: Prioritize fast loading over perfect aggregation

## Success Criteria

### Must Have (Recovery)
- [ ] Feed loads in < 500ms
- [ ] Shows recent user activity correctly
- [ ] No null usernames or bad data
- [ ] No complex aggregation breaking performance

### Should Have (Enhancement)
- [ ] Album addition events appear in feed
- [ ] Collection plays show as single cards
- [ ] Reasonable temporal grouping
- [ ] Pagination works properly

### Could Have (Future)
- [ ] Smart retroactive collection detection
- [ ] Advanced temporal aggregation
- [ ] Real-time updates
- [ ] Cross-user social features

## Next Session Priorities

1. **Immediate Recovery**
   - Revert to working feed migration
   - Complete download job user_id fixes
   - Test basic feed functionality

2. **Event Investigation**
   - Analyze why 3990 song events exist
   - Review frontend collection play implementation
   - Plan event emission fixes

3. **Simple Feed Redesign**
   - Design minimal SQL function for feed
   - Focus on recent events with basic chronological order
   - Add album events only after stable base

## Lessons Learned

1. **Don't Fix What Works**: The feed was working - we should have added album events incrementally
2. **Data-Driven Debugging**: Should have analyzed the 3990 events before changing SQL
3. **Migration Strategy**: Should have created new migrations rather than modifying existing ones
4. **Performance First**: Complex aggregation should be the last step, not the first
5. **User Context Critical**: Never implement fallback patterns that create bad data

## Technical Debt to Address

1. **Analytics Service Error Handling**: Remove fallback UUID pattern
2. **Event Emission Audit**: Ensure frontend emits proper collection events
3. **Migration Cleanup**: Remove failed migration attempts and restore clean state
4. **Performance Optimization**: Add proper indexes for feed queries
5. **Data Validation**: Add constraints to prevent future bad event data
