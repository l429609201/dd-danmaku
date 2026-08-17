"""数据库补丁注册器的幂等与安全开关测试。"""
from sqlalchemy import create_engine, text

from src.db_patches.runner import apply_patch_registry
from src.db_patches.types import Patch


def test_completed_patch_is_not_executed_twice():
    engine = create_engine("sqlite://")
    calls = []

    def apply(_engine):
        calls.append("run")
        with _engine.begin() as conn:
            conn.execute(text("CREATE TABLE demo (id INTEGER PRIMARY KEY)"))
        return True

    patch = Patch("test-idempotent", "测试幂等补丁", apply)
    first = apply_patch_registry(engine, [patch])
    second = apply_patch_registry(engine, [patch])

    assert first == {"applied": [patch.patch_id], "skipped": [], "failed": []}
    assert second == {"applied": [], "skipped": [patch.patch_id], "failed": []}
    assert calls == ["run"]
    engine.dispose()


def test_failed_patch_is_retried_next_time():
    engine = create_engine("sqlite://")
    calls = []

    def apply(_engine):
        calls.append("run")
        if len(calls) == 1:
            raise RuntimeError("first failure")
        return False

    patch = Patch("test-retry", "测试失败重试", apply)
    first = apply_patch_registry(engine, [patch])
    second = apply_patch_registry(engine, [patch])

    assert first["failed"] == [patch.patch_id]
    assert second["applied"] == [patch.patch_id]
    assert calls == ["run", "run"]
    engine.dispose()


def test_destructive_patch_requires_explicit_switch():
    engine = create_engine("sqlite://")
    calls = []
    patch = Patch(
        "test-destructive", "测试不可逆开关",
        lambda _engine: calls.append("run") or True,
        destructive=True,
    )

    blocked = apply_patch_registry(engine, [patch], allow_destructive=False)
    allowed = apply_patch_registry(engine, [patch], allow_destructive=True)

    assert blocked["skipped"] == [patch.patch_id]
    assert allowed["applied"] == [patch.patch_id]
    assert calls == ["run"]
    engine.dispose()
