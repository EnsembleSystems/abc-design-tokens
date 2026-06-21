import StyleDictionary from 'style-dictionary';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Convert W3C DTCG format ($value/$type/$description) to SD legacy format (value/type/comment).
// SD v4's usesDtcgKeys flag is unreliable when tokens are passed as plain JS objects,
// so we normalise the tree ourselves before handing it to Style Dictionary.
function dtcgToSD(obj) {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return obj;
  const result = {};
  for (const [key, val] of Object.entries(obj)) {
    if      (key === '$value')       result.value   = val;
    else if (key === '$type')        result.type    = val;
    else if (key === '$description') result.comment = val;
    else if (key.startsWith('$'))    { /* skip $extensions etc. */ }
    else if (typeof val === 'object' && val !== null && !Array.isArray(val))
      result[key] = dtcgToSD(val);
    else result[key] = val;
  }
  return result;
}

// readFileSync + explicit paths instead of SD glob source — handles filenames with spaces
// (e.g. "border width.value.tokens.json", "icon.Mode 1.tokens.json").
function load(relPath) {
  const raw = JSON.parse(readFileSync(path.join(__dirname, 'src', relPath), 'utf-8'));
  return dtcgToSD(raw);
}

const primitiveColors   = load('primitive/colors.light.tokens.json');
const semanticColors    = load('semantic/colors.light.tokens.json');
const spacing           = load('spacing.value.tokens.json');
const radius            = load('radius.value.tokens.json');
const borderWidth       = load('border width.value.tokens.json');
const opacity           = load('opacity.value.tokens.json');
const breakpoints       = load('breakpoints.value.tokens.json');
const typographyDesktop = load('typography.desktop.tokens.json');
const typographyMobile  = load('typography.mobile.tokens.json');
const iconSizes         = load('icon.Mode 1.tokens.json');
const effects           = load('effect.styles.tokens.json');

// Primitive colors, semantic colors, spacing, and icon sizes stay at root so that
// the source files' unqualified references resolve correctly:
//   {blue.600}        → primitive colors at root
//   {_125}, {0}, {50} → spacing at root (used by radius — cross-collection refs)
//   {size.large}      → icon sizes at root (used by semantic navigation tokens)
//   {primary.default} → semantic tokens at root (used internally within semantic)
//
// Everything else is namespaced to prevent key collisions:
//   opacity, border-width, and breakpoints all share numeric keys with spacing
//   typography desktop/mobile share the same keys (h1, h2, font-family, …)
const tokens = {
  ...primitiveColors,
  ...semanticColors,
  ...spacing,
  ...iconSizes,
  radius,
  'border-width': borderWidth,
  opacity,
  breakpoint: breakpoints,
  'typography-desktop': typographyDesktop,
  'typography-mobile': typographyMobile,
  shadow: effects,
};

// ─── Category sets (used for naming + grouping) ───────────────────────────────

const PRIMITIVE_COLOR_ROOTS = new Set([
  'shades', 'neutrals', 'blue', 'green', 'yellow', 'red', 'orange', 'lilac', 'purple',
]);

const SEMANTIC_COLOR_ROOTS = new Set([
  'primary', 'background', 'text', 'link', 'divider',
  '_icon', '_surface', '_border',
  'button', 'error', 'info', 'success', 'warning', 'danger', 'brand',
  'navigation', 'footer', 'label', 'default', 'hover', 'promo', 'data',
]);

const COLOR_ROOTS = new Set([...PRIMITIVE_COLOR_ROOTS, ...SEMANTIC_COLOR_ROOTS]);

const SPACING_ROOTS = new Set([
  '0', '25', '50', '100', '200', '300', '400', '500',
  '600', '700', '800', '900', '1000', '_125',
]);

// ─── Name transform ───────────────────────────────────────────────────────────

function buildVarName(tokenPath) {
  const root = tokenPath[0];
  const rest = tokenPath.slice(1);

  const kebab = (parts) =>
    parts
      .map(p => String(p).replace(/^_+/, '').replace(/\s+/g, '-'))
      .filter(Boolean)
      .join('-')
      .replace(/[^a-z0-9-]/gi, '-')
      .replace(/-+/g, '-')
      .toLowerCase()
      .replace(/^-+|-+$/g, '');

  if (COLOR_ROOTS.has(root))   return `color-${kebab(tokenPath)}`;
  if (SPACING_ROOTS.has(root)) return `space-${root.replace(/^_/, '')}`;

  const prefixMap = {
    radius:               'radius',
    'border-width':       'border-width',
    opacity:              'opacity',
    breakpoint:           'breakpoint',
    'typography-desktop': 'typography-desktop',
    'typography-mobile':  'typography-mobile',
    size:                 'icon-size',
    shadow:               'shadow',
  };

  if (prefixMap[root]) return `${prefixMap[root]}-${kebab(rest)}`;
  return kebab(tokenPath);
}

StyleDictionary.registerTransform({
  name: 'name/eds',
  type: 'name',
  transform: (token) => buildVarName(token.path),
});

// ─── px → rem ────────────────────────────────────────────────────────────────
// Shared by the SD transform (spacing + typography font-size tokens) and by
// buildTypoVars (font-size inside composite text-style tokens).

const TYPOGRAPHY_ROOTS = new Set(['typography-desktop', 'typography-mobile']);
const BASE_FONT_SIZE = 16;

function pxToRem(val) {
  const m = String(val).match(/^(\d+(?:\.\d+)?)px$/);
  if (!m) return String(val);
  const px = parseFloat(m[1]);
  if (px === 0) return '0';
  return `${Math.round((px / BASE_FONT_SIZE) * 10000) / 10000}rem`;
}

StyleDictionary.registerTransform({
  name: 'value/px-to-rem',
  type: 'value',
  filter: (token) =>
    SPACING_ROOTS.has(token.path[0]) ||
    (TYPOGRAPHY_ROOTS.has(token.path[0]) && token.path.length === 2),
  transform: (token) => pxToRem(token.value),
});

StyleDictionary.registerTransform({
  name: 'value/line-height-to-unitless',
  type: 'value',
  filter: (token) =>
    TYPOGRAPHY_ROOTS.has(token.path[0]) && token.path[1] === 'line-height',
  transform: (token) => {
    const lhKey = token.path[2];
    // 'paragraph' line-height pairs with 'paragraph-default' font-size key
    const fsKey = lhKey === 'paragraph' ? 'paragraph-default' : lhKey;
    const typo = token.path[0] === 'typography-desktop' ? typographyDesktop : typographyMobile;
    const fontSizeVal = typo?.[fsKey]?.value;
    if (!fontSizeVal) return token.value;
    return lineHeightToUnitless(token.value, fontSizeVal);
  },
});

// ─── Shadow value transform ───────────────────────────────────────────────────

StyleDictionary.registerTransform({
  name: 'value/shadow-to-css',
  type: 'value',
  filter: (token) => token.type === 'shadow',
  transform: (token) => {
    const val = token.value;
    if (!val) return '';
    const list = Array.isArray(val) ? val : [val];
    return list
      .map(s =>
        [s.inset ? 'inset' : '', s.offsetX, s.offsetY, s.blur, s.spread, s.color]
          .filter(Boolean)
          .join(' ')
      )
      .join(', ');
  },
});

// ─── Opacity transform ────────────────────────────────────────────────────────
// Figma exports opacity as dimension+px (e.g. "50px" meaning 50%).
// Convert to the unitless decimal CSS opacity expects: 50px → 0.5.

StyleDictionary.registerTransform({
  name: 'value/opacity-px-to-unitless',
  type: 'value',
  filter: (token) => token.path[0] === 'opacity',
  transform: (token) => {
    const match = String(token.value).match(/^(\d+(?:\.\d+)?)px$/);
    if (!match) return token.value;
    return String(parseFloat(match[1]) / 100);
  },
});

// ─── Hex shorthand transform ──────────────────────────────────────────────────

StyleDictionary.registerTransform({
  name: 'value/hex-shorthand',
  type: 'value',
  filter: (token) => COLOR_ROOTS.has(token.path[0]),
  transform: (token) => {
    const v = String(token.value).toLowerCase();
    const m8 = v.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/);
    if (m8) {
      const [, r, g, b, a] = m8;
      if (r[0] === r[1] && g[0] === g[1] && b[0] === b[1] && a[0] === a[1])
        return `#${r[0]}${g[0]}${b[0]}${a[0]}`;
      return v;
    }
    const m6 = v.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/);
    if (m6) {
      const [, r, g, b] = m6;
      if (r[0] === r[1] && g[0] === g[1] && b[0] === b[1])
        return `#${r[0]}${g[0]}${b[0]}`;
      return v;
    }
    return token.value;
  },
});

// ─── Custom formatter with section headers ────────────────────────────────────

StyleDictionary.registerFormat({
  name: 'css/eds-variables',
  format: ({ dictionary }) => {
    function groupFor(tokenPath) {
      const root = tokenPath[0];
      if (PRIMITIVE_COLOR_ROOTS.has(root)) return 'Primitive Colors';
      if (SEMANTIC_COLOR_ROOTS.has(root))  return 'Semantic Colors';
      if (SPACING_ROOTS.has(root))          return 'Spacing';
      const map = {
        radius:               'Radius',
        'border-width':       'Border Width',
        opacity:              'Opacity',
        breakpoint:           'Breakpoints',
        'typography-desktop': 'Typography — Desktop',
        'typography-mobile':  'Typography — Mobile',
        size:                 'Icon Sizes',
        shadow:               'Shadows',
      };
      return map[root] ?? 'Other';
    }

    // Preserve source order within each group by using insertion-order Map
    const groups = new Map();
    for (const token of dictionary.allTokens) {
      const g = groupFor(token.path);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(token);
    }

    const lines = [
      '/**',
      ' * ABC Design Tokens',
      ' * Auto-generated by Style Dictionary — do not edit manually.',
      ' * Source: abc-design-tokens/src/',
      ' */',
      '',
      ':root {',
    ];

    let firstGroup = true;
    for (const [groupName, groupTokens] of groups) {
      if (!firstGroup) lines.push('');
      firstGroup = false;
      lines.push(`  /* ── ${groupName} ${'─'.repeat(Math.max(0, 46 - groupName.length))} */`);
      for (const token of groupTokens) {
        if (token.comment) { lines.push(''); lines.push(`  /* ${token.comment} */`); }
        const isFontFamily = TYPOGRAPHY_ROOTS.has(token.path[0]) && token.path[1] === 'font-family';
        const cssValue = isFontFamily ? `"${token.value}"` : token.value;
        lines.push(`  --${token.name}: ${cssValue};`);
      }
    }

    lines.push('}', '');
    return lines.join('\n');
  },
});

// ─── Text styles + grid helpers ──────────────────────────────────────────────

// Resolve a {dot.path} reference against a token lookup object.
// Works with both raw DTCG ($value) and dtcgToSD-converted (value) objects.
function resolveRef(ref, lookup) {
  const match = String(ref).match(/^\{([^}]+)}$/);
  if (!match) return String(ref);
  const parts = match[1].split('.');
  let node = lookup;
  for (const p of parts) {
    node = node?.[p];
    if (node === undefined) break;
  }
  if (node === undefined || node === null) return String(ref);
  const val = node?.value ?? node?.['$value'];
  if (val !== undefined && val !== null && typeof val !== 'object') return String(val);
  if (typeof node !== 'object') return String(node);
  return String(ref);
}

// Figma exports letter-spacing as percentage strings ("0%", "1%").
// CSS letter-spacing doesn't accept %, so convert to em: 1% → 0.01em.
function letterSpacingToCss(val) {
  const m = String(val).match(/^(\d+(?:\.\d+)?)%$/);
  if (!m) return String(val);
  const n = parseFloat(m[1]);
  return n === 0 ? '0' : `${n / 100}em`;
}

// Figma exports line-height as absolute px (e.g. "75.6px"). Unitless is correct
// for CSS — it re-multiplies per element rather than inheriting a computed px value.
function lineHeightToUnitless(lineHeightVal, fontSizeVal) {
  const lh = parseFloat(lineHeightVal);
  const fs = parseFloat(fontSizeVal);
  if (!lh || !fs) return String(lineHeightVal);
  const ratio = Math.round((lh / fs) * 10000) / 10000;
  return String(ratio);
}

function slugify(str) {
  return String(str)
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const TEXT_STYLE_SECTION_ALIAS = {
  'base styles': 'base',
  'navigation':  'nav',
  'small device': 'small',
};

const TYPOGRAPHY_CSS_PROPS = [
  ['fontFamily',     'font-family'],
  ['fontSize',       'font-size'],
  ['fontWeight',     'font-weight'],
  ['lineHeight',     'line-height'],
  ['textTransform',  'text-transform'],
  ['letterSpacing',  'letter-spacing'],
  ['textDecoration', 'text-decoration'],
];

function buildTypoVars(section, tokenName, tv, rawTypo) {
  const prefix = `text-style-${section}-${slugify(tokenName)}`;
  const resolvedFontSize = resolveRef(tv['fontSize'] ?? '', rawTypo);
  return TYPOGRAPHY_CSS_PROPS.map(([jsKey, cssProp]) => {
    let val = resolveRef(tv[jsKey] ?? '', rawTypo);
    if (cssProp === 'font-family')    val = `"${val}"`;
    if (cssProp === 'font-size')      val = pxToRem(val);
    if (cssProp === 'letter-spacing') val = letterSpacingToCss(val);
    if (cssProp === 'line-height')    val = lineHeightToUnitless(val, resolvedFontSize);
    return `  --${prefix}-${cssProp}: ${val};`;
  });
}

function textStylesToCssLines(raw, rawTypo) {
  const lines = ['', '  /* ── Text Styles ─────────────────────────────────────────── */'];
  for (const [topKey, topVal] of Object.entries(raw)) {
    for (const [midKey, midVal] of Object.entries(topVal)) {
      if (midVal['$type'] === 'typography') {
        // Direct token under top key (e.g. "Member site" > "Paragraph")
        lines.push(...buildTypoVars(slugify(topKey), midKey, midVal['$value'], rawTypo));
      } else {
        // Section > token (e.g. "Design system" > "Base styles" > "H1")
        const section = TEXT_STYLE_SECTION_ALIAS[midKey.toLowerCase()] ?? slugify(midKey);
        for (const [tokenKey, tokenVal] of Object.entries(midVal)) {
          if (tokenVal['$type'] !== 'typography') continue;
          lines.push(...buildTypoVars(section, tokenKey, tokenVal['$value'], rawTypo));
        }
      }
    }
  }
  return lines;
}

function gridStylesToCssLines(raw) {
  const lines = ['', '  /* ── Grid ──────────────────────────────────────────────────── */'];
  for (const [key, val] of Object.entries(raw)) {
    if (!val['$value']) continue;
    const grid = Array.isArray(val['$value']) ? val['$value'][0] : val['$value'];
    const name = `grid-${slugify(key)}`;
    lines.push(`  --${name}-columns: ${grid.count};`);
    lines.push(`  --${name}-gutter: ${grid.gutterSize};`);
    lines.push(`  --${name}-offset: ${grid.offset};`);
  }
  return lines;
}

// ─── Build ────────────────────────────────────────────────────────────────────

mkdirSync(path.join(__dirname, 'dist'), { recursive: true });

const sd = new StyleDictionary({
  log: { verbosity: 'verbose' },
  tokens,
  platforms: {
    css: {
      buildPath: 'dist/',
      transforms: ['name/eds', 'value/px-to-rem', 'value/line-height-to-unitless', 'value/shadow-to-css', 'value/opacity-px-to-unitless', 'value/hex-shorthand'],
      files: [
        {
          destination: 'tokens.css',
          format: 'css/eds-variables',
        },
      ],
    },
  },
});

await sd.buildAllPlatforms();
console.log('✓  dist/tokens.css generated');

// Text styles and grid are Figma composite types that Style Dictionary can't
// process natively — handle them in pure JS and splice into the same :root block.
const rawTextStyles  = JSON.parse(readFileSync(path.join(__dirname, 'src', 'text.styles.tokens.json'), 'utf-8'));
const rawGrid        = JSON.parse(readFileSync(path.join(__dirname, 'src', 'grid.styles.tokens.json'), 'utf-8'));

const cssPath  = path.join(__dirname, 'dist', 'tokens.css');
let   css      = readFileSync(cssPath, 'utf-8');
const lastBrace = css.lastIndexOf('}');

const extraLines = [
  ...textStylesToCssLines(rawTextStyles, typographyDesktop),
  ...gridStylesToCssLines(rawGrid),
];

css = css.slice(0, lastBrace) + extraLines.join('\n') + '\n}\n';
writeFileSync(cssPath, css);
console.log('✓  Text styles and grid appended to dist/tokens.css');
