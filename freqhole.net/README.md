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

## generated release assets

`npm run gen:release-assets` copies the maintained
[Pi installer](../scripts/raspberry-pi/setup.sh) to [public/setup.sh](public/setup.sh)
and stamps docs frontmatter from git history. the root version command runs this
inside the changesets action, so both updates are committed with version bumps
on the version PR branch. page dates require full git history and skip bot-only
changes; the home page deliberately has no date byline.

site builds also sync the installer before Astro copies public assets, so a deploy
does not have to wait for the next version PR to serve the latest script.
edit the source installer, not the public copy. `npm run check:installer` and
`npm run check:dates` detect stale generated files.

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
