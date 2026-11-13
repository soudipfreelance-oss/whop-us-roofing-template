export type ExpiringMap<V> = {
	get: (key: string, now: number) => V | undefined;
	set: (key: string, value: V, until: number, now?: number) => void;
	delete: (key: string) => void;
	keys: (now: number) => string[];
};

// A write given the time lets go of every entry expired by then, so an
// isolate's cache holds no answer much past its time between reads of it.
// That sweep reads the whole map, so it runs only once an entry may have
// expired (`earliest`), and at most once per SWEEP_GAP_MS: a write to a map of
// live entries, or a burst of writes (a big cart's reads), reads none of the
// rest.
export const SWEEP_GAP_MS = 1_000;

export function createExpiringMap<V>(cap: number): ExpiringMap<V> {
	const entries = new Map<string, { value: V; until: number }>();
	let earliest = Number.POSITIVE_INFINITY;
	let swept = Number.NEGATIVE_INFINITY;
	const get = (key: string, now: number) => {
		const entry = entries.get(key);
		if (!entry) return undefined;
		if (entry.until > now) return entry.value;
		entries.delete(key);
		return undefined;
	};
	const sweep = (now: number) => {
		swept = now;
		earliest = Number.POSITIVE_INFINITY;
		for (const [stored, entry] of entries) {
			if (entry.until <= now) entries.delete(stored);
			else earliest = Math.min(earliest, entry.until);
		}
	};
	return {
		get,
		set: (key, value, until, now) => {
			if (now !== undefined && now >= earliest && now - swept >= SWEEP_GAP_MS) {
				sweep(now);
			}
			entries.delete(key);
			entries.set(key, { value, until });
			earliest = Math.min(earliest, until);
			for (const oldest of entries.keys()) {
				if (entries.size <= cap) break;
				entries.delete(oldest);
			}
		},
		delete: (key) => {
			entries.delete(key);
		},
		keys: (now) =>
			[...entries.keys()].filter((key) => get(key, now) !== undefined),
	};
}
