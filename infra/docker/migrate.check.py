"""Run: python3 infra/docker/migrate.check.py (no database or containers)."""
import os
from pathlib import Path
import subprocess
import tempfile


script = Path(__file__).with_name("migrate.sh").resolve()
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    log = root / "commands"
    for command in ("npm", "node"):
        mock = root / command
        mock.write_text(
            '#!/bin/sh\n'
            'printf "%s %s\\n" "${0##*/}" "$*" >> "$CHECK_LOG"\n'
            'if [ "${0##*/}" = "${CHECK_FAIL_COMMAND:-}" ]; then exit 7; fi\n'
        )
        mock.chmod(0o755)
    env = {**os.environ, "PATH": f"{root}:{os.environ['PATH']}", "CHECK_LOG": str(log)}
    services = ("catalog", "inventory", "orders", "payment", "users", "notification")
    outbox = ("catalog", "inventory", "orders", "payment", "notification")
    for service in services:
        log.write_text("")
        result = subprocess.run(["sh", str(script)], env={**env, "SERVICE": f"{service}-service"})
        assert result.returncode == 0, service
        expected = [f"npm run db:migrate:{service}"]
        if service in outbox:
            expected.append("node node_modules/.bin/nest-outbox migrate")
        assert log.read_text().splitlines() == expected, service

    # Drizzle failure must prevent outbox migration and return failure to the gate.
    log.write_text("")
    result = subprocess.run(
        ["sh", str(script)],
        env={**env, "SERVICE": "catalog-service", "CHECK_FAIL_COMMAND": "npm"},
    )
    assert result.returncode == 7
    assert log.read_text().splitlines() == ["npm run db:migrate:catalog"]

    # Outbox failure must also keep the migration container unsuccessful.
    log.write_text("")
    result = subprocess.run(
        ["sh", str(script)],
        env={**env, "SERVICE": "catalog-service", "CHECK_FAIL_COMMAND": "node"},
    )
    assert result.returncode == 7
    assert log.read_text().splitlines() == [
        "npm run db:migrate:catalog", "node node_modules/.bin/nest-outbox migrate",
    ]

    log.write_text("")
    result = subprocess.run(["sh", str(script)], env={**env, "SERVICE": "invalid"}, capture_output=True)
    assert result.returncode != 0 and not log.read_text()

print("Migration routing, order and failure gates: passed")
