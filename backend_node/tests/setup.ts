import { fallbackDb } from '../src/utils/schemaFallback';

beforeAll(async () => {
  // Ensure that all asynchronous SQLite schema creation and table verification
  // are fully completed before any tests in the test suite run.
  if (fallbackDb && fallbackDb.ready) {
    await fallbackDb.ready;
  }
});
