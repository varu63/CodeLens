"""Shared tree-sitter helpers for the rule-based analyzers."""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path
from typing import Iterator

import tree_sitter_javascript
import tree_sitter_typescript
from tree_sitter import Language, Node, Parser

HTTP_METHODS = frozenset({"get", "post", "put", "patch", "delete", "options", "head", "all"})
FUNCTION_TYPES = frozenset(
    {
        "function_declaration",
        "function_expression",
        "arrow_function",
        "method_definition",
        "generator_function_declaration",
        "generator_function",
    }
)
TEST_FILE_RE = re.compile(r"(^|[._-])(test|spec)([._-]|$)", re.IGNORECASE)
TEST_DIRS = frozenset({"test", "tests", "__tests__", "spec", "specs", "fixtures"})


def is_test_file(path: str) -> bool:
    parts = path.lower().split("/")
    if any(part in TEST_DIRS for part in parts[:-1]):
        return True
    return bool(TEST_FILE_RE.search(parts[-1]))


@lru_cache(maxsize=4)
def parser_for_path(path: str) -> Parser | None:
    suffix = Path(path).suffix.lower()
    if suffix in {".js", ".jsx", ".mjs", ".cjs"}:
        return Parser(Language(tree_sitter_javascript.language()))
    if suffix == ".tsx":
        return Parser(Language(tree_sitter_typescript.language_tsx()))
    if suffix in {".ts", ".mts", ".cts"}:
        return Parser(Language(tree_sitter_typescript.language_typescript()))
    return None


def walk(node: Node) -> Iterator[Node]:
    stack = [node]
    while stack:
        current = stack.pop()
        yield current
        stack.extend(reversed(current.named_children))


def node_text(node: Node, source: bytes) -> str:
    return source[node.start_byte : node.end_byte].decode("utf-8", errors="replace")


def string_value(node: Node, source: bytes) -> str | None:
    if node.type == "string":
        raw = node_text(node, source)
        if len(raw) >= 2 and raw[0] in {"'", '"'} and raw[-1] == raw[0]:
            return raw[1:-1]
        return None
    if node.type == "template_string" and not node.named_children:
        raw = node_text(node, source)
        if len(raw) >= 2 and raw[0] == "`" and raw[-1] == "`":
            return raw[1:-1]
    return None


def arguments_of(call: Node) -> list[Node]:
    arguments = call.child_by_field_name("arguments")
    return list(arguments.named_children) if arguments is not None else []


def member_parts(node: Node | None, source: bytes) -> tuple[Node, str] | None:
    if node is None or node.type != "member_expression":
        return None
    target = node.child_by_field_name("object")
    prop = node.child_by_field_name("property")
    if target is None or prop is None:
        return None
    return target, node_text(prop, source)
