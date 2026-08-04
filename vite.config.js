import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// ▼ GitHubのリポジトリ名に合わせて変更してください（例: "/dady-photolog/"）
// リポジトリ名が "dady-photolog" ならこのままでOKです。
// ユーザー名.github.io という名前のリポジトリ（ルート公開）の場合は "/" にしてください。
export default defineConfig({
  plugins: [react()],
  base: "/dady-photolog/",
});
