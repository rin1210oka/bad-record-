# Firebase版の起動・検証・公開・保守

## 現在の構成

Firebase Hosting（Spark）・Googleログイン・Firestoreを利用するブラウザーアプリ。
Cloud Functions / Cloud Run / Firebase App Hostingは使わない。
従来のVinext / D1版と新Firebase版は別のビルドで、同じ試合・選手画面と計算処理を共有する。
Firebaseの公開先は `https://match-record-8ac41.web.app/`。公開操作が完了するまでは利用できない。

実装は `firebase-web/`、公開設定は `firebase.json`、アクセス制限は `firestore.rules`。
従来版は`npm run dev:d1` / `npm run build:d1` で起動・ビルドできる。旧サイトの削除は行わない。

## ローカル設定と検証

1. `npm ci` で依存を導入する。
2. `.env.firebase.example` を参考に、登録済みWebアプリの公開設定を `.env.local` に入れる。
3. `npm run dev:firebase` で確認する。
4. `npm run build:firebase` で `dist-firebase/` を作る。
5. `node node_modules/typescript/bin/tsc --noEmit` と `node --test tests/*.test.mjs` で既存機能を確認する。
6. Java 21以上を準備し、`npm run test:firebase` を実行する。テストは `demo-shuttle-note` のエミュレーター専用で、本番には接続しない。

ブラウザーからエミュレーターを使う場合だけ、開発環境の `VITE_USE_FIREBASE_EMULATORS=true` と
`firebase emulators:start --only auth,firestore --project demo-shuttle-note` を使う。
本番ビルドではエミュレーターに接続しない。テスト用ユーザー・合言葉を本番へ投入しない。

## 初回公開の手順

1. `firebase login` でプロジェクト所有者がGoogleの承認を行う。秘密鍵ファイルは不要。
2. `node scripts/firebase-ops.mjs status` で課金が無効であることとFirestoreの所在を確認する。
3. Firebase Authenticationのログイン方法でGoogleを有効にし、プロジェクトのサポートメールを設定する。
4. Authenticationの承認済みドメインに公開先の `match-record-8ac41.web.app` があることを確認する。
5. `node scripts/firebase-ops.mjs backup` で移行前のFirebaseデータを保存する。既存ルールと公開版がある場合も控える。
6. 旧D1側の選手・試合・フィードバック件数を確認する。2026-11-05 JSTの調査時点では3表とも0件だった。
7. 既存データが増えていた場合、切替前に再調査・移行する。氏名一致で旧アカウントの個人情報を新UIDへ移さない。
8. `firebase deploy --only firestore:rules,firestore:indexes` を先に実行する。
9. `node scripts/firebase-ops.mjs join-code` で合言葉を作る。`.firebase-tools/team-access.txt` に保存される。
10. 合言葉はランダム16文字。新規参加受付の有効期限は発行から1年間で、期限後も既存参加者は利用できる。
11. `npm run build:firebase` 後、`firebase deploy --only hosting` で公開する。
12. 所有者本人がGoogleで初回登録・PIN設定を確認し、別アカウントの振り返りが見えないことを確認する。
13. 検証後にURL・QRと合言葉を部内に配る。合言葉をリポジトリ・公開ページに掲載しない。

課金アカウントの接続、Blazeへの変更、Functionsの導入は行わない。
OAuth承認・Firebase設定が済むまでは、公開済み・利用開始可能と案内しない。

## 利用者の操作

- 初回：共通URL → 合言葉 → Googleログイン → 選手情報の自己登録 → 4桁の端末PIN。
- 合言葉の本当の照合はGoogle認証後のFirestore登録時。ログインだけでは部の記録は読めない。
- 次回：この端末の4桁PINで簡易ロック解除。
- PIN忘れ・変更：同じGoogleアカウントで再認証して再設定。
- 新端末や保存領域消去後：Google再認証後に端末PINを設定する。
- Googleアカウントを失った場合：他のGoogleアカウントで自動的に個人の振り返りを引き継がない。保守担当による別途の本人確認が必要。
- 部長の承認や毎年の管理者権限の移譲は不要。部への所属や入力氏名の正しさは部内の信頼を前提とする。
- 同名・同所属の選手がすでにいる場合は登録を止める。既存選手を選んでその人のアカウントになる操作は用意しない。

## PINと権限の限界

4桁PINは端末の簡易画面ロックであり、サーバー側の追加認証・暗号化ではない。
端末内のFirebaseログイン情報を操作できる人に対する強い保護を保証しない。
OSの画面ロックを使い、共用端末ではGoogleからログアウトする。
PINは平文を保存せず端末内で導出するが、4桁の総当たりへの耐性には限界がある。
PINの失敗が5回に達した画面ではGoogle再認証へ誘導する。これは端末内の補助機能で、サーバーの試行制限ではない。

フィードバックはFirebase UIDの専用パスに置き、他の部員が読めないRulesを適用する。
Firebaseプロジェクトの特権管理者にも読めないエンドツーエンド暗号化とは異なる。
合言葉を知る第三者や部員の悪意ある自己申告による偽名登録を、承認なしで完全には防げない。

## 保存と整合性

- セット数・終了点は固定しない。UIの得点配列は保存境界だけ `15:9` のような文字列の配列へ変換する。
- 生年月日は端末で入学基準年度に変換し、生年月日そのものは保存しない。
- 選手と試合は版番号付きトランザクションで編集する。削除は論理削除。
- 名前予約と試合の重複確認用の文書をトランザクションで更新し、同時保存を直列化する。
- 同条件の別試合は従来どおり明示確認後に保存できる。悪意あるクライアントもこの許可を指定できるため、重複確認は不正な試合の存在そのものを防ぐ仕組みではない。
- 同じ保存IDの再送は内容が一致した場合だけ成功扱いにする。
- 共有の更新は更新日時による差分取得。論理削除も差分に含む。30秒間隔・画面復帰時の更新を維持する。
- 振り返りは本人の20件ずつ取得。「もっと見る」で過去分を読む。
- 本文の永続オフラインキャッシュは使わない。ネットワーク不通時の保存完了は表示しない。

## 無料バックアップと復元

`node scripts/firebase-ops.mjs backup` はFirestore REST APIで文書を取得し、`backups/` に保存する。
親文書のない個人フィードバックのサブコレクションも含めて走査する。
通常の読み取り枠を消費する。Firestoreの有料バックアップ機能は使わない。
手動バックアップは一括の時点整合スナップショットではないので、利用していない時間帯に取得する。
公開前・大きな変更前・定期的な節目に保守担当が実行し、端末故障に備えて別の安全な保管先にもコピーする。
秘密情報と個人の文章を含むため、GitHub・公開ページ・部内共有フォルダーには入れない。

`node scripts/firebase-ops.mjs restore <backup.json>` は空の同一プロジェクトに対して復元予定だけを確認する。
`--apply` を追加すると既存文書を上書きせず復元する。空でなければ拒否する。
200文書ごとに書くため全体は原子的ではない。失敗時に自動削除してやり直さず、保守担当がバックアップと途中状態を照合する。
実データでの復元を行う前に、エミュレーターまたは隔離した検証先で復元試験をする。

## 問題が起きた場合

- 新規参加だけ止める：保守担当が該当 `joinKeys` 文書の `enabled` をfalseにする。既存参加者の権限は変わらない。
- 特定アカウントを止める：保守担当が該当 `memberships/{uid}` の `active` をfalseにする。
- 画面の不具合：Hostingで以前の公開版へ戻す。データ・Rulesが自動で戻るわけではない。
- 初回切替を中止：新URLの配布を止め、保持している旧サイトへ戻す。Firebaseで入力済みの新記録をD1へ自動で戻せるとは扱わない。
- Firebase側の記録を消してロールバックしない。先にバックアップと差分を保存する。

## 2026-11-05時点の検証状況

- TypeScript型確認とFirebase用の本番ビルドが成功。
- 既存テスト99件、新規Rules・保存処理・PIN・バックアップ復元テスト21件が成功。
- ローカルブラウザーで合言葉入力 → Googleログイン案内まで表示・遷移を確認。
- Firebase CLIの所有者ログイン、無料プラン確認、データ・旧Rulesバックアップが完了。
- Hosting・Rules・インデックスを本番反映し、公開URLで入場画面を確認した。
- Googleログイン有効化済み・課金無効をAPIで確認。本番での本人による初回登録・PIN設定は未確認。

認証アカウントも保全する場合は、Googleログイン有効化後に `firebase auth:export backups/auth-users.json --format=json` で別途保存する。FirestoreバックアップだけではAuthenticationのユーザー記録やGoogleプロバイダー設定は復元されない。ユーザーの再作成時にUIDが変わると、同じメールでも個人の振り返りは自動で引き継がない。

## 新しい作業フォルダーでの点検（2026-11-05）

- 作業場所：`C:\Users\rin12\dev\bad-record-`。GitHubのD1版に、公開済みFirebase版の実装を取り込んだ。
- 標準の `npm run dev` / `npm run build` / `npm start` はFirebase版を使用。D1旧版は `:d1` 付きで起動する。
- 認証設定エラーを日本語化し、開発中のReactルートの二重作成を防いだ。
- ロックやログアウトの前に始まった取得結果を、再解除後に返さないよう入場状態の世代を照合する。
- 開発用エミュレーターは実プロジェクトIDではなく `demo-shuttle-note` に固定した。
- 既存99件・Firebase関連21件のテスト、TypeScript型確認、Firebaseビルドが成功。
- 本番用依存関係の `npm audit --omit=dev` は既知の問題0件。開発専用依存関係を含む全件0という意味ではない。
