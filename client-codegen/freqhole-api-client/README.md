# @freqhole/api-client

type-safe TypeScript client for freqhole APIs.

this package wraps generated route + schema metadata with a small runtime client so requests are validated and typed on both input and output.

## install

```bash
npm i @freqhole/api-client
```

for local monorepo usage, this repo usually links it by file path.

## quick start

```ts
import { createHttpClient } from "@freqhole/api-client";

const api = createHttpClient({
  baseUrl: "http://localhost:4315",
});

const songs = await api.music.listSongs({
  query: { limit: 25, offset: 0 },
});

if (songs.success) {
  console.log(songs.data.songs.length);
}
```

## package structure

- `src/codegen/schema.ts`: generated zod schemas
- `src/codegen/routes.ts`: generated route metadata
- `src/*.ts`: hand-written helpers and client adapters

avoid editing files under `src/codegen/` directly.

## development notes

if you are working in this repo and need to regenerate types/routes, run codegen from `client-codegen/`.

the full generator workflow and architecture docs live in `client-codegen/README.md`.

---

made with 💖 in NYC
