// `unread`: the stretch's products didn't load, which is not an empty
// collection. `ended`: Whop refused the rest of the collection for good.
export type Stretch<T> = {
	label: string;
	items: T[];
	next: string | null;
	unread?: true;
	ended?: true;
};

export type CollectionPages<T> = {
	first: Stretch<T>;
	generation: number;
	items: T[];
	next: string | null;
	loading: boolean;
	failed: boolean;
	ended: boolean;
};

export function firstPages<T>(first: Stretch<T>): CollectionPages<T> {
	return {
		first,
		generation: 0,
		items: first.items,
		next: first.next,
		loading: false,
		failed: first.unread === true,
		ended: first.ended === true,
	};
}

// Each first stretch the loader hands over starts a generation: a stretch
// asked for under an earlier one is dropped when it lands, and only one load
// runs at a time.
export function createCollectionPages<T>(
	load: (label: string, after: string) => Promise<Stretch<T>>,
	changed: (pages: CollectionPages<T>) => void,
) {
	let pages: CollectionPages<T> | null = null;
	const set = (next: CollectionPages<T>) => {
		pages = next;
		changed(next);
	};
	return {
		start(first: Stretch<T>): CollectionPages<T> {
			if (pages?.first === first) return pages;
			pages = {
				...firstPages(first),
				generation: (pages?.generation ?? 0) + 1,
			};
			return pages;
		},
		async more(): Promise<void> {
			const from = pages;
			if (!from || from.next === null || from.loading) return;
			set({ ...from, loading: true, failed: false });
			try {
				const stretch = await load(from.first.label, from.next);
				if (pages?.generation !== from.generation) return;
				set({
					...pages,
					items: [...pages.items, ...stretch.items],
					next: stretch.next,
					loading: false,
					failed: stretch.unread === true,
					ended: stretch.ended === true,
				});
			} catch {
				// The page says these didn't load, and Load more tries again.
				if (pages?.generation !== from.generation) return;
				set({ ...pages, loading: false, failed: true });
			}
		},
	};
}
