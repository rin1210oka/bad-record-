# Shuttle Note

バドミントン部のメンバーと試合をチームで記録するWebアプリです。
React / TypeScript / Viteで画面を作り、Firebase Hosting・Authentication・Firestoreを使います。

## 主な機能

- 選手の自己登録・外部選手の追加・編集・論理削除・復元
- 既存名簿への紐づけ申請と、指名した参加者による本人確認
- 全角カタカナの名前、所属経験、期生、基準年度による学年の自動更新
- 公式戦・練習試合・ゲーム練、シングルス・ダブルスの記録
- 終了点やセット数を固定しない勝敗計算、検索、成績、CSV出力
- 同じ試合の重複警告、再送時の二重登録防止、版番号による同時編集の検出
- Googleアカウントの本人だけが読み書きできる試合の振り返り

## 開発

Node.js 22.13以上を使用します。

```powershell
npm ci
npm run dev
```

Webアプリの公開設定は `.env.firebase.example` を参考に `.env.local` に設定します。
秘密鍵やサービスアカウントのJSONは不要です。

- `npm run build`：公開用ファイルを作成
- `npm start`：ビルド済み画面をローカルで確認
- `npm run typecheck`：TypeScriptの型確認
- `npm run test:domain`：勝敗・学年・並び順などのテスト
- `npm run test:firebase`：権限・保存・PIN・復元のテスト（Java 21以上が必要）
- `npm test`：両方のテストを実行
- `npm run deploy`：Firebaseへ公開（所有者のFirebase CLIログインが必要）

## ファイル構成

- `firebase-web/`：入場、Googleログイン、端末PIN、Firestoreの保存処理
- `app/`：試合・メンバー・振り返りの画面とCSS
- `lib/`：入力検証、勝敗・学年・成績の計算、共通型
- `firestore.rules`：本人限定アクセスと保存内容の検証
- `tests/`：利用中の機能のテスト
- `scripts/firebase-ops.mjs`：無料プラン確認、合言葉、手動バックアップ・復元

[運用・公開・バックアップ手順](FIREBASE_RUNBOOK.md)
