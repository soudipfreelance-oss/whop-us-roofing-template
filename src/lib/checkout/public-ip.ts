import { publicIp } from "./shared";

// Whop hosting serves a store through Cloudflare, whose edge overwrites any
// `cf-connecting-ip` a client sends. Anywhere else the header is the client's
// to write, so no IP is sent: the checkout then waits for the delivery
// address.
export function buyerIpOf(
	header: string | undefined,
	whopHosted: boolean,
): string | undefined {
	if (!whopHosted) return undefined;
	const value = header?.trim();
	return value && publicIp(value) ? value : undefined;
}
