from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_health() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_root() -> None:
    response = client.get("/")

    assert response.status_code == 200
    assert response.json()["name"] == "AI Live Video Maker API"
    assert response.json()["version"] == "0.1.0"
