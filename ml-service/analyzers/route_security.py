"""Route security: find HTTP routes that have no authentication middleware.

The tree-sitter pass is pure (snapshot in, findings out). An optional probe
makes a real no-token request from the sandbox; a 2xx answer raises confidence,
while 401/403 means something else already protects the route, so it is dropped.
"""

from __future__ import annotations

import logging
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Callable

from tree_sitter import Node

from analyzers.common import (
    HTTP_METHODS,
    arguments_of,
    is_test_file,
    member_parts,
    node_text,
    parser_for_path,
    string_value,
    walk,
)
from pipeline.findings import Finding, Severity
from pipeline.reader import Snapshot
from pipeline.timing import TimingLog

logger = logging.getLogger("proofloop.analyzers.route_security")

RouteProbe = Callable[[str, str], int | None]

PUBLIC_PATH_RE = re.compile(
    r"(^|/)(health|healthz|readyz|livez|metrics|favicon\.ico|login|signin|signup|register|public|oauth|callback|google|refresh|logout)(/|$)",
    re.IGNORECASE,
)
SENSITIVE_PATH_RE = re.compile(
    r"(admin|internal|billing|payment|account|user|profile|setting|secret|debug|database)",
    re.IGNORECASE,
)
AUTH_MIDDLEWARE_RE = re.compile(
    r"(requireauth|requirelogin|requiresignin|requireuser|requireadmin|"
    r"isauthenticated|isloggedin|isadmin|"
    r"ensureloggedin|ensureauth|ensureuser|"
    r"authmiddleware|authguard|authorize|authenticate|passport\.|"
    r"verifyjwt|verifytoken|jwt|bearer|"
    r"protect|permit|allowroles|roles?guard|adminonly)",
    re.IGNORECASE,
)
ROUTER_NAME_RE = re.compile(r"(app|api|router|routes?|server)$", re.IGNORECASE)

BASE_CONFIDENCE = 0.8
CONFIRMED_CONFIDENCE = 0.95


@dataclass(frozen=True)
class _Route:
    file: str
    line: int
    method: str
    path: str
    middleware: tuple[str, ...]


@dataclass(frozen=True)
class _Guard:
    prefix: str


def _chained_route_path(target: Node, source: bytes) -> str | None:
    if target.type != "call_expression":
        return None
    parts = member_parts(target.child_by_field_name("function"), source)
    if parts is None or parts[1] != "route":
        return None
    args = arguments_of(target)
    return string_value(args[0], source) if args else None


def _router_variables(tree_root: Node, source: bytes) -> set[str]:
    """Names assigned from express()/Router(), so short names like `r` still count."""
    names: set[str] = set()
    for node in walk(tree_root):
        if node.type != "variable_declarator":
            continue
        name = node.child_by_field_name("name")
        value = node.child_by_field_name("value")
        if name is None or value is None or name.type != "identifier":
            continue
        value_text = node_text(value, source)
        if "express" in value_text or re.search(r"\bRouter\(", value_text):
            names.add(node_text(name, source))
    return names


def _looks_like_router(target: Node, source: bytes, router_variables: set[str]) -> bool:
    if target.type == "identifier":
        name = node_text(target, source)
        return name in router_variables or bool(ROUTER_NAME_RE.search(name))

    if target.type == "member_expression":
        prop = target.child_by_field_name("property")
        name = node_text(prop, source) if prop is not None else ""
        return bool(name) and bool(ROUTER_NAME_RE.search(name))

    if target.type == "call_expression":
        parts = member_parts(target.child_by_field_name("function"), source)
        return parts is not None and _looks_like_router(parts[0], source, router_variables)

    return False


def _extract(
    file: str, source: bytes, tree_root: Node
) -> tuple[list[_Route], list[_Guard]]:
    routes: list[_Route] = []
    guards: list[_Guard] = []
    router_variables = _router_variables(tree_root, source)

    for node in walk(tree_root):
        if node.type != "call_expression":
            continue
        parts = member_parts(node.child_by_field_name("function"), source)
        if parts is None:
            continue
        target, prop = parts
        prop_lower = prop.lower()
        args = arguments_of(node)

        if prop_lower in HTTP_METHODS:
            if not _looks_like_router(target, source, router_variables):
                continue
            path = _chained_route_path(target, source)
            if path is None:
                path = string_value(args[0], source) if args else None
                middleware_args = args[1:]
            else:
                middleware_args = args
            if path is None or not path.startswith("/"):
                continue
            routes.append(
                _Route(
                    file=file,
                    line=node.start_point[0] + 1,
                    method=prop.upper(),
                    path=path,
                    middleware=tuple(node_text(arg, source) for arg in middleware_args),
                )
            )
            continue

        if prop_lower == "use" and args:
            if not _looks_like_router(target, source, router_variables):
                continue
            first_string = string_value(args[0], source)
            if first_string is not None:
                prefix = first_string.rstrip("/") or "/"
                middleware_args = args[1:]
            else:
                prefix = "/"
                middleware_args = args
            if any(AUTH_MIDDLEWARE_RE.search(node_text(arg, source)) for arg in middleware_args):
                guards.append(_Guard(prefix=prefix))

    return routes, guards


def _is_public(path: str) -> bool:
    if path == "/":
        return True
    return bool(PUBLIC_PATH_RE.search(path))


def _is_guarded(route: _Route, guards: list[_Guard]) -> bool:
    if any(AUTH_MIDDLEWARE_RE.search(item) for item in route.middleware):
        return True
    for guard in guards:
        if guard.prefix == "/":
            return True
        if route.path == guard.prefix or route.path.startswith(guard.prefix + "/"):
            return True
    return False


def _severity(method: str, path: str) -> Severity:
    if method != "GET" or SENSITIVE_PATH_RE.search(path):
        return "high"
    return "medium"


def _probe_eligible(method: str, path: str) -> bool:
    return (
        method == "GET"
        and path.startswith("/")
        and not path.startswith("//")
        and not any(marker in path for marker in (":", "*", "?", " "))
    )


def _safe_probe(probe: RouteProbe | None, method: str, path: str) -> int | None:
    if probe is None:
        return None
    try:
        status = probe(method, path)
    except Exception as error:  # a probe failure must never break the analyzer
        logger.warning("route probe failed method=%s path=%s err=%s", method, path, error)
        return None
    return status if isinstance(status, int) else None


def http_probe(base_url: str, *, timeout_seconds: float = 2.0) -> RouteProbe:
    """Return a GET-only, no-redirect, no-token probe for a sandbox base URL."""
    base = base_url.rstrip("/")

    class _NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[override]
            return None

    opener = urllib.request.build_opener(_NoRedirect)

    def probe(method: str, path: str) -> int | None:
        if method.upper() != "GET" or not _probe_eligible(method.upper(), path):
            return None
        request = urllib.request.Request(
            base + path,
            method="GET",
            headers={"User-Agent": "proofloop-route-probe"},
        )
        try:
            with opener.open(request, timeout=timeout_seconds) as response:
                return int(response.status)
        except urllib.error.HTTPError as error:
            return int(error.code)
        except (urllib.error.URLError, TimeoutError, OSError):
            return None

    return probe


def analyze_route_security(
    snapshot: Snapshot,
    *,
    probe: RouteProbe | None = None,
    timing: TimingLog | None = None,
) -> list[Finding]:
    timings = timing or TimingLog()
    findings: list[Finding] = []

    with timings.stage("analyzer.route_security"):
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
                logger.warning("route parse failed file=%s err=%s", file, error)
                continue

            routes, guards = _extract(file, source, tree.root_node)
            for route in routes:
                if _is_public(route.path) or _is_guarded(route, guards):
                    continue

                status: int | None = None
                if probe is not None and _probe_eligible(route.method, route.path):
                    with timings.stage("analyzer.route_security.probe"):
                        status = _safe_probe(probe, route.method, route.path)

                if status in (401, 403):
                    continue

                if status is not None and 200 <= status < 300:
                    confidence = CONFIRMED_CONFIDENCE
                    message = (
                        f"Route {route.method} {route.path} answered {status} without a token; "
                        "no authentication middleware was found."
                    )
                else:
                    confidence = BASE_CONFIDENCE
                    message = f"Route {route.method} {route.path} has no authentication middleware."

                findings.append(
                    Finding(
                        analyzer="route_security",
                        type="unprotected_route",
                        severity=_severity(route.method, route.path),
                        confidence=confidence,
                        file=route.file,
                        line=route.line,
                        message=message,
                        fix_hint=(
                            "Add an authentication middleware (for example requireAuth) to this route, "
                            "or remove it from the public surface."
                        ),
                    )
                )

    findings.sort(key=lambda item: (item.file, item.line, item.type))
    return findings
