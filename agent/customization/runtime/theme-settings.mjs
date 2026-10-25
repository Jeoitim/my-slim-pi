// Compatibility names only; the picker lists the canonical palette names.
const legacy = {
  'catppuccin-light': 'catppuccin-latte',
  'catppuccin-dark': 'catppuccin-mocha',
  'catppuccin-frappe-light': 'catppuccin-latte',
  'catppuccin-frappe-dark': 'catppuccin-frappe',
  'catppuccin-macchiato-light': 'catppuccin-latte',
  'catppuccin-macchiato-dark': 'catppuccin-macchiato',
};
export function themeName(name) {
  const aliases = { ayu: 'ayu-dark', catppuccin: 'catppuccin-mocha', cappucin: 'catppuccin-mocha', gruvbox: 'gruvbox-dark', github: 'github-dark', claude: 'claude-warm', ...legacy };
  return Object.hasOwn(aliases, name) ? aliases[name] : name;
}
export function migrateThemeSettings(settings) {
  if (typeof settings.theme === 'string') {
    const names = settings.theme.split('/');
    if (names.length <= 2 && names.some(name => Object.hasOwn(legacy, name.trim()))) settings.theme = names.map(name => Object.hasOwn(legacy, name.trim()) ? legacy[name.trim()] : name.trim()).join('/');
  }
  for (const pkg of settings.packages || []) {
    if (pkg && typeof pkg === 'object' && /^npm:@anishthite\/pi-themes(?:@|$)/.test(pkg.source || '')) {
      // Replace only the overlapping families; preserve unrelated user filters.
      const filters = pkg.themes || ['themes/github-*.json'];
      pkg.themes = filters.filter(pattern => !/^themes\/(?:ayu|catppuccin|gruvbox)-/.test(pattern));
    }
  }
  return settings;
}
