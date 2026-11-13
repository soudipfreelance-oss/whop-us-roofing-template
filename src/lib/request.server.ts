// Server files import these from here, never from @tanstack/react-start/server
// directly. Every request already runs through that package, and the dev server
// in @cloudflare/vite-plugin hands out a half-loaded copy of any file that
// imports it while an edit reloads the code. Pages then fail with "Cannot access
// '...' before initialization" until the preview is reloaded.
export { getRequestHeader, getRequestUrl } from "@tanstack/react-start/server";
