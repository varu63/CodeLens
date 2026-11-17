"""Data mapping: does the frontend read fields the API response never returns?

Both sides are plain tree-sitter rules. On the backend we collect the top-level
keys of object literals passed to `res.json(...)` inside an Express route. On
the frontend we follow a `fetch(url)` -> response -> `data` binding and collect
the top-level keys read from that data. A key read on the frontend but absent
from every response body of the same method + path is a finding.

The analyzer stays quiet when it cannot prove the shapes: identifier responses
(`res.json(project)`), spreads, computed keys, dynamic paths, base-URL templates
and handlers passed by name are all skipped.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from tree_sitter import Node

from analyzers.common import (
    FUNCTION_TYPES,
    HTTP_METHODS,
    arguments_of,
    is_test_file,
    member_parts,
    node_text,
    parser_for_path,
    string_value,
    walk,
)
from pipeline.findings import Finding
from pipeline.reader import Snapshot
from pipeline.timing import TimingLog

logger = logging.getLogger("proofloop.analyzers.data_mapping")

RESPONSE_OBJECTS = frozenset({"res", "response"})
CONFIDENCE = 0.8


@dataclass(frozen=True)
class _RouteShape:
    method: str
    path: str
    fields: frozenset[str]


@dataclass(frozen=True)
class _Read:
    file: str
    line: int
    method: str
    path: str
    field: str


def _normalize_path(raw: str) -> str:
    path = raw.split("?", 1)[0].split("#", 1)[0]
    if not path.startswith("/"):
        path = "/" + path
    if len(path) > 1:
        path = path.rstrip("/")
    return path


def _object_keys(node: Node, source: bytes) -> frozenset[str] | None:
    """Top-level keys of an object literal, or None when the shape is unknown."""
    keys: set[str] = set()
    for child in node.named_children:
        if child.type == "pair":
            key = child.child_by_field_name("key")
            if key is None:
                return None
            if key.type in {"property_identifier", "number"}:
                keys.add(node_text(key, source))
            elif key.type == "string":
                value = string_value(key, source)
                if value is None:
                    return None
                keys.add(value)
            else:
                return None
        elif child.type == "shorthand_property_identifier":
            keys.add(node_text(child, source))
        else:
            # spread_element, method_definition, computed_property_name, ...
            return None
    return frozenset(keys) if keys else None


def _same_node(left: Node, right: Node) -> bool:
    return (
        left.type == right.type
        and left.start_byte == right.start_byte
        and left.end_byte == right.end_byte
    )


def _chain_root_name(node: Node | None, source: bytes) -> str | None:
    """`res.status(500).json` -> `res`; `api.res.json` -> `api`."""
    while node is not None:
        if node.type == "identifier":
            return node_text(node, source)
        if node.type == "member_expression":
            node = node.child_by_field_name("object")
            continue
        if node.type == "call_expression":
            node = node.child_by_field_name("function")
            continue
        return None
    return None


def _enclosing_function(node: Node) -> Node | None:
    current = node.parent
    while current is not None:
        if current.type in FUNCTION_TYPES:
            return current
        current = current.parent
    return None


def _handler_route(handler: Node, source: bytes) -> tuple[str, str] | None:
    """Route only when the handler is written inline as the route argument."""
    parent = handler.parent
    if parent is None or parent.type != "arguments":
        return None
    call = parent.parent
    if call is None or call.type != "call_expression":
        return None
    parts = member_parts(call.child_by_field_name("function"), source)
    if parts is None or parts[1].lower() not in HTTP_METHODS:
        return None
    args = arguments_of(call)
    if not args:
        return None
    path = string_value(args[0], source)
    if path is None:
        return None
    return parts[1].upper(), _normalize_path(path)


def _backend_shapes(tree_root: Node, source: bytes) -> list[_RouteShape]:
    shapes: list[_RouteShape] = []
    for node in walk(tree_root):
        if node.type != "call_expression":
            continue
        parts = member_parts(node.child_by_field_name("function"), source)
        if parts is None or parts[1].lower() != "json":
            continue
        if _chain_root_name(parts[0], source) not in RESPONSE_OBJECTS:
            continue
        args = arguments_of(node)
        if not args or args[0].type != "object":
            continue
        fields = _object_keys(args[0], source)
        if fields is None:
            continue
        handler = _enclosing_function(node)
        if handler is None:
            continue
        route = _handler_route(handler, source)
        if route is None:
            continue
        shapes.append(_RouteShape(method=route[0], path=route[1], fields=fields))
    return shapes


def _fetch_request(node: Node, source: bytes) -> tuple[str, str] | None:
    function = node.child_by_field_name("function")
    if function is None or function.type != "identifier" or node_text(function, source) != "fetch":
        return None
    args = arguments_of(node)
    if not args:
        return None
    path = string_value(args[0], source)
    if path is None:
        return None

    method = "GET"
    if len(args) > 1 and args[1].type == "object":
        options = args[1]
        for child in options.named_children:
            if child.type != "pair":
                continue
            key = child.child_by_field_name("key")
            value = child.child_by_field_name("value")
            if key is not None and node_text(key, source) == "method" and value is not None:
                explicit = string_value(value, source)
                if explicit is not None:
                    method = explicit.upper()
    return _normalize_path(path), method


def _await_binding(node: Node) -> Node | None:
    """`const name = await <node>` -> the declarator whose name is bound."""
    awaited = node.parent
    if awaited is None or awaited.type != "await_expression":
        return None
    declarator = awaited.parent
    if declarator is None or declarator.type != "variable_declarator":
        return None
    value = declarator.child_by_field_name("value")
    if value is None or not _same_node(value, awaited):
        return None
    return declarator


def _pattern_keys(pattern: Node, source: bytes) -> list[tuple[str, int]]:
    keys: list[tuple[str, int]] = []
    for child in pattern.named_children:
        if child.type == "shorthand_property_identifier_pattern":
            keys.append((node_text(child, source), child.start_point[0] + 1))
        elif child.type == "pair_pattern":
            key = child.child_by_field_name("key")
            if key is None:
                continue
            value = node_text(key, source) if key.type != "string" else string_value(key, source)
            if value:
                keys.append((value, key.start_point[0] + 1))
        elif child.type == "object_assignment_pattern":
            left = child.child_by_field_name("left")
            if left is not None:
                keys.append((node_text(left, source), left.start_point[0] + 1))
        elif child.type == "rest_pattern":
            continue
    return keys


def _json_call(node: Node, response_name: str, source: bytes) -> bool:
    parts = member_parts(node.child_by_field_name("function"), source)
    if parts is None or parts[1].lower() != "json":
        return False
    target = parts[0]
    return target.type == "identifier" and node_text(target, source) == response_name


def _then_json_callback(node: Node, fetch_call: Node, source: bytes) -> bool:
    """`fetch(url).then((r) => r.json())`"""
    parts = member_parts(node.child_by_field_name("function"), source)
    if parts is None or parts[1] != "then" or not _same_node(parts[0], fetch_call):
        return False
    args = arguments_of(node)
    if len(args) != 1:
        return False
    callback = args[0]
    if callback.type not in {"arrow_function", "function_expression"}:
        return False
    parameters = callback.child_by_field_name("parameters")
    if parameters is None or len(parameters.named_children) != 1:
        return False
    parameter = parameters.named_children[0]
    if parameter.type != "identifier":
        return False
    name = node_text(parameter, source)
    body = callback.child_by_field_name("body")
    if body is None:
        return False
    for inner in walk(body):
        if inner.type == "call_expression" and _json_call(inner, name, source):
            return True
    return False


def _data_bindings(fetch_call: Node, scope: Node, source: bytes) -> tuple[list[str], list[tuple[str, int]]]:
    """Return (data variable names, direct destructured reads) for one fetch."""
    names: list[str] = []
    destructured: list[tuple[str, int]] = []

    response_declarator = _await_binding(fetch_call)
    if response_declarator is not None:
        name_node = response_declarator.child_by_field_name("name")
        if name_node is not None and name_node.type == "identifier":
            response_name = node_text(name_node, source)
            for node in walk(scope):
                if node.type != "call_expression" or not _json_call(node, response_name, source):
                    continue
                declarator = _await_binding(node)
                if declarator is None:
                    continue
                data_name = declarator.child_by_field_name("name")
                if data_name is None:
                    continue
                if data_name.type == "identifier":
                    names.append(node_text(data_name, source))
                elif data_name.type == "object_pattern":
                    destructured.extend(_pattern_keys(data_name, source))

    for node in walk(scope):
        if node.type != "call_expression" or not _then_json_callback(node, fetch_call, source):
            continue
        declarator = _await_binding(node)
        if declarator is None:
            continue
        data_name = declarator.child_by_field_name("name")
        if data_name is not None and data_name.type == "identifier":
            names.append(node_text(data_name, source))

    return names, destructured


def _reads_of(
    scope: Node, data_names: list[str], source: bytes
) -> list[tuple[str, int]]:
    if not data_names:
        return []
    wanted = set(data_names)
    reads: list[tuple[str, int]] = []
    for node in walk(scope):
        if node.type == "member_expression":
            obj = node.child_by_field_name("object")
            prop = node.child_by_field_name("property")
            if (
                obj is not None
                and obj.type == "identifier"
                and node_text(obj, source) in wanted
                and prop is not None
            ):
                reads.append((node_text(prop, source), node.start_point[0] + 1))
        elif node.type == "subscript_expression":
            obj = node.child_by_field_name("object")
            index = node.child_by_field_name("index")
            if obj is not None and obj.type == "identifier" and node_text(obj, source) in wanted:
                key = string_value(index, source) if index is not None else None
                if key is not None:
                    reads.append((key, node.start_point[0] + 1))
        elif node.type == "variable_declarator":
            name = node.child_by_field_name("name")
            value = node.child_by_field_name("value")
            if (
                name is not None
                and name.type == "object_pattern"
                and value is not None
                and value.type == "identifier"
                and node_text(value, source) in wanted
            ):
                reads.extend(_pattern_keys(name, source))
    return reads


def _frontend_reads(tree_root: Node, file: str, source: bytes) -> list[_Read]:
    reads: list[_Read] = []
    for node in walk(tree_root):
        if node.type != "call_expression":
            continue
        request = _fetch_request(node, source)
        if request is None:
            continue
        path, method = request
        scope = _enclosing_function(node) or tree_root
        data_names, destructured = _data_bindings(node, scope, source)
        collected = list(destructured) + _reads_of(scope, data_names, source)
        for field, line in collected:
            reads.append(_Read(file=file, line=line, method=method, path=path, field=field))
    return reads


def analyze_data_mapping(snapshot: Snapshot, *, timing: TimingLog | None = None) -> list[Finding]:
    timings = timing or TimingLog()
    findings: list[Finding] = []

    with timings.stage("analyzer.data_mapping"):
        shapes: dict[tuple[str, str], set[str]] = {}
        reads: list[_Read] = []

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
                logger.warning("data mapping parse failed file=%s err=%s", file, error)
                continue

            for shape in _backend_shapes(tree.root_node, source):
                shapes.setdefault((shape.method, shape.path), set()).update(shape.fields)
            reads.extend(_frontend_reads(tree.root_node, file, source))

        grouped: dict[tuple[str, int, str, str], set[str]] = {}
        for item in reads:
            backend_fields = shapes.get((item.method, item.path))
            if backend_fields is None or item.field in backend_fields:
                continue
            grouped.setdefault((item.file, item.line, item.method, item.path), set()).add(item.field)

        for (file, line, method, path), missing in grouped.items():
            names = ", ".join(sorted(missing))
            findings.append(
                Finding(
                    analyzer="data_mapping",
                    type="missing_response_field",
                    severity="medium",
                    confidence=CONFIDENCE,
                    file=file,
                    line=line,
                    message=(
                        f"Frontend reads {names} from {method} {path}, "
                        "but the route response body does not define "
                        f"{'these fields' if len(missing) > 1 else 'this field'}."
                    ),
                    fix_hint=(
                        "Return the field(s) in the route response body, or stop reading them in the frontend."
                    ),
                )
            )

    findings.sort(key=lambda item: (item.file, item.line, item.type))
    return findings
