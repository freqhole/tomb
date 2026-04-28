# freqhole.net

astro + starlight site for [freqhole](https://freqhole.net), with an embedded
scroll-coach demo of the spume client rendered as a `<freqhole-coach-demo>`
web component.

## build + dev

from this directory:

| command           | what it does                                                              |
| :---------------- | :------------------------------------------------------------------------ |
| `npm install`     | install astro + starlight deps                                            |
| `npm run dev`     | astro dev server at <http://localhost:4321> (does NOT rebuild coach demo) |
| `npm run build`   | build the coach-demo bundle (via `prebuild`) + the astro site to `dist/`  |
| `npm run preview` | preview the production build locally                                      |

`npm run build` is the single command for the entire site. behind the scenes
the `prebuild` script runs `npm --prefix ../client/spume run build:coach:wc`,
which emits `freqhole-coach-demo.js` directly into `public/demo/`. astro then
picks it up and copies it into `dist/demo/` as part of the normal build.

the coach-demo bundle is git-ignored (rebuilt on every deploy). to refresh it
for local `npm run dev`, run `make build-coach-demo` (or just `npm run build`
once).

## structure

```
.
├── public/
│   └── demo/
│       └── freqhole-coach-demo.js   # built artifact (git-ignored)
├── src/
│   ├── assets/
│   ├── components/
│   │   └── ScrollCoach.astro       # embeds the <freqhole-coach-demo>
│   └── content/
│       └── docs/                   # starlight content (.md / .mdx)
├── astro.config.mjs
├── Makefile                        # convenience targets (delegates to npm)
├── package.json
└── tsconfig.json
```

## learn more

- [starlight docs](https://starlight.astro.build/)
- [astro docs](https://docs.astro.build)
