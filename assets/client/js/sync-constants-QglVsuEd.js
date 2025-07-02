import{e as s}from"./types-DDODKsJP.js";//! Sync constants and enums
//!
//! This module provides runtime constants that work with both TypeScript
//! type checking and Zod validation. This replaces the problematic mixing
//! of Zod enums with TypeScript enum usage patterns.
const e={Never:"Never",Idle:"Idle",InProgress:"InProgress",Syncing:"Syncing",Complete:"Complete",Failed:"Failed",Error:"Error",Paused:"Paused"},t=s([e.Never,e.Idle,e.InProgress,e.Syncing,e.Complete,e.Failed,e.Error,e.Paused]),c={Started:"sync:started",Progress:"sync:progress",BatchCompleted:"sync:batch-completed",Completed:"sync:completed",Failed:"sync:failed",Paused:"sync:paused",Resumed:"sync:resumed",ConflictDetected:"sync:conflict-detected",ConflictResolved:"sync:conflict-resolved",ConnectionChanged:"sync:connection-changed",ItemsReceived:"sync:items-received",ItemsProcessed:"sync:items-processed"},o={Manual:"manual",LocalWins:"keep_local",RemoteWins:"keep_server",Merge:"merge",Skip:"skip"},a={Version:"version",Deletion:"deletion",Metadata:"metadata"},r={Low:"low",Normal:"normal",High:"high",Urgent:"urgent"},d={Create:"create",Update:"update",Delete:"delete"};export{o as C,d as O,e as S,c as a,t as b,a as c,r as d};
//# sourceMappingURL=sync-constants-QglVsuEd.js.map
