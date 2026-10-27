import type { DisplayAppearance } from '../display/types.js';
import { getContrastBackground, getContrastText } from './color.js';

// Snapshot publication validates these colors as #rgb or #rrggbb before they reach HTML.
export function themeStyleTag(appearance: DisplayAppearance): string {
	const { primary_light_color: light, primary_dark_color: dark } = appearance;
	const onLight = getContrastText(light, '#171717');
	const onDark = getContrastText(dark, '#f5f5f5');
	const fillLight = getContrastBackground(light, onLight);
	const fillDark = getContrastBackground(dark, onDark);
	return `<style>:root{--color-primary:light-dark(${light},${dark});--color-on-primary:light-dark(${onLight},${onDark});--color-primary-fill:light-dark(${fillLight},${fillDark})}</style>`;
}
