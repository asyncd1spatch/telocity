import { main } from "../src/main.ts";
// import { embeddedFiles } from "bun";
// console.log(embeddedFiles);
// uncomment for quickly checking wtf
// eslint-disable-next-line @typescript-eslint/no-floating-promises
(async () => {
  await main(process.argv.slice(2), true);
})();
