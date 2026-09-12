"""tree-sitter-backed AST parsing and symbol extraction.

Supports exactly three languages — Python, TypeScript, JavaScript — matching
docs/CODEBASE_INDEX_PHASE_PLAN.md. Any other extension is `"unsupported"`;
nothing here claims support for a language it does not actually parse.

Symbol extraction covers class/interface/type_alias/function/method
declarations, mirroring the node-type mapping prototyped and confirmed
against real tree-sitter grammars during Phase 7 planning (see
docs/CODEBASE_INDEX_PHASE_PROGRESS.md, Milestone 1). It does not cover every
AST node (e.g. plain variables, import statements, object-literal methods) —
see the plan doc's "Explicit limitations".
"""

from __future__ import annotations

from dataclasses import dataclass, field

import tree_sitter_javascript as tsjavascript
import tree_sitter_python as tspython
import tree_sitter_typescript as tstypescript
from tree_sitter import Language, Node, Parser

from app.parsing.schemas import ParseFileResponse, SymbolInfo

EXTENSION_LANGUAGES: dict[str, str] = {
    ".py": "python",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
}


def detect_language(path: str) -> str | None:
    for ext, language in EXTENSION_LANGUAGES.items():
        if path.endswith(ext):
            return language
    return None


# Language objects are immutable grammar definitions, safe to build once and
# reuse; a fresh Parser is created per parse_file() call below so no
# request-scoped parse state is ever shared.
_LANGUAGE_CACHE: dict[str, Language] = {}


def _tree_sitter_language(path: str, language: str) -> Language:
    if language == "python":
        cache_key = "python"
        builder = lambda: Language(tspython.language())  # noqa: E731
    elif language == "javascript":
        cache_key = "javascript"
        builder = lambda: Language(tsjavascript.language())  # noqa: E731
    elif language == "typescript":
        cache_key = "tsx" if path.endswith(".tsx") else "typescript"
        builder = (
            (lambda: Language(tstypescript.language_tsx()))
            if cache_key == "tsx"
            else (lambda: Language(tstypescript.language_typescript()))
        )
    else:
        raise ValueError(f"Unsupported language: {language}")

    if cache_key not in _LANGUAGE_CACHE:
        _LANGUAGE_CACHE[cache_key] = builder()
    return _LANGUAGE_CACHE[cache_key]


@dataclass
class _Extracted:
    node: Node
    name: str
    type: str
    parent: "_Extracted | None"
    index: int = field(default=-1)


def _node_name(node: Node) -> str | None:
    name_node = node.child_by_field_name("name")
    return name_node.text.decode("utf-8") if name_node is not None else None


def _signature(node: Node) -> str | None:
    params = node.child_by_field_name("parameters")
    if params is not None:
        return params.text.decode("utf-8")
    # A single unparenthesized arrow-function param (`x => x * 2`) has no
    # "parameters" field — fall back to the lone identifier parameter.
    if node.type == "arrow_function":
        for child in node.children:
            if child.type == "identifier":
                return child.text.decode("utf-8")
    return None


def _record(results: list[_Extracted], node: Node, name: str, kind: str, parent: _Extracted | None) -> _Extracted:
    extracted = _Extracted(node=node, name=name, type=kind, parent=parent, index=len(results))
    results.append(extracted)
    return extracted


def _extract_python(root: Node) -> list[_Extracted]:
    results: list[_Extracted] = []

    def walk(node: Node, parent: _Extracted | None) -> None:
        current = parent
        if node.type == "class_definition":
            name = _node_name(node)
            if name:
                current = _record(results, node, name, "class", parent)
        elif node.type == "function_definition":
            name = _node_name(node)
            if name:
                kind = "method" if parent is not None and parent.type == "class" else "function"
                current = _record(results, node, name, kind, parent)
        for child in node.children:
            walk(child, current)

    walk(root, None)
    return results


def _extract_ts_js(root: Node) -> list[_Extracted]:
    results: list[_Extracted] = []

    def walk(node: Node, parent: _Extracted | None) -> None:
        current = parent
        if node.type == "class_declaration":
            name = _node_name(node)
            if name:
                current = _record(results, node, name, "class", parent)
        elif node.type == "interface_declaration":
            name = _node_name(node)
            if name:
                current = _record(results, node, name, "interface", parent)
        elif node.type == "type_alias_declaration":
            name = _node_name(node)
            if name:
                _record(results, node, name, "type_alias", parent)
        elif node.type == "function_declaration":
            name = _node_name(node)
            if name:
                current = _record(results, node, name, "function", parent)
        elif node.type == "method_definition":
            name = _node_name(node)
            if name:
                current = _record(results, node, name, "method", parent)
        elif node.type == "variable_declarator":
            name_node = node.child_by_field_name("name")
            value_node = node.child_by_field_name("value")
            if (
                name_node is not None
                and value_node is not None
                and value_node.type in ("arrow_function", "function_expression")
            ):
                current = _record(
                    results, value_node, name_node.text.decode("utf-8"), "function", parent
                )
        for child in node.children:
            walk(child, current)

    walk(root, None)
    return results


def parse_file(path: str, content: str) -> ParseFileResponse:
    """Parses one file's source and extracts its symbols. Never fabricates a
    result: an unsupported extension is reported as such, and a genuine
    syntax error is reported as `"parse_error"` with no symbols, rather than
    silently returning a partial or empty-but-"successful" result."""
    language = detect_language(path)
    if language is None:
        return ParseFileResponse(language=None, status="unsupported")

    ts_language = _tree_sitter_language(path, language)
    parser = Parser(ts_language)
    tree = parser.parse(content.encode("utf-8"))

    if tree.root_node.has_error:
        return ParseFileResponse(
            language=language,
            status="parse_error",
            error="Source contains syntax errors that prevented parsing.",
        )

    extracted = (
        _extract_python(tree.root_node)
        if language == "python"
        else _extract_ts_js(tree.root_node)
    )

    symbols = [
        SymbolInfo(
            name=item.name,
            type=item.type,
            start_line=item.node.start_point[0] + 1,
            end_line=item.node.end_point[0] + 1,
            parent_index=item.parent.index if item.parent is not None else None,
            signature=_signature(item.node),
        )
        for item in extracted
    ]

    return ParseFileResponse(language=language, status="parsed", symbols=symbols)
