import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const palettes = [...css.matchAll(/(?:\:root,\s*)?\[data-theme='([^']+)'\]\s*\{([^}]+)\}/g)].map((match) => {
  const theme = match[1];
  const vars = Object.fromEntries([...match[2].matchAll(/(--[\w-]+)\s*:\s*(#[\da-fA-F]{3,8})\s*;/g)].map((item) => [item[1], item[2]]));
  return { theme, vars };
});

function rgb(hex) {
  const raw = hex.slice(1);
  const full = raw.length === 3 ? [...raw].map((part) => part + part).join('') : raw;
  return [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16) / 255);
}

function luminance(color) {
  return rgb(color).map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
}

function ratio(first, second) {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

const checks = [
  ['text/background', '--color-text', '--color-bg'],
  ['text/surface', '--color-text', '--color-surface'],
  ['text/panel', '--color-text', '--color-panel'],
  ['muted/background', '--color-muted', '--color-bg'],
  ['muted/surface', '--color-muted', '--color-surface'],
  ['accent/background', '--color-accent', '--color-bg'],
  ['accent/surface', '--color-accent', '--color-surface'],
  ['accent button text', '--color-on-accent', '--color-accent'],
  ['accent hover text', '--color-on-accent', '--color-accent-strong'],
  ['ok status', '--color-ok', '--color-ok-bg'],
  ['warning status', '--color-warn', '--color-warn-bg'],
  ['danger status', '--color-danger', '--color-danger-bg'],
  ['info status', '--color-info', '--color-info-bg'],
];
let failures = 0;
for (const { theme, vars } of palettes) {
  for (const [label, foreground, background] of checks) {
    const value = ratio(vars[foreground], vars[background]);
    if (value < 4.5) {
      console.error(`${theme}: ${label} contrast is ${value.toFixed(2)}:1 (requires 4.5:1)`);
      failures += 1;
    }
  }
}
if (failures) process.exit(1);
console.log(`WCAG AA contrast checks passed for ${palettes.length} themes (${palettes.length * checks.length} pairs).`);
