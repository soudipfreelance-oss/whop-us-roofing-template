import type { AttemptStorage } from "./charge-attempt";

export function readStored<T, Off = T>(
	storage: () => AttemptStorage,
	key: string,
	read: (value: unknown) => T,
	fallback: T,
	off?: { value: Off },
): T | Off {
	let raw: string | null;
	try {
		raw = storage().getItem(key);
	} catch {
		// Blocked storage throws on access: the caller says what that reads as.
		return off ? off.value : fallback;
	}
	try {
		return raw ? read(JSON.parse(raw)) : fallback;
	} catch {
		// Corrupt JSON reads as nothing stored, a stored attempt included: it is
		// dropped whole, never half-read into the charge's guard.
		return fallback;
	}
}

export function writeStored(
	storage: () => AttemptStorage,
	key: string,
	value: unknown,
): boolean {
	try {
		storage().setItem(key, JSON.stringify(value));
		return true;
	} catch {
		// Blocked or full: the caller decides, as a charge refuses to send.
		return false;
	}
}

export function readStoredList<T>(
	storage: () => AttemptStorage,
	key: string,
	guard: (entry: unknown) => entry is T,
): T[] {
	return readStored(
		storage,
		key,
		(value) => (Array.isArray(value) ? value.filter(guard) : []),
		[],
	);
}
