# LingJing Script Editor renderer

This is an external Reef renderer for ScriptProject JSON documents. It receives generic structured-data previews, decides whether the JSON matches its own document shape, and returns `notApplicable` for every other document.

```sh
npm install
npm run build
npm run install:renderer
```

The install step copies the self-contained renderer to `~/Library/Application Support/Reef/renderers/` and registers its manifest there.
