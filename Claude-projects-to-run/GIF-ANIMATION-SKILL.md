# Animated GIF Screenshot Skill

A technique for creating animated demo GIFs of web applications using Playwright and ImageMagick.

## Prerequisites

```bash
npm install playwright
npx playwright install chromium
apt-get install imagemagick  # or brew install imagemagick on Mac
```

## Quick Start

### 1. Create the Screenshot Script

```javascript
// animation.mjs
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });

// Optional: Mock API responses
await page.route('**/api/some-endpoint', async route => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ /* mock data */ })
  });
});

await page.goto('http://localhost:3000');
await page.waitForTimeout(1000);

// Frame 1: Initial state
await page.screenshot({ path: 'frame1.png' });

// Frame 2: After some interaction
await page.click('#some-button');
await page.waitForTimeout(500);
await page.screenshot({ path: 'frame2.png' });

// Frame 3: Toggle dark mode
await page.evaluate(() => document.body.classList.add('dark'));
await page.waitForTimeout(300);
await page.screenshot({ path: 'frame3.png' });

await browser.close();
console.log('Frames captured!');
```

### 2. Run the Script

```bash
node animation.mjs
```

### 3. Create the GIF

```bash
convert -delay 150 -loop 0 frame*.png animation.gif
```

## Key Options

| Option | Description | Example |
|--------|-------------|---------|
| `-delay N` | Delay between frames (N/100 seconds) | `-delay 150` = 1.5s |
| `-loop N` | Loop count (0 = infinite) | `-loop 0` |
| `-resize WxH` | Resize frames | `-resize 800x600` |
| `-colors N` | Reduce colors for smaller file | `-colors 256` |

## Frame Timing Guide

| Delay Value | Duration | Use Case |
|-------------|----------|----------|
| 50 | 0.5s | Fast transitions |
| 100 | 1.0s | Normal pace |
| 150 | 1.5s | Readable text |
| 200 | 2.0s | Complex UI |
| 300 | 3.0s | Form inputs |

## Advanced Techniques

### Mock API Responses

```javascript
await page.route('**/api/user', async route => {
  await route.fulfill({
    status: 200,
    body: JSON.stringify({ name: 'Demo User', role: 'admin' })
  });
});
```

### Trigger JavaScript Events

```javascript
await page.evaluate(() => {
  const toggle = document.getElementById('darkModeToggle');
  toggle.checked = true;
  toggle.dispatchEvent(new Event('change'));
});
```

### Scroll to Elements

```javascript
await page.evaluate(() => {
  document.querySelector('.feature-section').scrollIntoView({
    behavior: 'instant',
    block: 'center'
  });
});
```

### Full Page Screenshot

```javascript
await page.screenshot({ path: 'full.png', fullPage: true });
```

### Clip Specific Region

```javascript
await page.screenshot({
  path: 'clipped.png',
  clip: { x: 0, y: 0, width: 800, height: 400 }
});
```

## Optimization Tips

### Reduce File Size

```bash
# Reduce colors
convert -delay 150 -loop 0 -colors 128 frame*.png small.gif

# Resize
convert -delay 150 -loop 0 -resize 50% frame*.png half-size.gif

# Both
convert -delay 150 -loop 0 -colors 128 -resize 800x600 frame*.png optimized.gif
```

### Add Labels/Annotations

```bash
convert frame1.png -gravity South -annotate +0+10 'Step 1: Login' labeled1.png
```

## Example: Dark/Light Mode Demo

```javascript
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });

await page.goto('http://localhost:3000');
await page.waitForTimeout(1000);

// Light mode
await page.screenshot({ path: 'frame1.png' });

// Dark mode
await page.evaluate(() => document.body.classList.add('dark'));
await page.waitForTimeout(500);
await page.screenshot({ path: 'frame2.png' });

// Back to light
await page.evaluate(() => document.body.classList.remove('dark'));
await page.waitForTimeout(500);
await page.screenshot({ path: 'frame3.png' });

await browser.close();
```

Then:

```bash
convert -delay 100 -loop 0 frame1.png frame2.png frame3.png theme-toggle.gif
```

## Cleanup Script

```bash
#!/bin/bash
rm -f frame*.png animation.gif
git restore package.json package-lock.json 2>/dev/null
echo "Cleanup complete"
```

---

**Created:** 2025-12-23
**Use Cases:** PRs, documentation, feature demos, bug reports
