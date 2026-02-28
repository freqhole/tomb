# api client codegen

generates a type-safe TypeScript API client from Rust route definitions. Rust types deriving `ZodSchema` are converted to Zod schemas, and route metadata registered via `inventory::submit!` becomes a typed route config. a hand-written client uses these to provide runtime validation on all API calls.

## usage

```bash
cd client-codegen
make all      # clean + generate + typecheck
make clean    # remove generated files
```

this runs the `client-codegen` binary which reads the `inventory`-collected route metadata from `server` and the `ZodSchema` types from `grimoire`, then outputs two generated files into `freqhole-api-client/src/codegen/`.

## structure

```
rust handler (handlers.rs)
  + inventory::submit! metadata
  |
  +---> axum router (mod.rs)
  |
  +---> codegen (generator.rs)
          |
          v
        generated typescript
          - schema.ts (zod schemas)
          - routes.ts (route config)
          |
          v
        hand-written client (client.ts)
          - dynamic fetch wrapper
```

```
client-codegen/
├── src/
│   ├── main.rs               # CLI entrypoint
│   └── generator.rs          # generates schema.ts + routes.ts
├── freqhole-api-client/
│   ├── src/
│   │   ├── client.ts         # hand-written dynamic fetch client
│   │   ├── codegen/          # generated (don't edit!)
│   │   │   ├── schema.ts     # zod schemas + inferred types
│   │   │   └── routes.ts     # route config (method, path, schemas)
│   │   ├── app.ts            # app-level client helpers
│   │   ├── auth.ts           # auth helpers
│   │   ├── favorites.ts      # favorites helpers
│   │   ├── music.ts          # music domain helpers
│   │   ├── utils.ts          # shared utilities
│   │   ├── webauthn.ts       # webauthn helpers
│   │   ├── index.ts          # package exports
│   │   ├── test.ts           # test runner
│   │   └── test/             # integration + coverage tests
│   │       ├── coverage.ts
│   │       ├── fixtures.ts
│   │       ├── integration.ts
│   │       └── stateful.ts
│   ├── package.json
│   └── tsconfig.json
├── Cargo.toml
├── Makefile
└── README.md
```

the `freqhole-api-client` package is linked into the frontend via `file:` reference in [/client/spume/package.json](/client/spume/package.json):

```json
"freqhole-api-client": "file:../../client-codegen/freqhole-api-client"
```

## how it works

1. Rust domain types in `grimoire` derive `ZodSchema` (via `zod_gen_derive`)
2. server route handlers include `inventory::submit!` blocks with route metadata
3. types are registered in `grimoire/src/api_registry/type_registry.rs`
4. `client-codegen` binary collects all of this at compile time and generates:
   - **schema.ts** — Zod schemas with inferred TypeScript types
   - **routes.ts** — route config mapping route names to method, path, and schemas
5. the hand-written `client.ts` uses these to make typed, validated API calls

## adding a new route's types to codegen

after defining types in grimoire and adding the route handler in server (see `docs/HOW_TO_ADD_FEATURES.md`):

1. ensure request/response types derive `ZodSchema`
2. register them in `grimoire/src/api_registry/type_registry.rs`
3. run `cd client-codegen && make all`

the generator validates all route types are registered and fails with clear errors if anything is missing.
