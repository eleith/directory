type Rgb = readonly [red: number, green: number, blue: number];

function luminance(hex: string): number {
	const [red, green, blue] = parseHex(hex);
	function channelLuminance(value: number): number {
		const channel = value / 255;
		if (channel <= 0.04045) return channel / 12.92;
		return Math.pow((channel + 0.055) / 1.055, 2.4);
	}
	return (
		channelLuminance(red) * 0.2126 +
		channelLuminance(green) * 0.7152 +
		channelLuminance(blue) * 0.0722
	);
}

function contrastRatio(foreground: string, background: string): number {
	const foregroundLuminance = luminance(foreground);
	const backgroundLuminance = luminance(background);
	return (
		(Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
		(Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
	);
}

// Inputs are validated #rgb or #rrggbb configuration colors.
export function getContrastText(primary: string, preferred: string): string {
	if (contrastRatio(preferred, primary) >= 4.5) return preferred;
	if (contrastRatio('#ffffff', primary) >= 4.5) return '#ffffff';
	return '#000000';
}

export function getContrastBackground(primary: string, foreground: string): string {
	if (contrastRatio(foreground, primary) >= 7) return primary;
	const contrastWithBlack = contrastRatio(foreground, '#000000');
	const contrastWithWhite = contrastRatio(foreground, '#ffffff');
	const targetColor = contrastWithBlack > contrastWithWhite ? '#000000' : '#ffffff';
	const primaryRgb = parseHex(primary);
	const targetRgb = parseHex(targetColor);
	for (let percent = 1; percent <= 100; percent++) {
		const blendedRgb = mixRgb(primaryRgb, targetRgb, percent);
		const background = formatHex(blendedRgb);
		if (contrastRatio(foreground, background) >= 7) return background;
	}
	return targetColor;
}

function parseHex(hex: string): Rgb {
	let digits = hex.slice(1);
	if (digits.length === 3) digits = [...digits].map((digit) => digit.repeat(2)).join('');
	return [
		parseInt(digits.slice(0, 2), 16),
		parseInt(digits.slice(2, 4), 16),
		parseInt(digits.slice(4, 6), 16)
	];
}

function mixRgb(start: Rgb, end: Rgb, percent: number): Rgb {
	function mixChannel(from: number, to: number): number {
		return Math.round(from + ((to - from) * percent) / 100);
	}
	return [mixChannel(start[0], end[0]), mixChannel(start[1], end[1]), mixChannel(start[2], end[2])];
}

function formatHex(color: Rgb): string {
	const channels = color.map((channel) => channel.toString(16).padStart(2, '0'));
	return `#${channels.join('')}`;
}
