# Sync UI Components

Modular web components for the media blob sync system built with Solid.js.

## Components

### `<sync-status>`

Shows current sync state with colored indicator and optional progress.

```html
<sync-status
  status="in_progress"
  show-text="true"
  show-progress="true"
  items-synced="45"
  total-items="100"
></sync-status>
```

### `<sync-progress>`

Detailed progress bar with ETA and batch information.

```html
<sync-progress
  progress="75"
  items-synced="750"
  total-items="1000"
  show-eta="true"
  animated="true"
></sync-progress>
```

### `<sync-controls>`

Control panel with start/stop/pause/resume buttons.

```html
<sync-controls
  status="idle"
  show-force-sync="true"
  show-pause-resume="true"
></sync-controls>
```

### `<sync-demo>`

Complete interactive demo with live API integration.

```html
<sync-demo
  api-base-url="http://localhost:8080"
  client-id="my-client"
  auto-connect="true"
></sync-demo>
```

## Usage

1. Build components: `npm run build`
2. Include in HTML: `<script type="module" src="./dist/all-components.js"></script>`
3. Use components as standard HTML elements

## Demo

The sync demo is integrated into the build process:

- Build: `npm run build:web-components`
- Open: `dist/sync-demo-standalone.html` in browser
- Or use individual components with `dist/all-components.js`

## Integration

Components emit custom events and can be controlled via JavaScript:

```js
document.querySelector("sync-controls").addEventListener("sync-start", () => {
  // Handle sync start
});
```
