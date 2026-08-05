import asyncio


def test_comment_store_constructor_has_no_filesystem_side_effect(monkeypatch):
    """服务导入/实例化不得创建 /app，目录只在实际 archive 时创建。"""
    from src.services_v2 import comment_store_service as module

    calls = []
    monkeypatch.setattr(module.os, "makedirs", lambda *args, **kwargs: calls.append(args))
    module.CommentStoreService()
    assert calls == []


def test_r2_sync_copies_objects_and_keeps_skips(monkeypatch):
    from src.services_v2 import r2_sync_service as module

    calls = []

    async def fake_request(msg_type, payload, timeout=0):
        calls.append((msg_type, payload))
        if msg_type == "r2.comment.list":
            return {
                "hit": True,
                "objects": [
                    {"key": "comment/101", "size": 120},
                    {"key": "comment/102", "size": 80},
                ],
                "cursor": None,
            }
        return {"hit": True, "body": '{"comments":[{"m":"x"}]}' }

    def fake_archive(episode_id, body, source):
        assert source == "r2_sync"
        return {"saved": episode_id == "101"}

    monkeypatch.setattr(module.control_client, "request", fake_request)
    monkeypatch.setattr(module.comment_store_service, "archive", fake_archive)
    service = module.R2SyncService()

    async def run():
        assert service.start("sync") is True
        await service._task

    asyncio.run(run())
    status = service.status()
    assert status["phase"] == "completed"
    assert status["objects"] == 2
    assert status["total_bytes"] == 200
    assert status["processed"] == 2
    assert status["saved"] == 1
    assert status["skipped"] == 1
    gets = [payload for msg_type, payload in calls if msg_type == "r2.comment.get"]
    assert all(payload["include_expired"] is True for payload in gets)


def test_r2_scan_does_not_download_objects(monkeypatch):
    from src.services_v2 import r2_sync_service as module

    calls = []

    async def fake_request(msg_type, payload, timeout=0):
        calls.append(msg_type)
        return {"hit": True, "objects": [{"key": "comment/1", "size": 10}], "cursor": None}

    monkeypatch.setattr(module.control_client, "request", fake_request)
    service = module.R2SyncService()

    async def run():
        assert service.start("scan") is True
        await service._task

    asyncio.run(run())
    assert calls == ["r2.comment.list"]
    assert service.status()["objects"] == 1
