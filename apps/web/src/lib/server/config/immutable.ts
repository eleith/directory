export type Immutable<T> = T extends object ? { readonly [Key in keyof T]: Immutable<T[Key]> } : T;

export function freezeData<T>(value: T): Immutable<T> {
	if (value !== null && typeof value === 'object') {
		for (const child of Object.values(value)) freezeData(child);
		Object.freeze(value);
	}
	return value as Immutable<T>;
}
