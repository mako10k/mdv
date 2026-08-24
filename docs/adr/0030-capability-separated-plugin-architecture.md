# Capability-Separated Plugin Architecture

Status

Accepted. The architecture inventory is confirmed. Runtime implementation remains unaccepted until a proposed slice receives explicit user acceptance and current-backlog recording.

Context

MDV は built-in Mermaid rendering、main-owned LLM tools、Markdown text rendering、repo Skill assets を持つが、これらを第三者または追加機能へ拡張する共通 plugin contract はない。inventory では code block registry の重複、固定 AI tool dispatcher、surface ごとに異なる HTML safety、固定 preload/packaging entry、未実装の product Skill runtime を確認した。一つの汎用 hook にまとめると、rendering、model tool schema、privileged execution、workflow instructions の異なる trust boundary と failure semantics が混ざる。

Decision

[Plugin Architecture Design](../plugin-architecture-design.md) を current contract とし、manifest facts、located/package facts、derived lifecycle state を分離する。その共通 lifecycle の上に Codeblock Driver、LLM Tool Driver、Text Rendering Engine を別 capability contract として置く。Skill は fourth driver にせず、package が将来宣言し得る workflow contribution とする。Skill の eligibility、enabled state、instruction/resource loading、diagnostics は `AI-CFG-002` が所有し、Tool の permission、validation、approval、execution は main-owned LLM Tool Driver が所有する。

Main process が discovery、compatibility、permission、lifecycle、diagnostics、privileged operation を所有し、renderer access は typed preload boundary に限定する。identity collision、incompatible manifest、path escape、resource mismatch は fail closed とし、origin precedence や last-wins shadowing を使わない。Plugin-origin raw HTML/SVG、Skill による permission grant、Skill script execution はこの contract で許可しない。

Mermaid viewer は既存 built-in のまま維持し、将来 Codeblock Driver consumer にできるかを後続 slice で評価する。inventory が提案した最初の runtime 候補は、明示 import された bundled manifest だけを検証する main-owned catalog と read-only diagnostics であり、driver dispatch や Skill injection は含まない。この候補も user acceptance と current-backlog 記録まで実装しない。

Consequences

Inventory は完了し、三 driver family と Skill contribution の接続境界を説明できるようになった。manifest/lifecycle の共通化は identity、compatibility、packaging、diagnostics の drift を抑えるが、capability dispatch の証明にはならない。各 family は入力 schema、runtime validation、permission、execution、rendering safety、failure isolation を独立して受理・検証する必要がある。

Dynamic loading、user/workspace discovery、public plugin API、Mermaid migration、Skill injection/script execution は引き続き blocked である。次の通常 product work は current-backlog に従い、Plugin runtime は proposed slice の明示受理がある場合だけ再開する。
