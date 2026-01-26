# E2E Tests

End-to-end tests using Playwright.

## Running Tests

```bash
# Full suite (builds app first)
npm run test:e2e

# Just playwright (assumes app is built)
npx playwright test

# Specific test file
npx playwright test smoke.spec.ts

# Specific test by name
npx playwright test -g "Portfolio loads"

# Specific project (desktop or mobile)
npx playwright test --project=chromium-desktop
npx playwright test --project=chromium-mobile

# With UI mode for debugging
npx playwright test --ui
```

## Test Projects

Tests run on two viewports:
- `chromium-desktop` - Desktop Chrome
- `chromium-mobile` - iPhone SE emulation

## Writing Stable Tests

### Mobile Considerations

Mobile viewport tests are more prone to timing issues:

1. **Always wait for visibility AND interactability**
   ```typescript
   const button = page.getByRole('button', { name: 'Submit' });
   await expect(button).toBeVisible();
   await expect(button).toBeEnabled();
   await button.click();
   ```

2. **Use networkidle for navigation**
   ```typescript
   await page.goto('/', { waitUntil: 'networkidle' });
   await page.reload({ waitUntil: 'networkidle' });
   ```

3. **Avoid fixed timeouts, prefer conditions**
   ```typescript
   // Bad
   await page.waitForTimeout(1000);

   // Good
   await expect(page.locator('.loaded')).toBeVisible();
   ```

4. **If a test is flaky on mobile only, skip it there**
   ```typescript
   test('My test', async ({ page, isMobile }) => {
     test.skip(isMobile, 'Flaky on mobile - see WO-2026-162');
     // ...
   });
   ```

### Baseline Health Check

The CI runner executes `npm test` as a baseline health check before starting work. If tests fail, the run aborts with `baseline_failed`.

**Do not skip tests without a WO to fix them.** Skipped tests should be temporary.

## Test Data

Tests use fixture repos in `e2e/.tmp/repos/`:
- `alpha` - Has `.control.yml` with sidecar metadata
- `beta` - Basic repo for testing star/unstar

Fixtures are created by `e2e/global-setup.ts`.

## Debugging Failures

Test artifacts are saved to:
- `test-results/` - Screenshots, videos, traces
- `playwright-report/` - HTML report

```bash
# View HTML report
npx playwright show-report
```
