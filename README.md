# ABC Design Tokens

Design tokens exported from Figma (W3C DTCG format), compiled to a single CSS custom properties file for use in the EDS site.

## Requirements

- Node.js 18+

## Setup

```bash
npm install
```

## Building

```bash
npm run build
```

Outputs `dist/tokens.css`.

## Using in the EDS global stylesheet

```css
@import './path/to/abc-design-tokens/dist/tokens.css';
```

All tokens are available as CSS custom properties on `:root`.

## Token categories

| Prefix | Example | Description |
|---|---|---|
| `--color-*` | `--color-primary-default` | Semantic + primitive colors |
| `--space-*` | `--space-100` | Spacing scale (rem) |
| `--radius-*` | `--radius-sm` | Border radius |
| `--border-width-*` | `--border-width-25` | Border widths |
| `--opacity-*` | `--opacity-50` | Opacity levels |
| `--breakpoint-*` | `--breakpoint-md` | Responsive breakpoints |
| `--typography-desktop-*` | `--typography-desktop-h1` | Font sizes (rem), weights, line heights (unitless) for desktop |
| `--typography-mobile-*` | `--typography-mobile-h1` | Font sizes (rem), weights, line heights (unitless) for mobile |
| `--icon-size-*` | `--icon-size-large` | Icon dimensions |
| `--shadow-*` | `--shadow-elevation-3` | Box shadow definitions |
| `--text-style-*` | `--text-style-base-h1-font-size` | Composite text styles (font family, size, weight, line-height, letter-spacing, transforms) |
| `--grid-*` | `--grid-desktop-columns` | Grid layout values (columns, gutter, offset) per breakpoint |

### Responsive typography

Desktop and mobile typography tokens are both defined in `:root`. Apply the
mobile scale inside a media query in your stylesheet:

```css
h1 {
  font-size: var(--typography-desktop-h1);
  line-height: var(--typography-desktop-line-height-h1);
}

@media (max-width: 640px) {
  h1 {
    font-size: var(--typography-mobile-h1);
    line-height: var(--typography-mobile-line-height-h1);
  }
}
```

## Source files

Token JSON files live in `src/` and are exported directly from Figma in W3C DTCG format. **Do not edit them by hand** — re-export from Figma and re-run the build.

| File | Contents |
|---|---|
| `src/primitive/colors.light.tokens.json` | Raw colour palette (blue, green, red, …) |
| `src/semantic/colors.light.tokens.json` | Semantic colour roles (primary, background, button states, …) |
| `src/spacing.value.tokens.json` | Spacing scale |
| `src/radius.value.tokens.json` | Border radius values |
| `src/border width.value.tokens.json` | Border width values |
| `src/opacity.value.tokens.json` | Opacity values |
| `src/breakpoints.value.tokens.json` | Responsive breakpoints |
| `src/typography.desktop.tokens.json` | Desktop type scale |
| `src/typography.mobile.tokens.json` | Mobile type scale |
| `src/icon.Mode 1.tokens.json` | Icon sizes |
| `src/effect.styles.tokens.json` | Shadow/elevation definitions |

> `text.styles.tokens.json` and `grid.styles.tokens.json` are Figma composite styles (`$type: "typography"` / `$type: "grid"`). They are handled in pure JS after the Style Dictionary build step and appended to the same `:root {}` block in `dist/tokens.css`.

## Notes

- `--opacity-*` values are stored as `px` dimensions in the source (`0px`, `50px`, `100px`), which appears to be a Figma export quirk. Confirm with the client whether these should be unitless (`0`, `0.5`, `1`) before using them in production.
- Semantic colour tokens are fully resolved — they output their final hex value, not a `var()` reference. If chained `var()` references are preferred, set `outputReferences: true` in `build.js`.

## Why `build.js` instead of the Style Dictionary CLI

The project uses Style Dictionary's JavaScript API (`build.js`) rather than `style-dictionary build` with a `config.json`. Five issues made the CLI unworkable:

1. **Filenames with spaces** — `border width.value.tokens.json` and `icon.Mode 1.tokens.json` break SD's glob-based `source` config. Files are loaded with `readFileSync` and explicit paths instead.

2. **DTCG format normalisation** — Source files use the W3C DTCG spec (`$value`, `$type`, `$description`). SD v4's `usesDtcgKeys` flag is unreliable when tokens are passed as plain JS objects, so a `dtcgToSD()` function converts them before they reach Style Dictionary.

3. **Cross-collection references** — Semantic colours reference primitive colours (`{blue.600}`), radius references spacing (`{_125}`), and navigation tokens reference icon sizes (`{size.large}`). SD resolves references by flat key path, so those source files must be merged at the right root-level keys — something only controllable in JS, not in a static config.

4. **Key collisions** — `opacity`, `border-width`, and `breakpoints` all contain numeric keys (`0`, `50`, `100`, …) that collide with spacing's keys. They are namespaced (`opacity.*`, `border-width.*`, `breakpoint.*`) at load time to avoid clobbering spacing.

5. **Custom transforms and formatter** — Five transforms and one formatter had to be registered in JS:
   - `name/eds` — CSS var naming that encodes which collection a token belongs to
   - `value/px-to-rem` — converts spacing and typography font-size values from `px` to `rem` (base 16)
   - `value/line-height-to-unitless` — converts absolute `px` line-height values to unitless ratios relative to the matching font-size token
   - `value/shadow-to-css` — serialises Figma shadow objects to `box-shadow` syntax
   - `value/opacity-px-to-unitless` — converts Figma's `50px`-as-percentage to `0.5`
   - `css/eds-variables` — custom formatter that emits grouped section headers
