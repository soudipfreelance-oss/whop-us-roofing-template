import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/pages/contact")({
	component: ContactPage,
});

function ContactPage() {
	return (
		<section style={{ padding: "2rem" }}>
			<p>Contact page — the builder that owns this route replaces it.</p>
		</section>
	);
}
