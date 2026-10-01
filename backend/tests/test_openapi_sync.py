from scripts.export_openapi import OUTPUT_PATH, build_openapi_json


def test_committed_openapi_matches_the_api():
    """O frontend gera tipos a partir de frontend/openapi.json. Se um endpoint mudou e o
    arquivo nao foi regenerado, o frontend compilaria contra uma API que nao existe mais."""
    committed = OUTPUT_PATH.read_text(encoding="utf-8")
    assert committed == build_openapi_json(), (
        "frontend/openapi.json esta desatualizado. Rode: "
        "cd backend && python scripts/export_openapi.py && cd ../frontend && npm run gen:api"
    )
