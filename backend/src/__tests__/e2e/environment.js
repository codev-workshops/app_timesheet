const { TestEnvironment } = require('jest-environment-node');

/**
 * Jest runs test code in a separate VM realm, so `new Date()` inside a test is
 * not an instance of the host realm's `Date`. node-sqlite3's native binding
 * checks the host realm and would store such a value as the string
 * "[object Object]" instead of epoch milliseconds — an artefact of the test
 * harness that has nothing to do with how the app behaves in production.
 *
 * Exposing the host `Date` inside the sandbox keeps the e2e suite faithful to
 * real runtime behaviour on both backends.
 */
class RealDateEnvironment extends TestEnvironment {
  async setup() {
    await super.setup();
    this.global.Date = Date;
  }
}

module.exports = RealDateEnvironment;
