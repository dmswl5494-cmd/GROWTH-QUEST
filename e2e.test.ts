import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:8080';

test.describe('GROWTH QUEST Complete Verification Test Suite', () => {

  test('1. Initial Login & Password Enforcement for Junior', async ({ page }) => {
    await page.goto(BASE_URL);
    
    // Login as chanyoung.min with initial password
    await page.fill('#username', 'chanyoung.min');
    await page.fill('#password', 'initpw1!');
    await page.click('#btn-login-submit');

    // Should redirect to password change screen
    await expect(page.locator('text=최초 접속에 따른 새 비밀번호 설정이 필요합니다')).toBeVisible();

    // Try invalid pw without special char
    await page.fill('#new-password', 'invalidpw1');
    await page.fill('#confirm-password', 'invalidpw1');
    await page.click('button[type="submit"]');
    await expect(page.locator('#pw-change-alert')).toContainText('8자 이상, 영문, 숫자, 특수문자를 모두 포함해야 합니다');

    // Fill valid new password
    await page.fill('#new-password', 'newSecret1!');
    await page.fill('#confirm-password', 'newSecret1!');
    await page.click('button[type="submit"]');

    // Should navigate to Junior Home
    await expect(page.locator('text=민찬영 님')).toBeVisible();

    // Verify Quest Board Link & Logout presence
    await expect(page.locator('.quest-board-btn')).toBeVisible();
    await expect(page.locator('#btn-logout')).toBeVisible();
  });

  test('2. Mentor Dashboard Revamp & Headliner Check', async ({ page }) => {
    await page.goto(BASE_URL);
    
    // Login as mento_1
    await page.fill('#username', 'mento_1');
    await page.fill('#password', '0001');
    await page.click('#btn-login-submit');

    // Should land on Mentor Dashboard by default
    await expect(page.locator('text=담당 주니어사원 현황')).toBeVisible();
    await expect(page.locator('text=총 4명')).toBeVisible();
    await expect(page.locator('text=민찬영 · 최지원 · 이현준 · 최재홍')).toBeVisible();
    
    // Check forbidden term "인턴"
    const content = await page.content();
    expect(content).not.toContain('인턴');
  });

  test('3. Admin All Mentor Feedback History (Read-only View)', async ({ page }) => {
    await page.goto(BASE_URL);

    // Login as Master Admin
    await page.fill('#username', 'master');
    await page.fill('#password', 'Tldpadlstkxla1!');
    await page.click('#btn-login-submit');

    await expect(page.locator('text=인사팀 총괄운영자 대시보드')).toBeVisible();

    // Navigate to All Mentor Feedback History
    await page.click('a[data-route="ADMIN_FEEDBACK_HISTORY"]');
    await expect(page.locator('text=전체 멘토 피드백 이력 (총괄운영자 전용 조회)')).toBeVisible();
    await expect(page.locator('#admin-fb-junior-select')).toBeVisible();
  });

  test('4. Junior Feedback 2-Line Summary & No Detail Modal Check', async ({ page }) => {
    await page.goto(BASE_URL);

    // Login as Junior
    await page.fill('#username', 'jiwon.choi');
    await page.fill('#password', 'initpw1!');
    await page.click('#btn-login-submit');

    // Password change fallback if needed
    if (await page.locator('#new-password').isVisible()) {
      await page.fill('#new-password', 'newSecret1!');
      await page.fill('#confirm-password', 'newSecret1!');
      await page.click('button[type="submit"]');
    }

    // Go to Mentor Feedback tab
    await page.click('a[data-route="MENTOR_FEEDBACK_VIEW"]');
    await expect(page.locator('text=담당 멘토 피드백 목록')).toBeVisible();

    // Verify detail button & modal DO NOT exist
    await expect(page.locator('.btn-show-fb-modal')).toHaveCount(0);
    await expect(page.locator('#fb-detail-modal-container')).toHaveCount(0);
  });

});
