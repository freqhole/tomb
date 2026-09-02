//! shared "cluster by parent, then order children by their fixed
//! position" ordering helper - e.g. music's album+disc+track grouping
//! and video's series+season+episode grouping are the same shape: pick a
//! primary key that keeps parent rows contiguous, then always break ties
//! with the children's fixed position within that parent. factored out
//! here so a future domain with the same shape doesn't reinvent it.

use sea_query::{Order, SelectStatement, SimpleExpr};

/// applies `primary` as the main ORDER BY key, followed by `tie_breakers`
/// in order - `tie_breakers` should always run, regardless of which
/// primary key was chosen, so children of the same parent keep a stable
/// relative order (e.g. disc/track number, season/episode number).
pub fn apply_clustered_order<P, T>(
    query: &mut SelectStatement,
    primary: (P, Order),
    tie_breakers: impl IntoIterator<Item = (T, Order)>,
) where
    P: Into<SimpleExpr>,
    T: Into<SimpleExpr>,
{
    query.order_by_expr(primary.0.into(), primary.1);
    apply_tie_breakers(query, tie_breakers);
}

/// appends fixed child-position tie-breakers after whatever ordering a
/// caller already applied - split out from `apply_clustered_order` so
/// callers that pick their primary key via a per-branch match (rather
/// than a single computed expression) can still share the tie-breaker
/// step, e.g. query_songs' per-arm album/artist ordering.
pub fn apply_tie_breakers<T>(
    query: &mut SelectStatement,
    tie_breakers: impl IntoIterator<Item = (T, Order)>,
) where
    T: Into<SimpleExpr>,
{
    for (expr, direction) in tie_breakers {
        query.order_by_expr(expr.into(), direction);
    }
}
