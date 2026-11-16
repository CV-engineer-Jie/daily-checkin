import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Actions 自动识别仓库名；本地开发使用根路径。
const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1];
const isProjectSite = repoName && !repoName.endsWith('.github.io');
const base = process.env.GITHUB_PAGES === 'true' && isProjectSite
  ? `/${repoName}/`
  : '/';

export default defineConfig({
  plugins: [react()],
  base,
});
