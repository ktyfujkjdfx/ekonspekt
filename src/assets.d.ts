// esbuild: '.png' → data: URL, '.svg' → строка base64 (loader в scripts/build.mjs).
declare module '*.png' {
  const url: string;
  export default url;
}
declare module '*.svg' {
  const base64: string;
  export default base64;
}
