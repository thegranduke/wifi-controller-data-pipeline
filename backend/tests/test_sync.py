def test_sync_twice_no_duplicate_venues(client):
    client.post("/sync")
    client.post("/sync")
    response = client.get("/venues")
    assert len(response.json()) == 3  # always exactly 3, never 6


def test_sessions_grow_each_sync(client):
    client.post("/sync")
    first = client.get("/sessions").json()["total"]
    client.post("/sync")
    second = client.get("/sessions").json()["total"]
    assert second > first


def test_controller_down_writes_failed_log(client):
    client.post("/sync?mode=down")
    logs = client.get("/sync-logs").json()["logs"]
    assert logs[0]["status"] == "failed"
    assert logs[0]["error_message"] is not None


def test_health_returns_ok(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_invalid_sync_mode_rejected(client):
    response = client.post("/sync?mode=explode")
    assert response.status_code == 400
