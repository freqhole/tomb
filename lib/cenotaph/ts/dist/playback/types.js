// structural (duck-typed) node shape cenotaph's default media playback
// backend needs - deliberately NOT imported from `@freqhole/midden`'s
// concrete wasm classes, same reasoning as `midden/node.ts`'s
// `CenotaphAcceptableNode`/`CenotaphBiStream`: this package should stay
// usable from any host whose node handle satisfies this shape, not just
// one that literally imports the wasm package. midden's real `MiddenNode`
// wasm class already satisfies this structurally, with no adapter needed.
export {};
