import { runTestsuitePreflight } from './preflight';

export default async function testsuiteGlobalSetup(): Promise<void> {
  await runTestsuitePreflight();
}

