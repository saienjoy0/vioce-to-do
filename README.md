概要

このアプリは Expo（React Native） を使って作った簡単なモバイルアプリです。
ホーム画面・探索画面・モーダル画面の3つで構成されていて、タブで切り替えられるようになっています。
今後、機能を追加しながら発展させていく予定です。

使っている主な技術

React Native

Expo

Expo Router

TypeScript

フォルダ構成（ざっくり）
app/
 ├─ index.tsx      ホーム
 ├─ explore.tsx    探索画面
 ├─ modal.tsx      モーダル
 └─ _layout.tsx    タブのレイアウト
components/        共通パーツ
constants/
hooks/
assets/

動かし方
npm install
npx expo start


スマホの Expo Go で QR を読み取れば動きます。
