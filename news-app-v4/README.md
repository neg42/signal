# 📡 SIGNAL — パーソナルニュースアプリ

**外部サービスへのユーザー登録は一切不要です。**
必要なのは GitHub アカウントのみです。

---

## 収集しているニュースソース

| 種別 | 方法 | 登録 |
|------|------|------|
| ANN テレ朝 / TBS NEWS DIG / FNN / 日テレ / テレ東 / MBS | スクレイピング | 不要 |
| NHK / 朝日 / 毎日 / 読売 / 東洋経済 ほか 25ソース | RSS | 不要 |
| Hacker News | 公開API（Firebase） | 不要 |

---

## セットアップ手順（GitHub のみ）

### STEP 1　リポジトリを作成する

1. https://github.com/new を開く
2. Repository name に `signal-news`（任意）と入力
3. Private または Public どちらでも可
   ※ ただし GitHub Pages の無料公開は **Public** のみ対応
4. 「Create repository」をクリック

---

### STEP 2　ファイルをアップロードする

ダウンロードした ZIP を解凍すると `news-app-v4` フォルダができます。

#### 方法 A：ブラウザのみ（コマンド不要）

1. 作成したリポジトリページで「uploading an existing file」をクリック
2. `news-app-v4` フォルダの中身を**すべて選択**してドラッグ＆ドロップ
3. ページ下部「Commit changes」をクリック

> Mac の Finder では `.github` フォルダが非表示になります。
> その場合は後述の「.github フォルダが見えない場合」を参照してください。

#### 方法 B：Git コマンド（ターミナルが使える場合）

```
cd news-app-v4
git init
git add .
git commit -m "SIGNAL 初期セットアップ"
git branch -M main
git remote add origin https://github.com/あなたのユーザー名/signal-news.git
git push -u origin main
```

---

### STEP 3　GitHub Pages を有効化する

1. リポジトリの「Settings」タブを開く
2. 左メニューから「Pages」を選択
3. Source を「Deploy from a branch」に設定
4. Branch を「main」/「/ (root)」に設定
5. 「Save」をクリック

数分後に以下の URL でアクセスできます：

    https://あなたのユーザー名.github.io/signal-news/

Safari のブックマークバーに追加しておくと便利です。

---

### STEP 4　GitHub Actions を有効化する

1. リポジトリの「Actions」タブを開く
2. 「I understand my workflows, go ahead and enable them」をクリック
3. 左の一覧から「SIGNAL ニュース自動収集」を選択
4. 「Enable workflow」をクリック

これで 15分ごとに自動収集が始まります。

今すぐ実行したい場合：
- 「Actions」→「SIGNAL ニュース自動収集」→「Run workflow」→「Run workflow」
- 1〜2分後にニュースが表示されます

---

### STEP 5　Safari で開いてブックマーク登録

    https://あなたのユーザー名.github.io/signal-news/

リロードするだけで最新ニュースに更新されます。

---

## .github フォルダが見えない場合（Mac）

macOS の Finder は「.」から始まるフォルダを非表示にします。

方法1：ターミナルで git add . を使う（方法Bで対応済み）

方法2：GitHub で手動作成する
1. リポジトリで「Add file」→「Create new file」をクリック
2. ファイル名に「.github/workflows/update-news.yml」と入力
3. news-app-v4/.github/workflows/update-news.yml の内容をコピーして貼り付け
4. 「Commit changes」をクリック

---

## よくある質問

Q: ニュースが表示されない
A: Actions が一度も実行されていない可能性があります。STEP 4 の手動実行を試してください。

Q: カスタム RSS を追加したい
A: アプリ内「ソースを管理」から RSS URL を追加できます。

Q: Private リポジトリにしたい
A: GitHub Actions は動きますが、GitHub Pages（公開 URL）は無料プランでは Public のみ対応です。

---

## ファイル構成

    signal-news/
    ├── index.html
    ├── style.css
    ├── app.js
    ├── data/
    │   ├── news.json       ← GitHub Actions が 15分ごとに更新
    │   └── meta.json
    ├── scripts/
    │   ├── fetch-news.js
    │   └── package.json
    └── .github/
        └── workflows/
            └── update-news.yml
