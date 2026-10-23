import os
os.environ.update(DATABASE_URL="sqlite:///./test.db",SECRET_KEY="test-secret-that-is-long-enough-000",TOKEN_ENCRYPTION_KEY="pMyp2O8fsNHLPzqadVGNOOwJo4FyKhPbE51qZA4zeVk=",STORAGE_DIR="./test-storage",CELERY_TASK_ALWAYS_EAGER="false")
import pytest
from fastapi.testclient import TestClient
from app.db import Base,engine
from app.main import app

@pytest.fixture(autouse=True)
def clean_db():
    Base.metadata.drop_all(engine); Base.metadata.create_all(engine); yield; Base.metadata.drop_all(engine)
@pytest.fixture
def client(): return TestClient(app)
@pytest.fixture
def auth(client):
    response=client.post("/api/auth/register",json={"email":"owner@example.com","password":"very-secure-password"}); assert response.status_code==201
    return {"X-CSRF-Token":response.json()["csrf_token"]}
