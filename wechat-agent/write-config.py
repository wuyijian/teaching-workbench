#!/usr/bin/env python3
import json, os

config = {
    "default_agent": "teaching-workbench",
    "agents": {
        "teaching-workbench": {
            "type": "http",
            "endpoint": "http://127.0.0.1:18080/v1/chat/completions",
            "api_key": "local-agent",
            "model": "teaching-workbench"
        }
    }
}

path = os.path.expanduser("~/.weclaw/config.json")
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w") as f:
    json.dump(config, f, indent=2, ensure_ascii=False)

print("written:", path)
with open(path) as f:
    print(f.read())
