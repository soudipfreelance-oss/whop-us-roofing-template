import { createFileRoute, useRouter } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ProductCard } from "../components/product/ProductCard";
import { isRecord } from "../lib/checkout/shared";
import {
	type CollectionPages,
	createCollectionPages,
	firstPages,
} from "../lib/collection-pages";
import {
	type CollectionItem,
	type CollectionStretch,
	loadCollectionStretch,
} from "../whop.server";

const loadCollection = createServerFn({ method: "GET" })
	.validator((input: { label: string; after?: string }): unknown => input)
	.handler(async ({ data }): Promise<CollectionStretch> => {
		const request = isRecord(data) ? data : {};
		return loadCollectionStretch(
			typeof request.label === "string" ? request.label : "",
			typeof request.after === "string" ? request.after : null,
		);
	});

export const Route = createFileRoute("/collections/$label")({
	loader: ({ params }) => loadCollection({ data: { label: params.label } }),
	// Its first stretch reads up to 15 seconds of Whop's catalog and variants:
	// too much to spend on a hover the buyer may not follow. The click loads it.
	preload: false,
	component: CollectionPage,
});

function CollectionPage() {
	const first = Route.useLoaderData();
	const [pages, setPages] = useState<CollectionPages<CollectionItem> | null>(
		null,
	);
	const [stretches] = useState(() =>
		createCollectionPages<CollectionItem>(
			(label, after) => loadCollection({ data: { label, after } }),
			setPages,
		),
	);
	// The pager starts on each first stretch once its render is committed, so a
	// render React throws away never moves its generation on and drops a load.
	useEffect(() => {
		setPages(stretches.start(first));
	}, [stretches, first]);
	const shown = pages?.first === first ? pages : firstPages(first);
	const { items, next, loading, failed, ended } = shown;
	const router = useRouter();

	return (
		<section style={{ padding: "2rem" }}>
			<h1 style={{ textTransform: "capitalize" }}>
				{first.label.replace(/-/g, " ")}
			</h1>
			<div
				style={{
					display: "grid",
					gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
					gap: "1.5rem",
				}}
			>
				{items.map((item) => (
					<ProductCard
						key={item.id}
						title={item.title}
						slug={item.slug}
						image={item.image ?? undefined}
						priceLabel={item.priceLabel ?? undefined}
					/>
				))}
			</div>
			{next !== null ? (
				<button
					type="button"
					onClick={() => void stretches.more()}
					disabled={loading}
					style={{ marginTop: "2rem" }}
				>
					{loading ? "Loading…" : "Load more"}
				</button>
			) : null}
			{failed ? (
				<p role="alert">
					These products didn't load.{" "}
					{next === null ? (
						<button type="button" onClick={() => void router.invalidate()}>
							Try again
						</button>
					) : (
						"Try again."
					)}
				</p>
			) : null}
			{ended ? (
				<p role="alert">The rest of this collection didn't load.</p>
			) : null}
		</section>
	);
}
