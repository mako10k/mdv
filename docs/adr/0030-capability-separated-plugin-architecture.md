# Capability-Separated Plugin Architecture

Status

Accepted. The architecture inventory is confirmed. The user explicitly accepted the bounded metadata/catalog/Internal Kit slice on 2026-08-25, and current-backlog records it as `ENG-BL-005`. Executable drivers, Skill runtime integration, dynamic discovery, installation, and Public SDK scope remain unaccepted.

Context

MDV は built-in Mermaid rendering、main-owned LLM tools、Markdown text rendering、repo Skill assets を持つが、これらを第三者または追加機能へ拡張する共通 plugin contract はない。inventory では code block registry の重複、固定 AI tool dispatcher、surface ごとに異なる HTML safety、固定 preload/packaging entry、未実装の product Skill runtime を確認した。一つの汎用 hook にまとめると、rendering、model tool schema、privileged execution、workflow instructions の異なる trust boundary と failure semantics が混ざる。また、manifest 型や validator を直ちに公開 SDK と呼ぶと、まだ受理していない第三者 loading、互換性、trust、配布の保証まで暗黙に約束してしまう。

Decision

[Plugin Architecture Design](../plugin-architecture-design.md) を current contract とし、manifest facts、located/package facts、derived lifecycle state を分離する。その共通 lifecycle の上に Codeblock Driver、LLM Tool Driver、Text Rendering Engine を別 capability contract として置く。Skill は fourth driver にせず、package が将来宣言し得る workflow contribution とする。Skill の eligibility、enabled state、instruction/resource loading、diagnostics は `AI-CFG-002` が所有し、Tool の permission、validation、approval、execution は main-owned LLM Tool Driver が所有する。

Main process が discovery、compatibility、permission、lifecycle、diagnostics、privileged operation を所有し、renderer access は typed preload boundary に限定する。identity collision、incompatible manifest、path escape、resource mismatch は fail closed とし、origin precedence や last-wins shadowing を使わない。Plugin-origin raw HTML/SVG、Skill による permission grant、Skill script execution はこの contract で許可しない。

Mermaid viewer は既存 built-in のまま維持し、将来 Codeblock Driver consumer にできるかを後続 slice で評価する。`ENG-BL-005` は、明示登録された bundled manifest だけを検証する main-owned catalog、read-only diagnostics、internal Developer Contract/Conformance Kit を実装する。canonical machine-readable contract から schema、TypeScript contract、reference を生成し、catalog と developer validator は同じ parser/diagnostic path を使う。driver dispatch や Skill injection は含まない。

Developer support は二段階にする。最初の候補には MDV maintainer / bundled-package developer 向けの internal/experimental Developer Contract and Conformance Kit を含め、catalog と同じ schema/parser/diagnostics、型 symmetry、fixture、metadata-only sample、packaging conformance、guide を提供する。外部 Plugin developer 向け Public SDK は別 decision とし、third-party trust/load、install/update/rollback、versioning/deprecation/migration、family-specific execution/isolation、packaged E2E、distribution acceptance が揃うまで公開・互換性保証しない。Skill は Public Driver SDK family に数えず、`AI-CFG-002` workflow contract に接続する。

Consequences

Inventory と `ENG-BL-005` implementation により、三 driver family と Skill contribution の接続境界に加え、bundled package identity、compatibility、packaging、diagnostics を機械的に検証できる。これは capability dispatch の証明にはならない。各 family は入力 schema、runtime validation、permission、execution、rendering safety、failure isolation を独立して受理・検証する必要がある。

Dynamic loading、user/workspace discovery、public plugin API、Mermaid migration、Skill injection/script execution は引き続き blocked である。`ENG-BL-005` を release-ready とする前に exact-diff review、automated regression、Windows packaged-candidate evidence を完了する。

Internal Kit は早期に authoring/packaging drift を検出できるが、validator success は execution authorization ではない。Public SDK への昇格は通常 refactor ではなく、support obligation を追加する明示 decision change になる。
