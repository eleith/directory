function luminance(hex: string): number {
	let digits = hex.slice(1);
	if (digits.length === 3) digits = digits.replace(/./g, '$&$&');
	function channelLuminance(offset: number): number {
		const channel = parseInt(digits.slice(offset, offset + 2), 16) / 255;
		if (channel <= 0.04045) return channel / 12.92;
		return Math.pow((channel + 0.055) / 1.055, 2.4);
	}
	return channelLuminance(0) * 0.2126 + channelLuminance(2) * 0.7152 + channelLuminance(4) * 0.0722;
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
