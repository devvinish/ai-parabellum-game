# AI Parabellum game

A 3D browser war game between humans and AI, built for [AI Parabellum](https://aiparabellum.com).

This repository holds the game files and its 3D assets, served with GitHub Pages.

- **Campaign:** `play.html` plays six missions: Fallen City, Desert Air Base, Frozen Dam, Container Port, Server Valley and The Core. You pilot a captured striker mech, overheat AI mechs, and hijack them. `play.html?level=desert` (or `dam`, `port`, `valley`, `core`) opens a mission directly. Fallen City also has a Survival mode.
- **Look test:** `index.html` is the cinematic look test of the same scene.
- **Assets:** `assets/` holds compressed models, textures and skies. Each comes under its own license, listed in [CREDITS.md](CREDITS.md).
- **Code:** three.js from jsDelivr, no build step. `js/core.js` holds rendering and effects, `js/audio.js` synthesised sound, `js/levels.js` the six missions (layout, lighting, weather, waves), `js/game.js` the game itself.
