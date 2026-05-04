// SVGs are inlined as data URLs at build time via esbuild's
// `--loader:.svg=dataurl` flag.
declare module "*.svg" {
  const url: string;
  export default url;
}
