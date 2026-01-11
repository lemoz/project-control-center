import { ensureRepoFixtures, resetControlFiles, resetTmpDir } from "./setup";

export default async function globalSetup() {
  resetTmpDir();
  ensureRepoFixtures();
  resetControlFiles();
}
