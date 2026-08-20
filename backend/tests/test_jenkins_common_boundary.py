from __future__ import annotations

import inspect

from app.api.v1 import jenkins_freeze, jenkins_resume_run


def test_common_token_is_not_referenced_in_freeze_or_resume_backend_paths() -> None:
    combined_source = inspect.getsource(jenkins_freeze) + inspect.getsource(jenkins_resume_run)

    assert "jenkins_common" not in combined_source
