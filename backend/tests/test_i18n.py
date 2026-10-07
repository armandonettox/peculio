from app.core.i18n import pick, resolve_lang


def test_resolve_lang_portugues_de_qualquer_pais_vira_pt_br():
    assert resolve_lang("pt-BR") == "pt-BR"
    assert resolve_lang("pt-PT") == "pt-BR"
    assert resolve_lang("pt") == "pt-BR"
    assert resolve_lang("PT-br,en;q=0.5") == "pt-BR"


def test_resolve_lang_qualquer_outro_idioma_vira_en_us():
    assert resolve_lang("en-US") == "en-US"
    assert resolve_lang("es-ES") == "en-US"
    assert resolve_lang("fr") == "en-US"


def test_resolve_lang_sem_cabecalho_cai_no_idioma_de_origem():
    assert resolve_lang(None) == "pt-BR"
    assert resolve_lang("") == "pt-BR"


def test_pick_escolhe_o_texto_do_idioma():
    assert pick("pt-BR", "Valor vazio", "Amount is empty") == "Valor vazio"
    assert pick("en-US", "Valor vazio", "Amount is empty") == "Amount is empty"
