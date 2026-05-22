# MDV Editor

Windows で動作するシンプルな Markdown エディタです。Electron 上で動作し、WYSIWYG 編集、Markdown ソース編集、diff、patch、CodeBlock renderer 拡張を 1 つのアプリにまとめています。

## 特徴

- 最小 UI
- WYSIWYG / Markdown ソース切り替え
- diff 表示と unified patch 適用
- ドラッグアンドドロップでファイル読込
- Open / Save / Save As
- fenced code block の renderer 差し替え
- Windows 向け standalone 配布

## 画面構成

- Write: 編集画面
- Preview: Markdown プレビュー
- Diff: baseline と現在文書の差分、および patch 適用

上部ツールバーだけを残し、余白を削って編集領域を優先しています。

## 開発

前提:

- Node.js 22 系
- npm

起動:

```bash
npm install
npm run dev
```

ビルド:

```bash
npm run build
```

## Windows 配布

Linux / WSL での `electron-builder --win portable` は Wine を要求します。確実に Windows 配布物を作る場合は、Windows ホスト側の Node.js で実行してください。

Windows ホスト build 補助スクリプト:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command '& "\\wsl.localhost\Ubuntu\home\katsumata-m\mdv\scripts\build-win-host.ps1"'
```

このスクリプトは UAC 昇格を要求します。Windows 側の一時ディレクトリへソースをコピーし、互換 Node.js を用意して native build します。成果物は `release/windows-host` へ戻します。
また、実行用コピーを Windows ローカルパス `%LOCALAPPDATA%\MDV-Editor\latest` に配置します。`\\wsl.localhost\...` の UNC パスから直接 exe を起動しないでください。

Portable build:

```bash
npm run dist:win
```

Windows host build from WSL:

```bash
npm run dist:win:host
```

昇格なしで直接試す場合:

```bash
npm run dist:win:host:noadmin
```

unpacked build:

```bash
npm run dist:win:dir
```

生成物:

- portable: `release/*.exe`
- unpacked: `release/win-unpacked/MDV-Editor.exe`
- Windows host recovered build: `release/windows-host/win-unpacked/MDV-Editor.exe`
- local runnable copy: `%LOCALAPPDATA%\MDV-Editor\latest\MDV-Editor.exe`
- runtime log: `%APPDATA%\MDV Editor\logs\mdv.log`

注意:

- portable の単一 EXE 化は、Windows 側で symlink 展開権限が無いと `winCodeSign` 展開時に失敗することがあります。
- その場合でも `win-unpacked` は生成されるため、standalone アプリとしては利用できます。
- `\\wsl.localhost\...` の UNC パス上の exe は GPU subprocess 起動に失敗することがあるため、Windows ローカルへコピーされた exe を起動してください。
- 白画面や起動失敗のときは `%APPDATA%\MDV Editor\logs\mdv.log` を確認してください。

## ファイル操作

- Open: ファイル選択ダイアログから読込
- Save: 現在のパスに保存
- Save As: 保存先を選んで保存
- Drag and Drop: `.md` / `.markdown` / `.txt` を直接読込

## CodeBlock 拡張

renderer registry は [src/App.tsx](src/App.tsx) にあります。言語名ごとに React コンポーネントを登録します。

```tsx
registry.set('mermaid', MermaidBlock)
```

同じ仕組みで `sql`, `plantuml`, `chart` などを追加できます。

## 主要ファイル

- [src/App.tsx](src/App.tsx): UI、本体ロジック、renderer registry
- [electron/main.cjs](electron/main.cjs): Electron メインプロセス、ファイルダイアログ、保存処理
- [electron/preload.cjs](electron/preload.cjs): renderer へ公開する desktop API
- [build/icon.ico](build/icon.ico): Windows アプリ用アイコン
