type Position = { top: number; left: number };

export function nextResultIndex(positions: Position[], currentIndex: number, key: string): number {
	const current = positions[currentIndex];
	if (!current) return currentIndex;
	const sameRow = (position: Position) => Math.abs(position.top - current.top) < 1;
	if (key === 'Home') return positions.findIndex(sameRow);
	if (key === 'End') return positions.findLastIndex(sameRow);
	if (key === 'ArrowLeft' || key === 'ArrowRight') {
		const step = key === 'ArrowLeft' ? -1 : 1;
		const candidate = positions[currentIndex + step];
		if (candidate && sameRow(candidate)) return currentIndex + step;
		return currentIndex;
	}
	if (key !== 'ArrowUp' && key !== 'ArrowDown') return currentIndex;

	const direction = key === 'ArrowUp' ? -1 : 1;
	let nextIndex = currentIndex;
	let nearestRow = Infinity;
	let nearestColumn = Infinity;
	for (const [index, position] of positions.entries()) {
		const rowDistance = (position.top - current.top) * direction;
		if (rowDistance < 1) continue;
		const columnDistance = Math.abs(position.left - current.left);
		if (
			rowDistance < nearestRow ||
			(rowDistance === nearestRow && columnDistance < nearestColumn)
		) {
			nextIndex = index;
			nearestRow = rowDistance;
			nearestColumn = columnDistance;
		}
	}
	return nextIndex;
}
