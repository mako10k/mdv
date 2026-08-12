# Plugin Architecture Design

## State

- `contract_state: active_contract`
- `backlog_state: accepted_active`
- `inventory_status: inventory_pending`
- Governing backlog: `ENG-BL-004`

## Objective

MDV に Codeblock Driver、LLM Tool Driver、Text Rendering Engine を追加できる plugin architecture を設計する。最初の作業は既存 extension points、trust boundary、packaging 制約の棚卸と、互いに責務を混ぜない driver contract の確定である。

次タスクは inventory と contract 設計だけである。plugin loading や Mermaid migration はまだ実装せず、inventory 結果から提案する first implementation slice を user が受理し、current-backlog に記録した後にだけ実装へ進む。

## Planning Contract

- Plugin manifest / discovery、identity、version compatibility、enable / disable、diagnostics を一つの lifecycle contract として棚卸する。
- Codeblock Driver は、ユーザーが明示的に書いた fenced code block を language / metadata に応じて図や専用表示へ変換する。document の他の text や privileged action は扱わない。
- Text Rendering Engine は、通常の Markdown から得た text を安全な表示表現へ変換する。code block 選択や file/network action を暗黙に実行しない。
- LLM Tool Driver は、model が呼び出せる action を提供し、必要なら main process に file/network などの privileged work を要求する。content renderer として任意表示を返す contract にはしない。
- 三者を分けるのは、表示 content や renderer failure に file/network action の permission と validation rule を継承させず、通常 text rendering を executable plugin behavior に変えないためである。
- main process は plugin discovery、permission、lifecycle、privileged operation を所有し、renderer は preload の typed capability boundary を越えて Node.js や任意 filesystem/network access を得ない。
- plugin-origin content は任意 HTML/SVG を trusted renderer へ直接注入しない。sanitization、navigation、subresource、CSP、resource ownership を surface ごとに fail-closed で定義する。
- built-in Mermaid viewer は既存 contract のまま維持する。inventory では将来の Codeblock Driver consumer 候補として比較するが、互換性と security evidence が揃う前に一般化・移行しない。
- development install、packaged discovery、update compatibility、failure isolation、disable/recovery、test fixture を同じ inventory に含める。

## First Inventory Deliverables

1. 現行 code block render、Mermaid viewer、AI tool schema/dispatch、Markdown rendering/sanitizer、preload IPC、settings、packaging entry の責務 map。
2. 三つの driver family の入力・出力・ownership・permission・failure semantics と、共有してよい lifecycle metadata の分離案。
3. bundled / user-installed / workspace-local plugin の候補比較。検索 path、署名・trust、update、portable/installer 差分を含む。
4. 最小 first implementation slice と acceptance tests の提案。

## Blocked Until Inventory Confirmation And First-Slice Acceptance

以下は inventory を完了するだけでは許可されない。inventory 結果から first implementation slice を提示し、user の明示受理と current-backlog への scope / acceptance 記録を完了するまで blocked とする。

- plugin directory scan、dynamic module load、user-installed executable/code の実行。
- renderer への Node integration、raw Electron access、任意 HTML/SVG injection。
- LLM help/introspection、action schema、runtime argument validation を一つの permissive schema に統合すること。
- built-in Mermaid implementation の先行移行、既存 Markdown/export behavior の変更。
- marketplace、remote install、自動更新、第三者 plugin 公開互換性の保証。

## Validation Direction

- contract tests は driver family ごとに valid/invalid payload、permission denial、timeout/crash isolation、disable/recovery を固定する。
- Electron integration は preload/main boundary と owner window lifecycle を通し、packaged checks は plugin metadata と実際の load target の一致を fail-closed で確認する。
- security-sensitive renderer entry や generated runtime が増える場合は release workflow の early contract review を適用する。
