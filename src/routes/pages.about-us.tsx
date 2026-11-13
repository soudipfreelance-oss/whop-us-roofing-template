import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/pages/about-us")({
	component: AboutPage,
});

function AboutPage() {
	return (
		<section style={{ padding: "2rem" }}>
			<p>About page — the builder that owns this route replaces it.</p>
		</section>
	);
}
