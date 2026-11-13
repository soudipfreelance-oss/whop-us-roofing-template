export type Latest = {
	next: () => number;
	supersede: () => void;
	isLatest: (ticket: number) => boolean;
	current: () => number;
};

export function createLatest(): Latest {
	let latest = 0;
	return {
		next: () => {
			latest += 1;
			return latest;
		},
		supersede: () => {
			latest += 1;
		},
		isLatest: (ticket) => ticket === latest,
		current: () => latest,
	};
}
