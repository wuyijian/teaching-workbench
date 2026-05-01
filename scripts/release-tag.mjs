/**
 * release-tag.mjs  <patch|minor|major>
 *
 * 自动化发布流程：
 *   1. 读取 package.json 当前版本
 *   2. 按类型 bump 版本号
 *   3. 写回 package.json
 *   4. git commit "chore: release vX.Y.Z"
 *   5. git tag vX.Y.Z
 *   6. git push origin main --follow-tags
 *
 * push 完成后，GitHub Actions build-mac.yml 自动触发，
 * 构建 Mac DMG 并创建 GitHub Release。
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(fileURLToPath(import.meta.url), '../..');
const pkgPath = resolve(root, 'package.json');

// ── 参数 ─────────────────────────────────────────────────────────────
const type = process.argv[2];
if (!['patch', 'minor', 'major'].includes(type)) {
  console.error('用法: node scripts/release-tag.mjs <patch|minor|major>');
  process.exit(1);
}

// ── 读取当前版本 ──────────────────────────────────────────────────────
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const [maj, min, pat] = pkg.version.split('.').map(Number);

let newVersion;
if (type === 'major') newVersion = `${maj + 1}.0.0`;
else if (type === 'minor') newVersion = `${maj}.${min + 1}.0`;
else newVersion = `${maj}.${min}.${pat + 1}`;

const tag = `v${newVersion}`;

// ── 确认 ─────────────────────────────────────────────────────────────
console.log(`\n  当前版本：v${pkg.version}`);
console.log(`  新版本  ：${tag}  (${type} bump)`);
console.log(`  推送后 GitHub Actions 将自动构建 Mac DMG 并发布 Release\n`);

// ── 检查工作区是否干净 ────────────────────────────────────────────────
const status = execSync('git status --porcelain', { cwd: root }).toString().trim();
if (status) {
  console.error('⚠️  工作区有未提交的修改，请先 git commit 或 git stash：');
  console.error(status);
  process.exit(1);
}

// ── 执行 ─────────────────────────────────────────────────────────────
function run(cmd) {
  console.log(`  $ ${cmd}`);
  execSync(cmd, { cwd: root, stdio: 'inherit' });
}

// 写入新版本
pkg.version = newVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

run(`git add package.json`);
run(`git commit -m "chore: release ${tag}"`);
run(`git tag ${tag}`);
run(`git push origin main`);
run(`git push origin ${tag}`);

console.log(`\n✅ ${tag} 已推送！`);
console.log(`   GitHub Actions 正在构建，约 5-8 分钟后可在此下载：`);
console.log(`   https://github.com/wuyijian/teaching-workbench/releases/tag/${tag}\n`);
