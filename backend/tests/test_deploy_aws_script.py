from __future__ import annotations

import os
import subprocess
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


def _write_executable(path: Path, source: str) -> None:
    path.write_text(source, encoding="utf-8")
    path.chmod(0o755)


def _run_deploy_script(
    tmp_path: Path,
    *,
    caller_arn: str = "arn:aws:iam::123456789012:user/test-deployer",
    root_mfa_enabled: str = "1",
    lambda_quota: str = "10",
    overrides: dict[str, str] | None = None,
) -> tuple[subprocess.CompletedProcess[str], str]:
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    sam_log = tmp_path / "sam.log"

    _write_executable(
        fake_bin / "aws",
        """#!/usr/bin/env bash
set -euo pipefail
case "$1 $2" in
  "sts get-caller-identity")
    if [[ " $* " == *" --query Account "* ]]; then
      echo "123456789012"
    elif [[ " $* " == *" --query Arn "* ]]; then
      echo "$FAKE_CALLER_ARN"
    else
      echo '{"Account":"123456789012"}'
    fi
    ;;
  "iam get-account-summary")
    echo "$FAKE_ROOT_MFA_ENABLED"
    ;;
  "lambda get-account-settings")
    echo "$FAKE_LAMBDA_QUOTA"
    ;;
  "cloudformation describe-stacks")
    echo '[]'
    ;;
  *)
    echo "Unexpected fake aws command: $*" >&2
    exit 97
    ;;
esac
""",
    )
    _write_executable(
        fake_bin / "sam",
        """#!/usr/bin/env bash
set -euo pipefail
if [[ "${FAKE_REJECT_SAM_BUILD_MODE:-0}" == "1" && -n "${SAM_BUILD_MODE:-}" ]]; then
  echo "reserved SAM_BUILD_MODE leaked into AWS SAM" >&2
  exit 96
fi
printf '%s\n' "$*" >> "$FAKE_SAM_LOG"
""",
    )
    _write_executable(
        fake_bin / "docker",
        """#!/usr/bin/env bash
set -euo pipefail
[[ "${1:-}" == "info" ]]
""",
    )
    _write_executable(
        fake_bin / "python3.12",
        """#!/usr/bin/env bash
exit 0
""",
    )
    _write_executable(
        fake_bin / "uname",
        """#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  -s) echo "${FAKE_UNAME_S:-Linux}" ;;
  -m) echo "${FAKE_UNAME_M:-x86_64}" ;;
  *) echo "${FAKE_UNAME_S:-Linux} ${FAKE_UNAME_M:-x86_64}" ;;
esac
""",
    )

    environment = {
        **os.environ,
        "PATH": f"{fake_bin}:{os.environ['PATH']}",
        "FAKE_CALLER_ARN": caller_arn,
        "FAKE_ROOT_MFA_ENABLED": root_mfa_enabled,
        "FAKE_LAMBDA_QUOTA": lambda_quota,
        "FAKE_SAM_LOG": str(sam_log),
        "DATABASE_SECRET_ARN": "arn:aws:secretsmanager:us-west-2:123456789012:secret:test",
    }
    environment.update(overrides or {})

    result = subprocess.run(
        ["bash", "scripts/deploy-aws.sh"],
        cwd=REPOSITORY_ROOT,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )
    return result, sam_log.read_text(encoding="utf-8") if sam_log.exists() else ""


def test_new_account_defaults_omit_reserved_concurrency_and_detailed_metrics(tmp_path: Path):
    result, sam_log = _run_deploy_script(tmp_path, lambda_quota="10")

    assert result.returncode == 0, result.stderr
    assert "deploy" in sam_log
    assert "ApiReservedConcurrency=0" in sam_log
    assert "IngestionReservedConcurrency=0" in sam_log
    assert "ApiDetailedMetricsEnabled=false" in sam_log
    assert "build --use-container" in sam_log


def test_requested_reservations_fail_before_sam_when_account_quota_is_too_small(tmp_path: Path):
    result, sam_log = _run_deploy_script(
        tmp_path,
        lambda_quota="10",
        overrides={"API_RESERVED_CONCURRENCY": "2", "INGESTION_RESERVED_CONCURRENCY": "1"},
    )

    assert result.returncode != 0
    assert sam_log == ""
    assert "Lambda concurrency quota is 10" in result.stderr
    assert "0 additional executions can be reserved" in result.stderr


def test_reservations_remain_available_after_a_quota_increase(tmp_path: Path):
    result, sam_log = _run_deploy_script(
        tmp_path,
        lambda_quota="1000",
        overrides={"API_RESERVED_CONCURRENCY": "10", "INGESTION_RESERVED_CONCURRENCY": "4"},
    )

    assert result.returncode == 0, result.stderr
    assert "ApiReservedConcurrency=10" in sam_log
    assert "IngestionReservedConcurrency=4" in sam_log


def test_unprotected_root_identity_is_rejected_before_sam(tmp_path: Path):
    result, sam_log = _run_deploy_script(
        tmp_path,
        caller_arn="arn:aws:iam::123456789012:root",
        root_mfa_enabled="0",
    )

    assert result.returncode != 0
    assert sam_log == ""
    assert "root user has no MFA" in result.stderr


def test_detailed_api_metrics_require_an_explicit_opt_in(tmp_path: Path):
    result, sam_log = _run_deploy_script(
        tmp_path,
        overrides={"API_DETAILED_METRICS_ENABLED": "true"},
    )

    assert result.returncode == 0, result.stderr
    assert "ApiDetailedMetricsEnabled=true" in sam_log


def test_guardduty_can_be_disabled_for_trusted_aws_open_data_only(tmp_path: Path):
    result, sam_log = _run_deploy_script(
        tmp_path,
        overrides={"GUARDDUTY_MALWARE_PROTECTION_ENABLED": "false"},
    )

    assert result.returncode == 0, result.stderr
    assert "GuardDutyMalwareProtectionEnabled=false" in sam_log


def test_native_linux_build_uses_matching_python_without_docker_container(tmp_path: Path):
    result, sam_log = _run_deploy_script(
        tmp_path,
        overrides={"SENTINEL_SAM_BUILD_MODE": "native-linux"},
    )

    assert result.returncode == 0, result.stderr
    build_line = next(line for line in sam_log.splitlines() if line.startswith("build "))
    assert "--use-container" not in build_line
    assert "--template-file infra/template.yaml" in build_line


def test_legacy_build_mode_is_translated_without_leaking_sam_reserved_environment(
    tmp_path: Path,
):
    result, sam_log = _run_deploy_script(
        tmp_path,
        overrides={
            "SAM_BUILD_MODE": "native-linux",
            "FAKE_REJECT_SAM_BUILD_MODE": "1",
        },
    )

    assert result.returncode == 0, result.stderr
    build_line = next(line for line in sam_log.splitlines() if line.startswith("build "))
    assert "--use-container" not in build_line


def test_native_build_is_rejected_outside_linux_x86_64(tmp_path: Path):
    result, sam_log = _run_deploy_script(
        tmp_path,
        overrides={
            "SENTINEL_SAM_BUILD_MODE": "native-linux",
            "FAKE_UNAME_S": "Darwin",
            "FAKE_UNAME_M": "arm64",
        },
    )

    assert result.returncode != 0
    assert sam_log == ""
    assert "native-linux requires a Linux x86_64 host" in result.stderr
