from __future__ import annotations

import re
from pathlib import Path

TEMPLATE_PATH = Path(__file__).resolve().parents[2] / "infra" / "template.yaml"


def test_cognito_mfa_configuration_is_a_quoted_cloudformation_enum() -> None:
    template = TEMPLATE_PATH.read_text(encoding="utf-8")

    assert 'MfaConfiguration: "ON"' in template
    assert not re.search(
        r"^\s*MfaConfiguration:\s+(?:ON|OFF|OPTIONAL)\s*$",
        template,
        re.MULTILINE,
    )
