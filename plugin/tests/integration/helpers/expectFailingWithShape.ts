/**
 * `expectFailingWithShape` — discriminating bug-reproducer assertion.
 *
 * `it.fails(...)` from vitest accepts ANY thrown error as proof that
 * the test "failed as expected". That's wrong for regression-target
 * suites: a TypeError from a broken helper, an ECONNRESET from a
 * flaky network, or any other infrastructure failure would silently
 * masquerade as "yes, the production bug is still present".
 *
 * This helper closes that hole. Use it whenever a test asserts that
 * the system under test currently has a known bug — the helper
 * succeeds only when the production code throws with a specific
 * message shape. Two failure modes get distinct error messages:
 *
 *   1. **fn resolved without throwing** — the production bug has
 *      (probably) been fixed. The fix PR should remove this wrapper
 *      and have the test assert success directly.
 *
 *   2. **fn threw with the wrong shape** — likely the test
 *      infrastructure is broken (helper bug, env issue), not the
 *      production code. The test goes red and the contributor
 *      diagnoses the infra issue before touching production.
 *
 * Either way the test fails, so CI catches the change rather than
 * silently accepting it. That's what `it.fails(...)` couldn't do.
 *
 * Usage:
 *
 *     it('rename — reproduces #341 today', async () => {
 *       await expectFailingWithShape(
 *         () => assertSelfReflect({...}),
 *         /awaitReflect failed/,
 *         'issue #341 — writer self-reflect missing',
 *       );
 *     });
 *
 * When the fix lands, the diff drops the wrapper:
 *
 *     it('rename — adapter.rename fires vault.trigger("rename")', async () => {
 *       await assertSelfReflect({...});
 *     });
 */
export async function expectFailingWithShape(
  fn: () => Promise<unknown>,
  shape: RegExp,
  reason: string,
): Promise<void> {
  let caught: Error | null = null;
  try {
    await fn();
  } catch (e) {
    caught = e as Error;
  }

  if (caught === null) {
    throw new Error(
      `expectFailingWithShape(${reason}): production code did NOT throw.\n` +
      `  Expected throw matching: ${shape}\n` +
      `  Likely cause: the production bug has been fixed. Remove the\n` +
      `  expectFailingWithShape(...) wrapper and assert success directly.`,
    );
  }

  if (!shape.test(caught.message)) {
    throw new Error(
      `expectFailingWithShape(${reason}): throw shape did NOT match.\n` +
      `  Expected throw matching: ${shape}\n` +
      `  Actual throw message:    ${caught.message}\n` +
      `  Likely cause: test infrastructure broke (helper bug, env issue,\n` +
      `  network glitch) — diagnose THAT before touching production code.\n` +
      `  This wrapper exists precisely so infra bugs don't masquerade as\n` +
      `  proof that the production bug is still present.`,
    );
  }

  // Threw with the expected shape → today's bug is reproduced. Test passes.
}
