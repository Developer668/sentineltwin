from __future__ import annotations

import re
from pathlib import Path

TEMPLATE_PATH = Path(__file__).resolve().parents[2] / "infra" / "template.yaml"


def test_cognito_mfa_configuration_is_a_quoted_cloudformation_enum() -> None:
    template = TEMPLATE_PATH.read_text(encoding="utf-8")

    assert 'MfaConfiguration: "OPTIONAL"' in template
    assert not re.search(
        r"^\s*MfaConfiguration:\s+(?:ON|OFF|OPTIONAL)\s*$",
        template,
        re.MULTILINE,
    )


def test_guardduty_is_optional_but_trusted_open_data_verification_remains_configured() -> None:
    template = TEMPLATE_PATH.read_text(encoding="utf-8")

    assert "GuardDutyMalwareProtectionEnabled:" in template
    assert "MalwareProtectionEnabled:" in template
    assert "GUARDDUTY_MALWARE_PROTECTION_ENABLED:" in template
    assert "Condition: MalwareProtectionEnabled" in template
    assert re.search(
        r"SatelliteMalwareProtectionPlanArn:\n"
        r"\s+Condition: MalwareProtectionEnabled\n"
        r"\s+Description:.*\n"
        r"\s+Value: !GetAtt SatelliteMalwareProtectionPlan\.Arn",
        template,
    )
