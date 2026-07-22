# Typography Interaction Design

- Status: Accepted
- Contract state: `active_contract`
- Backlog item: `MD-BL-025`
- Accepted date: 2026-07-22

## Purpose

この文書は、MDV editor window における文字サイズ変更の current contract を定義する。対象は Settings、既存の `Ctrl/Cmd + +/-/0`、および `Ctrl/Cmd + wheel` であり、永続値、対象 surface、入力抑制、main / renderer の責務を一つの契約へ揃える。

[Settings Screen Design](settings-design.md) の main-owned settings 境界と [ADR 0001](adr/0001-settings-store-and-secret-boundary.md) を維持し、今回の cross-process decision は [ADR 0027](adr/0027-main-owned-typography-adjustment.md) に記録する。

## Product Outcome

- document の編集・閲覧中は、pointer が editor または rendered preview 上にある状態で primary modifier を押しながら wheel を動かすと、document typography を 1px 単位で変更できる。
- AI chat の transcript または composer 上では、同じ gesture が chat typography を変更する。
- 変更結果は既存 Settings と同じ値へ保存され、別 editor window、Settings window、再起動後の表示と一致する。
- 通常の wheel scroll、app chrome、dialog、responsive breakpoint は文字サイズ変更の影響を受けない。

## Canonical Settings

文字サイズの正本と範囲は既存設定を維持する。

| Target | Setting | Default | Range | CSS variable |
| --- | --- | ---: | ---: | --- |
| `editor` | `editor.fontSizePx` | 13px | 11–18px | `--editor-font-size` |
| `chat` | `ai.chatFontSizePx` | 12px | 11–16px | `--chat-font-size` |

- Markdown source、WYSIWYG、rendered preview、preview code block は `editor` target を共有する。
- AI chat transcript と composer は `chat` target を共有する。
- Settings の selector は正本値を直接設定する。shortcut と wheel は後述の typed adjustment command で同じ正本値を変更する。
- Electron `webContents` zoom、CSS transform、document ごとの zoom 値、新しい zoom setting は使用しない。

## Target Resolution

入力種別ごとに target resolver を分離する。resolver が返した後の typed adjustment dispatch だけを共有し、一つの helper に focus と pointer の二つの意味を持たせない。

### Keyboard

- 既存の `Ctrl/Cmd + +/-/0` は focus-based contract を維持する。
- Markdown source または WYSIWYG editor に focus がある場合は `editor`。
- AI chat composer に focus がある場合は `chat`。
- preview、chat transcript、outline、toolbar、dialog、その他の app chrome は keyboard typography target にしない。

### Wheel

wheel target は event の pointer location から解決する。

- Markdown source container、WYSIWYG editor container、rendered preview 内は `editor`。
- AI chat transcript または composer 内は `chat`。
- outline、toolbar、status / toast、AI dock header、resize handle、search UI、modal / dialog、その他の app chrome は値を変更しない。
- descendant element、code block、link、image 上の event は最も近い eligible typography surface に属する。pointer 下の selection や keyboard focus は target 判定に使わない。
- preview に outline を追加することや outline 自体を拡大することは、この contract に含めない。

## Wheel Gesture

- Windows / Linux は `Ctrl`、macOS は `Meta` を primary modifier とする。反対側の platform modifier、`Alt`、`Shift` を同時に押した gesture は対象外とする。
- `deltaY < 0` は increase、`deltaY > 0` は decrease とする。`deltaY === 0` の horizontal-only input は値を変更しない。
- eligible surface では 1 accepted wheel step を 1px の変更とする。
- 同一 renderer / target では rate gate と burst coalescing を行い、一つの物理 notch が複数 event として届いても複数 step に増幅しない。抑制された event は追加変更を生成しない。
- primary-modifier wheel は editor window 内で MDV が予約し、capture phase の non-passive listener で browser default を防ぐ。eligible surface 以外では no-op とし、Chromium page zoom にフォールスルーさせない。
- primary modifier を伴わない wheel と対象外 modifier の wheel は interception せず、既存 scroll を維持する。
- active change-proposal modal がある間は primary-modifier wheel を prevent したうえで no-op とし、背面 typography を変更しない。

rate gate の時間値や wheel delta threshold は永続 product contract にしない。初期値は implementation validation で discrete mouse wheel と high-resolution trackpad を確認して決め、次を満たした evidence を残す。

- discrete wheel の 1 notch が 1px step になる。
- 短い一回の trackpad gesture が default から上下限へ飛ばない。
- 継続した同方向 gesture は段階的に進み、反対方向の gesture は不自然に待たされない。
- accepted step より多い settings mutation を発生させず、同時 invoke / persist を発生させない。

## Typed Adjustment And Persistence

renderer から main process へ送る adjustment は、target と operation を明示した discriminated union とする。

```ts
type MdvTypographyAdjustment =
  | { target: 'editor' | 'chat'; kind: 'delta'; steps: number }
  | { target: 'editor' | 'chat'; kind: 'reset' }

type MdvTypographyAdjustmentResult = {
  changed: boolean
  target: 'editor' | 'chat'
  valuePx: number
  settings: MdvSettings
}
```

- `steps` は非ゼロの有限整数だけを受け付ける。renderer は同じ target の連続した delta intent を範囲内でまとめてもよいが、reset または target 変更をまたいで並べ替えない。
- preload は dedicated `adjustTypography(adjustment)` を公開する。generic `updateSettings` に operation shape を混在させない。
- main process は payload を検証し、command 実行時点の settings 正本へ delta または default reset を適用して target 固有 bounds で clamp する。
- response は changed / no-op、確定 target / value、全体の authoritative settings を一つの shape で返す。renderer は request payload や local ref から確定値を再構成しない。
- typography adjustment、generic non-secret `updateSettings`、legacy theme migration、pending fetch prompt からの ACL rule 保存を含む全 non-secret settings mutation は一つの main-owned settings mutation queue で直列化する。各 mutation は queue 上で current state を読み、persist に成功してから settings-changed を broadcast し、authoritative result を返す。
- fetch ACL decision は prompt 表示中の snapshot を直接保存しない。prompt 完了後に queue 上の最新 `ai.fetch.aclText` へ decision rule を追加し、その確定値で request を再評価する。
- clamp 後の値が current value と同じ場合は成功 no-op とし、settings file を再書込せず、broadcast もしない。
- queue 上の一つの失敗は後続 mutation を破棄しない。失敗した request だけを reject し、main の最後に persist 済みの settings を正本として維持する。

この command は相対操作を main-owned state へ原子的に適用する。renderer が読み取った古い絶対値を patch として送らないため、複数 editor window や Settings window の変更を stale value で巻き戻さない。

## Renderer Dispatch And Feedback

- keyboard と wheel は別 resolver を通した後、同じ target-independent adjustment coordinator へ intent を渡す。
- coordinator は一つの renderer から同時に複数の adjustment invoke を開始しない。in-flight 中の adjacent delta intent は target ごとの bounds 内でまとめ、reset と target change の順序は保持する。
- CSS と local typography ref は main から返る authoritative settings または settings-changed eventだけで更新する。未保存の絶対値を renderer authority として表示しない。
- 成功時は target と確定値を status / toast に表示する。bounds での no-op は同じ確定値を維持し、不要な保存成功を装わない。
- 失敗時は queued local intent を破棄し、`getSettings()` で authoritative settings を再取得して表示を同期し、error を status / toast に表示する。自動 retry はしない。
- Settings window からの変更と他 editor window の変更は、main broadcast により全 surface へ反映する。

## Alternatives Considered

### Electron / Chromium page zoom

app chrome、dialog、outline、AI dock、responsive breakpoint まで拡大縮小し、document readability と window layout を一つの値へ結合するため採用しない。

### Renderer-owned absolute settings patch per wheel event

実装量は少ないが、高頻度 IPC / file write、複数 window 間の lost update、遅い acknowledgement による stale overwrite を残すため採用しない。

### Renderer debounce plus absolute patch

write 回数は減るが、debounce 中に Settings または別 editor が更新した値を古い絶対値で上書きできる。競合の根本原因である authority boundary を直さないため採用しない。

## Validation Contract

### Main / Node

- discriminated union の valid / invalid payload、target 固有 default / bounds、delta / reset を固定する。
- concurrent typography adjustment と generic settings update が main queue の到着順で適用され、persist / broadcast が直列化されることを確認する。
- pending fetch ACL decision と typography / generic settings update が競合しても、prompt 中の stale ACL text や他 settings field を上書きしないことを確認する。
- bounds no-op が persist / broadcast を発生させず、一つの persist failure 後も後続 mutation が実行できることを確認する。

### Browser Renderer

- Markdown source、WYSIWYG、preview が `editor`、chat transcript / composer が `chat` を解決することを確認する。
- outline、toolbar、AI header、dialog では値が変わらず、primary-modifier wheel の browser default だけが抑止されることを確認する。
- unmodified wheel scroll、1px step、rate gate / burst coalescing、上下限、Settings broadcast、failure resync、既存 `Ctrl/Cmd + +/-/0` と reset を確認する。
- active change proposal 中に keyboard と wheel の両方が背面 typography を変更しないことを確認する。

### Electron Integration

- editor / preview / AI surface の gesture 後も `webContents` zoom factor と app chrome の寸法が変わらないことを確認する。
- typography の確定値が別 editor window と Settings window に broadcast され、再起動後も維持されることを確認する。

## Implementation Slice

- shared target / adjustment request / result types と、pending fetch ACL 保存を含む main-owned settings mutation queue
- main IPC handler、preload API、`src/shims.d.ts` の同期
- keyboard focus resolver を維持した shared adjustment coordinator
- wheel pointer resolver と non-passive capture listener
- main / browser / Electron regression tests

この design の完了は `IMPLEMENT_ZOOM` を dependency-ready にするが、実装完了や release 掲載を意味しない。
