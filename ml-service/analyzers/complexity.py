"""Complexity: flag functions with too many branches or too much nesting.

Both numbers are plain rules (no ML). Cyclomatic complexity starts at 1 and
grows by one for every decision point; nesting is the deepest control-flow
block inside the function. Nested functions are measured on their own, so a
small callback inside a big function does not inflate the outer score.
"""

from __future__ import annotations

import logging

from tree_sitter import Node

from analyzers.common import FUNCTION_TYPES, is_test_file, node_text, parser_for_path, walk
from pipeline.findings import Finding, Severity
from pipeline.reader import Snapshot
from pipeline.timing import TimingLog

logger = logging.getLogger("proofloop.analyzers.complexity")

DECISION_TYPES = frozenset(
    {
        "if_statement",
        "for_statement",
        "for_in_statement",
        "while_statement",
        "do_statement",
        "catch_clause",
        "ternary_expression",
        "switch_case",
    }
)

LOGICAL_OPERATORS = frozenset({"&&", "||", "??"})

NESTING_TYPES = frozenset(
    {
        "if_statement",
        "for_statement",
        "for_in_statement",
        "while_statement",
        "do_statement",
        "switch_statement",
        "try_statement",
        "with_statement",
    }
)

MIN_COMPLEXITY = 10
MIN_NESTING = 4
HIGH_COMPLEXITY = 15
HIGH_NESTING = 5

CONFIDENCE = 0.9


def _function_name(node: Node, source: bytes) -> str:
    name = node.child_by_field_name("name")
    if name is not None:
        return node_text(name, source)

    parent = node.parent
    if parent is None:
        return "<anonymous>"
    if parent.type == "variable_declarator":
        declared = parent.child_by_field_name("name")
        if declared is not None:
            return node_text(declared, source)
    if parent.type == "pair":
        key = parent.child_by_field_name("key")
        if key is not None:
            return node_text(key, source)
    if parent.type == "assignment_expression":
        left = parent.child_by_field_name("left")
        if left is not None:
            return node_text(left, source)
    return "<anonymous>"


def _function_body(node: Node) -> Node | None:
    body = node.child_by_field_name("body")
    if body is not None:
        return body
    if node.named_children and node.named_children[-1].type in {
        "statement_block",
        "expression",
        "binary_expression",
    }:
        return node.named_children[-1]
    return None


def _iter_body(node: Node):
    """Yield the function body's nodes, but never enter a nested function."""
    stack = [node]
    while stack:
        current = stack.pop()
        yield current
        for child in current.named_children:
            if child.type in FUNCTION_TYPES:
                continue
            stack.append(child)


def _cyclomatic(body: Node, source: bytes) -> int:
    score = 1
    for node in _iter_body(body):
        if node.type in DECISION_TYPES:
            score += 1
        elif node.type == "binary_expression":
            operator = node.child_by_field_name("operator")
            if operator is not None and node_text(operator, source) in LOGICAL_OPERATORS:
                score += 1
    return score


def _max_nesting(body: Node) -> int:
    best = 0
    stack: list[tuple[Node, int]] = [(body, 0)]
    while stack:
        current, depth = stack.pop()
        for child in current.named_children:
            if child.type in FUNCTION_TYPES:
                continue
            level = depth
            # `else if` is a nested if_statement in the AST but reads as one level.
            is_else_if = child.type == "if_statement" and child.parent is not None and child.parent.type == "else_clause"
            if child.type in NESTING_TYPES and not is_else_if:
                level = depth + 1
            best = max(best, level)
            stack.append((child, level))
    return best


def _severity(complexity: int, nesting: int) -> Severity:
    if complexity >= HIGH_COMPLEXITY or nesting >= HIGH_NESTING:
        return "high"
    return "medium"


def analyze_complexity(snapshot: Snapshot, *, timing: TimingLog | None = None) -> list[Finding]:
    timings = timing or TimingLog()
    findings: list[Finding] = []

    with timings.stage("analyzer.complexity"):
        for file in snapshot.paths("javascript") + snapshot.paths("typescript"):
            if is_test_file(file):
                continue
            parser = parser_for_path(file)
            if parser is None:
                continue
            try:
                source = snapshot.read_text(file).encode("utf-8")
                tree = parser.parse(source)
            except Exception as error:
                logger.warning("complexity parse failed file=%s err=%s", file, error)
                continue

            for node in walk(tree.root_node):
                if node.type not in FUNCTION_TYPES:
                    continue
                body = _function_body(node)
                if body is None:
                    continue
                complexity = _cyclomatic(body, source)
                nesting = _max_nesting(body)
                if complexity < MIN_COMPLEXITY and nesting < MIN_NESTING:
                    continue

                name = _function_name(node, source)
                findings.append(
                    Finding(
                        analyzer="complexity",
                        type="high_complexity",
                        severity=_severity(complexity, nesting),
                        confidence=CONFIDENCE,
                        file=file,
                        line=node.start_point[0] + 1,
                        message=(
                            f"{name} has cyclomatic complexity {complexity} and nesting depth {nesting}; "
                            f"the limits are {MIN_COMPLEXITY} and {MIN_NESTING}."
                        ),
                        fix_hint=(
                            "Split this function into smaller named steps and return early to remove branches; "
                            f"aim for complexity under {MIN_COMPLEXITY} and nesting under {MIN_NESTING}."
                        ),
                    )
                )

    findings.sort(key=lambda item: (item.file, item.line, item.type))
    return findings
