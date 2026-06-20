#!/usr/bin/env python3
"""
Import all EasyPanel templates as srvly recipes (parallel version).
"""
import sys, json, base64, re, os, concurrent.futures
import urllib.request
from pathlib import Path

try:
    import yaml
except ImportError:
    os.system("pip install pyyaml -q")
    import yaml


def get_github_token():
    for cred_path in [Path.home() / ".git-credentials"]:
        if cred_path.exists():
            for line in cred_path.read_text().split("\n"):
                if "github.com" in line and "ghp_" in line:
                    parts = line.split("@")[0].split("://")[-1].split(":", 1)
                    if len(parts) == 2:
                        return parts[1].strip()
    return None


def gh_api(path, token):
    url = f"https://api.github.com/repos/Vellis59/templates/contents/{path}"
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"token {token}")
    req.add_header("Accept", "application/vnd.github.v3+json")
    try:
        return json.loads(urllib.request.urlopen(req, timeout=15).read())
    except Exception:
        return None


def parse_index_ts(text):
    info = {"ports": [], "mounts": [], "databases": [], "has_redis": False, "main_port": 80}
    if not text:
        return info
    port_matches = re.findall(r'(?:published|port|target):\s*(\d+)', text)
    info["ports"] = sorted(set(int(p) for p in port_matches))[:10]
    domain_matches = re.findall(r'port:\s*(\d+)\s*\}', text)
    info["main_port"] = int(domain_matches[0]) if domain_matches else (info["ports"][0] if info["ports"] else 80)
    info["mounts"] = re.findall(r'mountPath:\s*"([^"]+)"', text)
    if "postgres" in text.lower():
        info["databases"].append("postgres")
    if "mariadb" in text.lower() or "mysql" in text.lower():
        info["databases"].append("mysql")
    if 'type: "redis"' in text or "input.redis" in text:
        info["has_redis"] = True
    return info


def process_template(folder_name, token):
    """Fetch and convert a single template"""
    meta_yaml = None
    index_ts = None
    
    data = gh_api(f"templates/{folder_name}", token)
    if not data:
        return None
    
    for item in data:
        if item["name"] == "meta.yaml" and item["type"] == "file":
            content = gh_api(f"templates/{folder_name}/meta.yaml", token)
            if content and "content" in content:
                meta_yaml = base64.b64decode(content["content"]).decode()
        elif item["name"] == "index.ts" and item["type"] == "file":
            content = gh_api(f"templates/{folder_name}/index.ts", token)
            if content and "content" in content:
                index_ts = base64.b64decode(content["content"]).decode()
    
    if not meta_yaml:
        return None
    
    meta = yaml.safe_load(meta_yaml)
    if not meta or not meta.get("name"):
        return None

    recipe_id = folder_name.lower()
    tags = meta.get("tags", [])
    category = tags[0].lower().replace(" ", "-") if tags else "self-hosted"
    docker_info = parse_index_ts(index_ts or "")
    schema = meta.get("schema", {})
    props = schema.get("properties", {})
    default_image = props.get("appServiceImage", {}).get("default", "")

    recipe = {
        "metadata": {
            "name": meta["name"],
            "version": "latest",
            "description": meta.get("description", "").strip(),
            "category": category,
            "tags": tags,
            "os_support": ["ubuntu-22.04", "ubuntu-24.04", "debian-12"],
            "dependencies": ["docker"] + docker_info["databases"],
        },
        "params": {
            "image": {"type": "string", "title": "Image Docker", "default": default_image},
            "port": {"type": "integer", "title": "Port HTTP", "default": docker_info["main_port"]},
        },
        "links": meta.get("links", []),
        "instructions": meta.get("instructions"),
        "install": [{
            "docker": {
                "image": "$IMAGE",
                "name": recipe_id,
                "port": "$PORT:" + str(docker_info["main_port"]),
                "volumes": docker_info["mounts"],
                "extra_ports": [str(p)+":"+str(p) for p in docker_info["ports"] if p != docker_info["main_port"]],
            }
        }],
        "verify": [{"http_get": {"url": "http://localhost:$PORT", "expect": [200, 301, 302]}}],
        "output": {"url": "http://{{ server_ip }}:$PORT", "type": "webapp", "notes": meta.get("instructions", "")}
    }

    services = {}
    for db in docker_info["databases"]:
        services[db] = {"type": db, "version": "latest"}
    if docker_info.get("has_redis"):
        services["redis"] = {"type": "redis", "version": "7"}
    if services:
        recipe["services"] = services

    return (recipe_id, recipe)


def main():
    out_dir = "recipes"
    max_workers = 15

    token = get_github_token()
    if not token:
        print("ERROR: No token")
        sys.exit(1)
    
    print("Fetching template list...")
    templates = gh_api("templates", token)
    if not templates:
        print("ERROR: Could not fetch templates")
        sys.exit(1)
    
    total = len(templates)
    print(f"Found {total} templates, importing with {max_workers} threads...")

    Path(out_dir).mkdir(parents=True, exist_ok=True)
    folders = [t["name"] for t in templates if t["type"] == "dir"]
    
    converted = 0
    errors = 0
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as pool:
        fut_to_name = {pool.submit(process_template, f, token): f for f in folders}
        done = 0
        for future in concurrent.futures.as_completed(fut_to_name):
            done += 1
            name = fut_to_name[future]
            try:
                result = future.result()
                if result:
                    rid, recipe = result
                    with open(Path(out_dir) / f"{rid}.yml", "w") as f:
                        yaml.dump(recipe, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
                    converted += 1
                else:
                    errors += 1
            except Exception as e:
                errors += 1
            if done % 50 == 0 or done == total:
                print(f"  {done}/{total} — {converted} converted, {errors} errors")

    print(f"\nDone! {converted} recipes in {out_dir}/ ({errors} skipped/errors)")


if __name__ == "__main__":
    main()
