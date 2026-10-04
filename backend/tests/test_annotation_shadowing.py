"""No Python 3.13 (o das imagens Docker), `date: date | None = None` dentro de uma classe avalia o valor
antes da anotacao: o nome `date` ja virou None e `None | None` derruba a importacao do modulo. No 3.14
(anotacoes adiadas) o erro some, entao os testes locais nao pegam. Este teste le o codigo e recusa o padrao.
`date: Mapped[date] = mapped_column(...)` dos modelos nao entra: sem o `|` nada e calculado com o nome."""

import ast
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"


def shadowed_annotations(source: str) -> list[tuple[int, str]]:
    """(linha, nome) de campos de classe com valor cuja anotacao faz `nome | algo` com o proprio nome do campo."""
    found = []
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, ast.ClassDef):
            continue
        for item in node.body:
            if isinstance(item, ast.AnnAssign) and item.value is not None and isinstance(item.target, ast.Name):
                for union in ast.walk(item.annotation):
                    if isinstance(union, ast.BinOp) and isinstance(union.op, ast.BitOr):
                        used = {name.id for name in ast.walk(union) if isinstance(name, ast.Name)}
                        if item.target.id in used:
                            found.append((item.lineno, item.target.id))
                            break
    return found


def test_the_detector_finds_the_bad_pattern_and_leaves_the_good_ones():
    bad = "from datetime import date\nclass Sample:\n    date: date | None = None\n"
    assert shadowed_annotations(bad) == [(3, "date")]
    good = (
        "import datetime as dt\nfrom datetime import date\n"
        "class Sample:\n    date: dt.date | None = None\n    date_from: date | None = None\n    date: date\n"
    )
    assert shadowed_annotations(good) == []
    # Sem o `|` nada e calculado com o nome: o padrao dos modelos do SQLAlchemy continua valendo
    model = "class Row:\n    date: Mapped[date] = mapped_column(Date)\n    other: Mapped[date | None] = mapped_column(Date)\n"
    assert shadowed_annotations(model) == []
    assert shadowed_annotations("class Row:\n    date: Mapped[date | None] = mapped_column(Date)\n") == [(2, "date")]


def test_no_class_field_has_a_default_and_an_annotation_that_uses_its_own_name():
    problems = []
    for path in sorted(APP.rglob("*.py")):
        for line, name in shadowed_annotations(path.read_text(encoding="utf-8")):
            problems.append(f"{path.relative_to(APP.parent)}:{line} campo {name}")
    assert problems == [], "Quebra no Python 3.13; use um alias do modulo (ex: dt.date): " + "; ".join(problems)
