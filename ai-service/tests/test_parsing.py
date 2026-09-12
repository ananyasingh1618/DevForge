"""Tests for the tree-sitter-backed parser (app/parsing/) and its
POST /parsing/parse endpoint.

Not an LLM call, so unlike every other agent's tests, there is no
"provider not configured" case here — parsing has no provider dependency at
all. Fixtures are deterministic source strings; no real GitHub or real
credentials are used or required.
"""

from fastapi.testclient import TestClient

from app.parsing.parser import detect_language, parse_file
from main import app

client = TestClient(app)

PY_FIXTURE = """
class Foo:
    def bar(self, x):
        def inner():
            pass
        return x

def top_level(a, b=1):
    return a + b
"""

TS_FIXTURE = """
interface Foo {
  bar(): void;
}

class Baz implements Foo {
  private x: number;
  constructor(x: number) { this.x = x; }
  bar(): void {
    const inner = () => { return 1; };
  }
}

function topLevel(a: number, b: number = 1): number {
  return a + b;
}

export const arrow = (x: number) => x * 2;

type Alias = { a: number };
"""

JS_FIXTURE = """
function greet(name) {
  return `hi ${name}`;
}

class Widget {
  render() {
    return "ok";
  }
}
"""

MALFORMED_JS_FIXTURE = "function foo( {"


class TestDetectLanguage:
    def test_python(self):
        assert detect_language("app.py") == "python"

    def test_typescript(self):
        assert detect_language("app.ts") == "typescript"
        assert detect_language("app.tsx") == "typescript"

    def test_javascript(self):
        assert detect_language("app.js") == "javascript"
        assert detect_language("app.jsx") == "javascript"
        assert detect_language("app.mjs") == "javascript"
        assert detect_language("app.cjs") == "javascript"

    def test_unsupported(self):
        assert detect_language("README.md") is None
        assert detect_language("image.png") is None
        assert detect_language("no_extension") is None


class TestParseFilePython:
    def test_extracts_nested_symbols_with_correct_parents(self):
        result = parse_file("a.py", PY_FIXTURE)
        assert result.status == "parsed"
        assert result.language == "python"
        by_name = {s.name: s for s in result.symbols}

        assert by_name["Foo"].type == "class"
        assert by_name["Foo"].parent_index is None

        assert by_name["bar"].type == "method"
        assert by_name["bar"].signature == "(self, x)"
        foo_index = result.symbols.index(by_name["Foo"])
        assert by_name["bar"].parent_index == foo_index

        assert by_name["inner"].type == "function"
        bar_index = result.symbols.index(by_name["bar"])
        assert by_name["inner"].parent_index == bar_index

        assert by_name["top_level"].type == "function"
        assert by_name["top_level"].parent_index is None
        assert by_name["top_level"].signature == "(a, b=1)"


class TestParseFileTypeScript:
    def test_extracts_class_interface_type_alias_and_arrow_function(self):
        result = parse_file("a.ts", TS_FIXTURE)
        assert result.status == "parsed"
        assert result.language == "typescript"
        by_name = {s.name: s for s in result.symbols}

        assert by_name["Foo"].type == "interface"
        assert by_name["Baz"].type == "class"
        assert by_name["Alias"].type == "type_alias"

        assert by_name["bar"].type == "method"
        baz_index = result.symbols.index(by_name["Baz"])
        assert by_name["bar"].parent_index == baz_index

        assert by_name["inner"].type == "function"
        bar_index = result.symbols.index(by_name["bar"])
        assert by_name["inner"].parent_index == bar_index

        # A top-level `export const arrow = (x) => x * 2` is still found,
        # via the generic fallthrough into export_statement's children.
        assert by_name["arrow"].type == "function"
        assert by_name["arrow"].parent_index is None
        assert by_name["arrow"].signature == "(x: number)"

        assert by_name["topLevel"].signature == "(a: number, b: number = 1)"

    def test_tsx_extension_uses_the_tsx_grammar(self):
        result = parse_file("a.tsx", "function Widget() { return null; }")
        assert result.status == "parsed"
        assert result.language == "typescript"
        assert result.symbols[0].name == "Widget"


class TestParseFileJavaScript:
    def test_extracts_function_and_class(self):
        result = parse_file("a.js", JS_FIXTURE)
        assert result.status == "parsed"
        assert result.language == "javascript"
        by_name = {s.name: s for s in result.symbols}
        assert by_name["greet"].type == "function"
        assert by_name["Widget"].type == "class"
        assert by_name["render"].type == "method"


class TestParseFileErrorsAndUnsupported:
    def test_malformed_source_is_a_parse_error_with_no_symbols(self):
        result = parse_file("bad.js", MALFORMED_JS_FIXTURE)
        assert result.status == "parse_error"
        assert result.symbols == []
        assert result.error is not None

    def test_unsupported_extension_never_attempts_a_parse(self):
        result = parse_file("README.md", "# hello")
        assert result.status == "unsupported"
        assert result.language is None
        assert result.symbols == []


class TestParsingEndpoint:
    def test_post_parsing_parse_success(self):
        res = client.post("/parsing/parse", json={"path": "a.py", "content": "def f(x):\n    return x\n"})
        assert res.status_code == 200
        body = res.json()
        assert body["status"] == "parsed"
        assert body["language"] == "python"
        assert body["symbols"][0]["name"] == "f"

    def test_post_parsing_parse_unsupported(self):
        res = client.post("/parsing/parse", json={"path": "a.md", "content": "# hi"})
        assert res.status_code == 200
        assert res.json()["status"] == "unsupported"

    def test_post_parsing_parse_validation_error_on_missing_content(self):
        res = client.post("/parsing/parse", json={"path": "a.py"})
        assert res.status_code == 400
        assert res.json()["error"]["code"] == "VALIDATION_ERROR"
