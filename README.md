# Pro Scrollshot

Chrome extension for creating full-page screenshots and copying them directly to the clipboard.

## What it does

`Pro Scrollshot` captures the current page in multiple viewport-sized slices, stitches them into a single PNG, and writes the result to the clipboard.

The extension is built for pages that are longer than the visible viewport and hides fixed or sticky UI elements during capture to reduce duplicated overlays in the final image.

## Features

- Full-page screenshot capture for `http`, `https`, and `file` pages
- Automatic scrolling and segmented capture
- Background stitching with `OffscreenCanvas`
- Clipboard copy as PNG
- Hiding of fixed and sticky elements during capture
- Keyboard shortcut support via `Ctrl+Shift+S`

## Tech Stack

- Chrome Extension Manifest V3
- Service worker background script
- Content script page instrumentation
- Canvas-based image stitching

## How it works

1. The extension injects a content script into the active tab.
2. The content script measures the page and builds a capture plan.
3. The page is scrolled segment by segment and each viewport is captured.
4. The background service worker stitches all captured PNG slices into one image.
5. The final PNG is sent back to the active tab and copied to the clipboard.

## Project Structure

- `manifest.json`: extension manifest and permissions
- `background.js`: capture orchestration and image stitching
- `page_capture.js`: page measurement, scrolling, and clipboard handoff
- `icon.png`: extension icon

## Installation

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click `Load unpacked`
4. Select this project folder

## Usage

- Click the extension icon
- Or use `Ctrl+Shift+S`

After a short capture process, the full-page screenshot is copied to the clipboard.

## Limitations

- Works only on capturable pages such as `http`, `https`, and `file`
- Very complex pages with animations, lazy loading, or canvas-heavy rendering may require tuning
- Clipboard behavior can depend on browser security context and the active tab state

## Why this project matters

This project demonstrates practical browser extension engineering with DOM measurement, asynchronous capture pipelines, image processing, and clipboard integration.
