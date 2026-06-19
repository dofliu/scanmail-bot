import os
import pytest
from app.config import get_settings

# Force ENABLE_AUTH=False and use a test database for all tests by default.
# This prevents test failures when local .env has ENABLE_AUTH=True.
os.environ["ENABLE_AUTH"] = "False"
if "DATABASE_PATH" not in os.environ:
    os.environ["DATABASE_PATH"] = "test_scanmail_temp.db"

# Clear settings cache so that config imports read the new environment variables
get_settings.cache_clear()
