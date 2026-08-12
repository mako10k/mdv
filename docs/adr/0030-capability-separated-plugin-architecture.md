# Capability-Separated Plugin Architecture

Status

Accepted for architecture inventory; runtime implementation is not accepted until inventory is confirmed and the proposed first slice receives explicit user acceptance and current-backlog recording.

Context

MDV は built-in Mermaid rendering、main-owned LLM tools、Markdown text rendering を持つが、これらを第三者または追加機能へ拡張する共通 plugin contract はない。一つの汎用 hook にまとめると、rendering、model tool schema、privileged execution の異なる trust boundary と failure semantics が混ざる。

Decision

[Plugin Architecture Design](../plugin-architecture-design.md) を current contract とし、共通 lifecycle metadata の上に Codeblock Driver、LLM Tool Driver、Text Rendering Engine を別 capability contract として設計する。main process が discovery、permission、lifecycle、privileged operation を所有し、renderer access は typed preload boundary に限定する。Mermaid viewer は既存 built-in のまま維持し、将来 Codeblock Driver を利用する候補になり得るかを inventory で比較するだけとする。first implementation slice が受理されるまで移行しない。

Consequences

Plugin Architecture inventory を次の優先作業にできる一方、dynamic loading や public plugin API はまだ許可されない。三つの driver family は重複 metadata を共有できるが、入力 schema、validation、permission、execution、rendering safety を相互に流用して曖昧にしてはならない。packaging、failure isolation、compatibility、security evidence が first implementation slice の前提になる。
