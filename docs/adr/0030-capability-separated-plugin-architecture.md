# Capability-Separated Plugin Architecture

Status

Accepted. The architecture inventory is confirmed. Runtime implementation remains unaccepted until a proposed slice receives explicit user acceptance and current-backlog recording.

Context

MDV は built-in Mermaid rendering、main-owned LLM tools、Markdown text rendering、repo Skill assets を持つが、これらを第三者または追加機能へ拡張する共通 plugin contract はない。inventory では code block registry の重複、固定 AI tool dispatcher、surface ごとに異なる HTML safety、固定 preload/packaging entry、未実装の product Skill runtime を確認した。一つの汎用 hook にまとめると、rendering、model tool schema、privileged execution、workflow instructions の異なる trust boundary と failure semantics が混ざる。また、manifest 型や validator を直ちに公開 SDK と呼ぶと、まだ受理していない第三者 loading、互換性、trust、配布の保証まで暗黙に約束してしまう。

Decision

[Plugin Architecture Design](../plugin-architecture-design.md) を current contract とし、manifest facts、located/package facts、derived lifecycle state を分離する。その共通 lifecycle の上に Codeblock Driver、LLM Tool Driver、Text Rendering Engine を別 capability contract として置く。Skill は fourth driver にせず、package が将来宣言し得る workflow contribution とする。Skill の eligibility、enabled state、instruction/resource loading、diagnostics は `AI-CFG-002` が所有し、Tool の permission、validation、approval、execution は main-owned LLM Tool Driver が所有する。

Main process が discovery、compatibility、permission、lifecycle、diagnostics、privileged operation を所有し、renderer access は typed preload boundary に限定する。identity collision、incompatible manifest、path escape、resource mismatch は fail closed とし、origin precedence や last-wins shadowing を使わない。Plugin-origin raw HTML/SVG、Skill による permission grant、Skill script execution はこの contract で許可しない。

Mermaid viewer は既存 built-in のまま維持し、将来 Codeblock Driver consumer にできるかを後続 slice で評価する。inventory が提案した最初の runtime 候補は、明示 import された bundled manifest だけを検証する main-owned catalog、read-only diagnostics、internal Developer Contract/Conformance Kit であり、driver dispatch や Skill injection は含まない。この候補も user acceptance と current-backlog 記録まで実装しない。

Developer support は二段階にする。最初の候補には MDV maintainer / bundled-package developer 向けの internal/experimental Developer Contract and Conformance Kit を含め、catalog と同じ schema/parser/diagnostics、型 symmetry、fixture、metadata-only sample、packaging conformance、guide を提供する。外部 Plugin developer 向け Public SDK は別 decision とし、third-party trust/load、install/update/rollback、versioning/deprecation/migration、family-specific execution/isolation、packaged E2E、distribution acceptance が揃うまで公開・互換性保証しない。Skill は Public Driver SDK family に数えず、`AI-CFG-002` workflow contract に接続する。

Consequences

Inventory は完了し、三 driver family と Skill contribution の接続境界を説明できるようになった。manifest/lifecycle の共通化は identity、compatibility、packaging、diagnostics の drift を抑えるが、capability dispatch の証明にはならない。各 family は入力 schema、runtime validation、permission、execution、rendering safety、failure isolation を独立して受理・検証する必要がある。

Dynamic loading、user/workspace discovery、public plugin API、Mermaid migration、Skill injection/script execution は引き続き blocked である。次の通常 product work は current-backlog に従い、Plugin runtime は proposed slice の明示受理がある場合だけ再開する。

Internal Kit は早期に authoring/packaging drift を検出できるが、validator success は execution authorization ではない。Public SDK への昇格は通常 refactor ではなく、support obligation を追加する明示 decision change になる。
