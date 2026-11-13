import { useEffect, useState } from "react";
import type { PageVisibility } from "./charge-attempt";

// A page can fire `pagehide` without unloading and then `pageshow` without
// coming from the browser's cache: it counts as hidden between the two, so a
// wait it held picks up again rather than leaving the page inert. The page's
// one reading of visibility: charge waits, quote retries and wallet probes all
// pause on it.
export function documentVisibility(): PageVisibility {
	let gone = false;
	return {
		visible: () => !gone && document.visibilityState === "visible",
		watch: (changed) => {
			const away = () => {
				gone = true;
				changed();
			};
			const back = () => {
				gone = false;
				changed();
			};
			document.addEventListener("visibilitychange", changed);
			window.addEventListener("pagehide", away);
			window.addEventListener("pageshow", back);
			return () => {
				document.removeEventListener("visibilitychange", changed);
				window.removeEventListener("pagehide", away);
				window.removeEventListener("pageshow", back);
			};
		},
	};
}

export function usePageHidden(): boolean {
	const [hidden, setHidden] = useState(false);
	useEffect(() => {
		const page = documentVisibility();
		const follow = () => setHidden(!page.visible());
		follow();
		return page.watch(follow);
	}, []);
	return hidden;
}
