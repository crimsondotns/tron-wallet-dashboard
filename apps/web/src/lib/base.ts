// Site path prefix on GitHub Pages ("/xcap-insight"; empty locally). next/link and the router add
// it themselves; plain URLs (<img src>, fetch of public files, auth redirect URLs) need asset().
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
export const asset = (path: string) => `${BASE_PATH}${path}`;
