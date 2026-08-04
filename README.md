# ダディのフォトlog（GitHub Pages + Firebase版）

Claude Artifact版と同じ見た目・機能のポートレートギャラリーを、GitHub Pagesで公開するためのプロジェクトです。
写真の保存には Firebase（Firestore）という無料の外部サービスを使います。

## 1. Firebaseプロジェクトを作る

1. https://console.firebase.google.com にアクセスし、Googleアカウントでログイン
2. 「プロジェクトを作成」→ 好きな名前をつける（例：dady-photolog）→ Googleアナリティクスは「無効」でOK
3. 作成できたら、プロジェクト画面の「</> (ウェブ)」アイコンをクリックしてアプリを追加
4. アプリのニックネームを適当に入力し「アプリを登録」
5. 表示された `firebaseConfig = {...}` の中身をコピーしておく

## 2. Firestore Database を有効にする

1. 左メニュー「構築」→「Firestore Database」→「データベースの作成」
2. ロケーションは `asia-northeast1`（東京）を推奨
3. セキュリティルールは「テストモードで開始」を選択（後述のルールに書き換えます）

### セキュリティルールの設定（重要）

「Firestore Database」→「ルール」タブを開き、以下に書き換えて「公開」してください。
（誰でも読み書きできる設定です。サイト側のパスワードだけが管理操作の唯一の壁になるので、
本格的な運用では Firebase Authentication の導入も検討してください）

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /photos/{photoId} {
      allow read: if true;
      allow write: if true;
    }
  }
}
```

## 3. コードにFirebaseの設定値を入れる

`src/firebase.js` を開き、手順1でコピーした `firebaseConfig` の値に置き換えてください。

## 4. パスワードを設定する

`src/App.jsx` の中の

```js
const ADMIN_PASS = "bdsan";
```

を好きなパスワードに変更してください。

## 5. GitHubリポジトリを作ってpushする

1. GitHubで新しいリポジトリを作成（例：`dady-photolog`）。README等は追加しない「空」の状態でOK
2. このフォルダ一式を、そのリポジトリにpushします（ターミナルで以下を実行）

```bash
cd dady-photolog
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/【あなたのユーザー名】/dady-photolog.git
git push -u origin main
```

3. `vite.config.js` の `base` が、リポジトリ名と一致しているか確認してください
   （リポジトリ名が `dady-photolog` 以外なら `base: "/リポジトリ名/"` に直す）

## 6. GitHub Pagesを有効にする

1. GitHubのリポジトリ画面で「Settings」→「Pages」
2. 「Build and deployment」の「Source」を **GitHub Actions** に設定
3. これで、mainブランチにpushするたびに自動でビルド・公開されます（`.github/workflows/deploy.yml` が実行されます）
4. 数分後、`https://【あなたのユーザー名】.github.io/dady-photolog/` でアクセスできるようになります

## ローカルで動作確認したい場合

```bash
npm install
npm run dev
```

## 注意点

- 写真は圧縮してFirestoreに保存しています（1件あたりのサイズ制限が1MBほどのため、Claude版よりやや強めに圧縮しています）
- セキュリティルールを「誰でも書き込み可」にしているため、サイトのURLとパスワードの両方を知っている人だけに教えるようにしてください
- Firebaseの無料枠（Sparkプラン）で運用できる想定ですが、写真の閲覧数・書き込み数が非常に多くなる場合は使用量をご確認ください
